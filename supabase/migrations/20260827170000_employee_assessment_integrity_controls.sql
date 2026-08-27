-- Bring employee assessment sessions to parity with candidate assessment controls.

alter table public.employee_assessment_sessions
  add column if not exists deadline_at timestamptz,
  add column if not exists active_client_id_hash text,
  add column if not exists active_device_id_hash text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists submission_reason text;

alter table public.employee_assessment_sessions
  drop constraint if exists employee_assessment_sessions_client_hash_format,
  add constraint employee_assessment_sessions_client_hash_format
    check (active_client_id_hash is null or active_client_id_hash ~ '^[a-f0-9]{64}$'),
  drop constraint if exists employee_assessment_sessions_device_hash_format,
  add constraint employee_assessment_sessions_device_hash_format
    check (active_device_id_hash is null or active_device_id_hash ~ '^[a-f0-9]{64}$'),
  drop constraint if exists employee_assessment_sessions_submission_reason_check,
  add constraint employee_assessment_sessions_submission_reason_check
    check (submission_reason is null or submission_reason in ('employee', 'time_expired'));

update public.employee_assessment_sessions session
set deadline_at = session.started_at + make_interval(mins => version.duration_minutes)
from public.test_versions version
where version.id = session.test_version_id
  and session.status = 'in_progress'
  and session.started_at is not null
  and session.deadline_at is null
  and version.duration_minutes is not null;

create table if not exists public.employee_assessment_session_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  participant_id uuid not null references public.employee_assessment_participants(id) on delete cascade,
  session_id uuid not null references public.employee_assessment_sessions(id) on delete cascade,
  question_id uuid references public.questions(id) on delete set null,
  client_event_id uuid not null,
  event_type text not null check (
    event_type in (
      'focus_lost',
      'focus_returned',
      'clipboard_copy',
      'clipboard_cut',
      'clipboard_paste',
      'concurrent_session_blocked',
      'session_recovered',
      'timer_expired'
    )
  ),
  client_occurred_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  unique(session_id, client_event_id)
);

create index if not exists idx_employee_assessment_session_events_participant_time
  on public.employee_assessment_session_events(participant_id, occurred_at);
create index if not exists idx_employee_assessment_session_events_session_time
  on public.employee_assessment_session_events(session_id, occurred_at);

create or replace function public.validate_employee_assessment_session_event_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.employee_assessment_sessions session
    join public.employee_assessment_participants participant
      on participant.id = session.participant_id
    where session.id = new.session_id
      and session.participant_id = new.participant_id
      and participant.company_id = new.company_id
  ) then
    raise exception 'Employee assessment event must match its session, participant and company';
  end if;

  if new.question_id is not null and not exists (
    select 1
    from public.employee_assessment_sessions session
    join public.test_sections section on section.test_version_id = session.test_version_id
    join public.questions question on question.section_id = section.id
    where session.id = new.session_id
      and question.id = new.question_id
  ) then
    raise exception 'Employee assessment event question must belong to the session test version';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_employee_assessment_session_event_scope
on public.employee_assessment_session_events;
create trigger validate_employee_assessment_session_event_scope
before insert or update of company_id, participant_id, session_id, question_id
on public.employee_assessment_session_events
for each row execute function public.validate_employee_assessment_session_event_scope();

-- Keep the latest employee answer validation rules and reject writes after the deadline.
create or replace function public.validate_employee_assessment_answer_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.employee_assessment_sessions session
    join public.test_sections section on section.test_version_id = session.test_version_id
    join public.questions question on question.section_id = section.id
    where session.id = new.session_id
      and session.status = 'in_progress'
      and (session.deadline_at is null or session.deadline_at > now())
      and question.id = new.question_id
  ) then
    raise exception 'Employee answers can be saved only for an active session question before its deadline';
  end if;

  if new.selected_option_id is not null and not exists (
    select 1
    from public.answer_options option
    where option.id = new.selected_option_id
      and option.question_id = new.question_id
  ) then
    raise exception 'Selected option must belong to the question';
  end if;

  perform public.validate_forced_choice_answer_payload(
    new.question_id,
    new.answer_json,
    new.selected_option_id,
    new.answer_text,
    new.is_correct,
    new.points_awarded
  );
  perform public.validate_multiple_choice_answer_payload(
    new.question_id,
    new.answer_json,
    new.selected_option_id,
    new.answer_text,
    new.is_correct,
    new.raw_score,
    new.points_awarded
  );

  return new;
end;
$$;

alter table public.employee_assessment_session_events enable row level security;

drop policy if exists "members can read employee assessment session events"
on public.employee_assessment_session_events;
create policy "members can read employee assessment session events"
on public.employee_assessment_session_events for select to authenticated
using (public.is_company_member(company_id));

grant select on table public.employee_assessment_session_events to authenticated;
revoke insert, update, delete on table public.employee_assessment_session_events
  from anon, authenticated;
revoke all on function public.validate_employee_assessment_session_event_scope()
  from public, anon, authenticated;

-- Cancellation must also release the single-client lease.
create or replace function public.cancel_employee_assessment(
  target_company_id uuid,
  target_participant_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  selected_status text;
begin
  if auth.uid() is null or not public.can_manage_company_resources(target_company_id) then
    raise exception 'User cannot cancel employee assessments for this company';
  end if;

  select participant.status
  into selected_status
  from public.employee_assessment_participants participant
  where participant.id = target_participant_id
    and participant.company_id = target_company_id
  for update;

  if not found then
    raise exception 'Employee assessment participant not found';
  end if;

  if selected_status not in ('invited', 'in_progress') then
    raise exception 'Employee assessment can no longer be cancelled';
  end if;

  update public.employee_assessment_invitations invitation
  set status = 'cancelled'
  where invitation.participant_id = target_participant_id
    and invitation.company_id = target_company_id
    and invitation.status in ('created', 'sent', 'opened', 'started');

  update public.employee_assessment_sessions session
  set
    status = 'cancelled',
    active_client_id_hash = null,
    active_device_id_hash = null,
    lease_expires_at = null,
    last_heartbeat_at = null
  where session.participant_id = target_participant_id
    and session.status in ('not_started', 'in_progress');

  update public.employee_assessment_participants participant
  set
    status = 'cancelled',
    current_stage = 'cancelled'
  where participant.id = target_participant_id
    and participant.company_id = target_company_id;
end;
$$;

revoke all on function public.cancel_employee_assessment(uuid, uuid) from public, anon;
grant execute on function public.cancel_employee_assessment(uuid, uuid) to authenticated;

