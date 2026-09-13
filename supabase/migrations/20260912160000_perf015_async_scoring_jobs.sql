-- PERF-015: durable asynchronous scoring queue.
-- Completion enqueues only server-verified, fully completed assessments. Workers claim
-- with SKIP LOCKED. The queued scoring snapshot, parent completion, invitation completion
-- and job completion commit in one transaction.

create table if not exists public.scoring_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  scope text not null check (scope in ('candidate', 'employee')),
  parent_id uuid not null,
  invitation_id uuid not null,
  expected_revision integer not null check (expected_revision >= 0),
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'retry', 'completed', 'failed')
  ),
  attempts integer not null default 0 check (attempts between 0 and 20),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_until timestamptz,
  locked_by uuid,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  result_revision integer check (result_revision is null or result_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (scope, parent_id, expected_revision),
  constraint scoring_job_lock_shape check (
    (status = 'processing' and locked_at is not null and locked_until is not null and locked_by is not null)
    or (status <> 'processing' and locked_at is null and locked_until is null and locked_by is null)
  )
);

create index if not exists scoring_jobs_claimable
  on public.scoring_jobs (available_at, created_at, id)
  where status in ('pending', 'retry');

create index if not exists scoring_jobs_expired_leases
  on public.scoring_jobs (locked_until, id)
  where status = 'processing';

create index if not exists scoring_jobs_company_created
  on public.scoring_jobs (company_id, created_at desc, id);

comment on table public.scoring_jobs is
  'Durable service-only scoring work. Candidate status is exposed only by token-validated completion RPCs.';

alter table public.scoring_jobs enable row level security;

revoke all on table public.scoring_jobs from public, anon, authenticated, service_role;

create or replace function public.enqueue_scoring_job(
  p_scope text,
  p_parent_id uuid,
  p_invitation_id uuid,
  p_retry_failed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_row record;
  invitation_row record;
  existing_job public.scoring_jobs%rowtype;
  all_completed boolean;
  inserted_job public.scoring_jobs%rowtype;
begin
  if p_scope = 'candidate' then
    select application.id, application.company_id, application.status,
           application.scoring_revision
    into parent_row
    from public.candidate_applications application
    where application.id = p_parent_id
    for update;

    select invitation.id, invitation.status
    into invitation_row
    from public.invitations invitation
    where invitation.id = p_invitation_id
      and invitation.application_id = p_parent_id
      and invitation.company_id = parent_row.company_id
    for share;

    select count(*) > 0 and coalesce(bool_and(session.status = 'completed'), false)
    into all_completed
    from public.test_sessions session
    where session.application_id = p_parent_id;
  elsif p_scope = 'employee' then
    select participant.id, participant.company_id, participant.status,
           participant.scoring_revision
    into parent_row
    from public.employee_assessment_participants participant
    where participant.id = p_parent_id
    for update;

    select invitation.id, invitation.status
    into invitation_row
    from public.employee_assessment_invitations invitation
    where invitation.id = p_invitation_id
      and invitation.participant_id = p_parent_id
      and invitation.company_id = parent_row.company_id
    for share;

    select count(*) > 0 and coalesce(bool_and(session.status = 'completed'), false)
    into all_completed
    from public.employee_assessment_sessions session
    where session.participant_id = p_parent_id;
  else
    raise exception 'Invalid scoring job scope';
  end if;

  if parent_row.id is null or invitation_row.id is null then
    raise exception 'Scoring job target was not found';
  end if;
  if parent_row.status = 'completed' and invitation_row.status = 'completed' then
    return jsonb_build_object('status', 'completed');
  end if;
  if parent_row.status not in ('invited', 'in_progress')
     or invitation_row.status <> 'started'
     or not all_completed
  then
    raise exception 'Scoring job target is not ready';
  end if;

  select job.* into existing_job
  from public.scoring_jobs job
  where job.scope = p_scope
    and job.parent_id = p_parent_id
    and job.expected_revision = parent_row.scoring_revision
  for update;

  if existing_job.id is not null then
    if existing_job.status = 'failed' and p_retry_failed then
      update public.scoring_jobs
      set status = 'pending', attempts = 0, available_at = clock_timestamp(),
          error_code = null, updated_at = clock_timestamp(), completed_at = null
      where id = existing_job.id;
      return jsonb_build_object('status', 'queued', 'jobId', existing_job.id);
    end if;
    return jsonb_build_object(
      'status', case
        when existing_job.status = 'completed' then 'completed'
        when existing_job.status = 'failed' then 'failed'
        else 'processing'
      end,
      'jobId', existing_job.id
    );
  end if;

  insert into public.scoring_jobs (
    company_id, scope, parent_id, invitation_id, expected_revision
  ) values (
    parent_row.company_id, p_scope, p_parent_id, p_invitation_id,
    parent_row.scoring_revision
  ) returning * into inserted_job;

  return jsonb_build_object('status', 'queued', 'jobId', inserted_job.id);
exception
  when unique_violation then
    select job.* into existing_job
    from public.scoring_jobs job
    where job.scope = p_scope
      and job.parent_id = p_parent_id
      and job.expected_revision = parent_row.scoring_revision
    order by job.created_at desc, job.id desc
    limit 1;
    return jsonb_build_object('status', 'processing', 'jobId', existing_job.id);
end;
$$;

create or replace function public.claim_scoring_jobs(
  p_worker_id uuid,
  p_limit integer default 1,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed jsonb;
begin
  if p_worker_id is null or p_limit not between 1 and 10
     or p_lease_seconds not between 30 and 900
  then
    raise exception 'Invalid scoring worker claim';
  end if;

  update public.scoring_jobs job
  set status = 'failed', error_code = 'worker_lease_expired',
      locked_at = null, locked_until = null, locked_by = null,
      updated_at = clock_timestamp()
  where job.status = 'processing'
    and job.locked_until <= clock_timestamp()
    and job.attempts >= job.max_attempts;

  with claimable as (
    select job.id
    from public.scoring_jobs job
    where job.attempts < job.max_attempts
      and (
        (job.status in ('pending', 'retry') and job.available_at <= clock_timestamp())
        or (job.status = 'processing' and job.locked_until <= clock_timestamp())
      )
    order by job.available_at, job.created_at, job.id
    for update skip locked
    limit p_limit
  ), updated as (
    update public.scoring_jobs job
    set status = 'processing', attempts = job.attempts + 1,
        locked_at = clock_timestamp(),
        locked_until = clock_timestamp() + make_interval(secs => p_lease_seconds),
        locked_by = p_worker_id, updated_at = clock_timestamp()
    from claimable
    where job.id = claimable.id
    returning job.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'jobId', updated.id,
    'scope', updated.scope,
    'parentId', updated.parent_id,
    'invitationId', updated.invitation_id,
    'expectedRevision', updated.expected_revision,
    'attempt', updated.attempts
  ) order by updated.created_at, updated.id), '[]'::jsonb)
  into claimed
  from updated;

  return claimed;
end;
$$;

create or replace function public.finish_scoring_job(
  p_job_id uuid,
  p_worker_id uuid,
  p_success boolean,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.scoring_jobs%rowtype;
  target_complete boolean;
  safe_error text;
begin
  select job.* into job_row
  from public.scoring_jobs job
  where job.id = p_job_id
  for update;

  if job_row.id is null then raise exception 'Scoring job was not found'; end if;
  if job_row.status = 'completed' then
    return jsonb_build_object('status', 'completed');
  end if;
  if job_row.status <> 'processing'
     or job_row.locked_by <> p_worker_id
     or job_row.locked_until <= clock_timestamp()
  then
    raise exception 'Scoring job lease was lost';
  end if;

  if p_success then
    if job_row.scope = 'candidate' then
      select application.status = 'completed' and invitation.status = 'completed'
      into target_complete
      from public.candidate_applications application
      join public.invitations invitation
        on invitation.id = job_row.invitation_id
       and invitation.application_id = application.id
       and invitation.company_id = application.company_id
      where application.id = job_row.parent_id
        and application.company_id = job_row.company_id;
    else
      select participant.status = 'completed' and invitation.status = 'completed'
      into target_complete
      from public.employee_assessment_participants participant
      join public.employee_assessment_invitations invitation
        on invitation.id = job_row.invitation_id
       and invitation.participant_id = participant.id
       and invitation.company_id = participant.company_id
      where participant.id = job_row.parent_id
        and participant.company_id = job_row.company_id;
    end if;
    if not coalesce(target_complete, false) then
      raise exception 'Scoring target is not completed';
    end if;
    update public.scoring_jobs
    set status = 'completed', locked_at = null, locked_until = null,
        locked_by = null, error_code = null, completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where id = job_row.id;
    return jsonb_build_object('status', 'completed');
  end if;

  safe_error := case
    when p_error_code ~ '^[a-z0-9_]{1,64}$' then p_error_code
    else 'scoring_failed'
  end;
  update public.scoring_jobs
  set status = case when attempts >= max_attempts then 'failed' else 'retry' end,
      available_at = clock_timestamp() + make_interval(secs => least(300, 5 * attempts * attempts)),
      locked_at = null, locked_until = null, locked_by = null,
      error_code = safe_error, updated_at = clock_timestamp()
  where id = job_row.id;

  return jsonb_build_object(
    'status', case when job_row.attempts >= job_row.max_attempts then 'failed' else 'retry' end
  );
end;
$$;

create or replace function public.try_persist_queued_scoring_snapshot(
  p_job_id uuid,
  p_worker_id uuid,
  p_scope text,
  p_parent_id uuid,
  p_expected_revision integer,
  p_snapshot jsonb,
  p_audit jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  job_row public.scoring_jobs%rowtype;
  persisted jsonb;
  affected integer;
begin
  if p_scope = 'candidate' then
    perform 1 from public.candidate_applications application
    where application.id = p_parent_id for update;
  elsif p_scope = 'employee' then
    perform 1 from public.employee_assessment_participants participant
    where participant.id = p_parent_id for update;
  else
    raise exception 'Invalid queued scoring scope';
  end if;
  if not found then raise exception 'Queued scoring parent was not found'; end if;

  select job.* into job_row
  from public.scoring_jobs job
  where job.id = p_job_id
  for update;

  if job_row.id is null
     or job_row.status <> 'processing'
     or job_row.locked_by <> p_worker_id
     or job_row.locked_until <= clock_timestamp()
     or job_row.scope <> p_scope
     or job_row.parent_id <> p_parent_id
     or job_row.expected_revision <> p_expected_revision
  then
    raise exception 'Queued scoring job lease or target is invalid';
  end if;

  persisted := public.try_persist_scoring_snapshot(
    p_scope, p_parent_id, p_expected_revision, p_snapshot, p_audit
  );
  if coalesce((persisted ->> 'conflict')::boolean, false) then return persisted; end if;

  if p_scope = 'candidate' then
    update public.candidate_applications
    set completed_at = clock_timestamp(), current_stage = 'assessment_completed', status = 'completed'
    where id = p_parent_id and company_id = job_row.company_id
      and current_stage = 'scoring' and status in ('invited', 'in_progress');
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'Candidate scoring parent completion failed'; end if;

    update public.invitations
    set status = 'completed'
    where id = job_row.invitation_id and application_id = p_parent_id
      and company_id = job_row.company_id and status in ('created', 'sent', 'opened', 'started');
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'Candidate scoring invitation completion failed'; end if;
  else
    update public.employee_assessment_participants
    set completed_at = clock_timestamp(), current_stage = 'assessment_completed', status = 'completed'
    where id = p_parent_id and company_id = job_row.company_id
      and current_stage = 'scoring' and status in ('invited', 'in_progress');
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'Employee scoring parent completion failed'; end if;

    update public.employee_assessment_invitations
    set status = 'completed'
    where id = job_row.invitation_id and participant_id = p_parent_id
      and company_id = job_row.company_id and status in ('created', 'sent', 'opened', 'started');
    get diagnostics affected = row_count;
    if affected <> 1 then raise exception 'Employee scoring invitation completion failed'; end if;
  end if;

  update public.scoring_jobs
  set status = 'completed', result_revision = (persisted ->> 'revision')::integer,
      locked_at = null, locked_until = null, locked_by = null,
      error_code = null, completed_at = clock_timestamp(), updated_at = clock_timestamp()
  where id = job_row.id;

  return persisted;
end;
$$;

revoke all on function public.enqueue_scoring_job(text, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_scoring_jobs(uuid, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.finish_scoring_job(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.try_persist_queued_scoring_snapshot(uuid, uuid, text, uuid, integer, jsonb, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.enqueue_scoring_job(text, uuid, uuid, boolean) to service_role;
grant execute on function public.claim_scoring_jobs(uuid, integer, integer) to service_role;
grant execute on function public.finish_scoring_job(uuid, uuid, boolean, text) to service_role;
grant execute on function public.try_persist_queued_scoring_snapshot(uuid, uuid, text, uuid, integer, jsonb, jsonb)
  to service_role;
