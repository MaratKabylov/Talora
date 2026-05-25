-- Candidate invitations: tenant ownership, guarded invitation tokens and atomic issuing.

alter table public.candidates
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

alter table public.candidates
  alter column company_id set not null;

alter table public.invitations
  alter column candidate_id set not null;

alter table public.invitations
  alter column application_id set not null;

create index if not exists idx_candidates_company_created_at
  on public.candidates(company_id, created_at desc);

create unique index if not exists idx_candidates_company_email_unique
  on public.candidates(company_id, lower(email))
  where email is not null;

create index if not exists idx_invitations_application_created_at
  on public.invitations(application_id, created_at desc);

drop policy if exists "members can read candidates" on public.candidates;
create policy "members can read candidates"
on public.candidates for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists "recruiters can manage candidates" on public.candidates;
create policy "recruiters can manage candidates"
on public.candidates for all to authenticated
using (public.can_manage_company_resources(company_id))
with check (public.can_manage_company_resources(company_id));

drop policy if exists "members can manage applications" on public.candidate_applications;
drop policy if exists "recruiters can manage applications" on public.candidate_applications;
create policy "recruiters can manage applications"
on public.candidate_applications for all to authenticated
using (public.can_manage_company_resources(company_id))
with check (public.can_manage_company_resources(company_id));

-- Tokens grant access to the candidate flow, so read access is limited to hiring managers.
drop policy if exists "members can read invitations" on public.invitations;
drop policy if exists "recruiters can read invitations" on public.invitations;
create policy "recruiters can read invitations"
on public.invitations for select to authenticated
using (public.can_manage_company_resources(company_id));

drop policy if exists "members can manage invitations" on public.invitations;
drop policy if exists "recruiters can manage invitations" on public.invitations;
create policy "recruiters can manage invitations"
on public.invitations for all to authenticated
using (public.can_manage_company_resources(company_id))
with check (public.can_manage_company_resources(company_id));

create or replace function public.prevent_company_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.company_id is distinct from new.company_id then
    raise exception 'Company ownership cannot be changed';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_job_company_reassignment on public.jobs;
create trigger prevent_job_company_reassignment
before update of company_id on public.jobs
for each row execute function public.prevent_company_reassignment();

drop trigger if exists prevent_candidate_company_reassignment on public.candidates;
create trigger prevent_candidate_company_reassignment
before update of company_id on public.candidates
for each row execute function public.prevent_company_reassignment();

drop trigger if exists prevent_application_company_reassignment on public.candidate_applications;
create trigger prevent_application_company_reassignment
before update of company_id on public.candidate_applications
for each row execute function public.prevent_company_reassignment();

drop trigger if exists prevent_invitation_company_reassignment on public.invitations;
create trigger prevent_invitation_company_reassignment
before update of company_id on public.invitations
for each row execute function public.prevent_company_reassignment();

create or replace function public.validate_candidate_application_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.jobs j
    where j.id = new.job_id
      and j.company_id = new.company_id
  ) then
    raise exception 'Candidate application job must belong to its company';
  end if;

  if not exists (
    select 1
    from public.candidates c
    where c.id = new.candidate_id
      and c.company_id = new.company_id
  ) then
    raise exception 'Candidate application candidate must belong to its company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_candidate_application_tenant on public.candidate_applications;
create trigger validate_candidate_application_tenant
before insert or update of company_id, job_id, candidate_id on public.candidate_applications
for each row execute function public.validate_candidate_application_tenant();

create or replace function public.validate_invitation_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.candidate_applications application
    where application.id = new.application_id
      and application.company_id = new.company_id
      and application.job_id = new.job_id
      and application.candidate_id = new.candidate_id
  ) then
    raise exception 'Invitation must match its candidate application';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_invitation_tenant on public.invitations;
create trigger validate_invitation_tenant
before insert or update of company_id, job_id, candidate_id, application_id on public.invitations
for each row execute function public.validate_invitation_tenant();

create or replace function public.invite_candidate_to_job(
  target_company_id uuid,
  target_job_id uuid,
  candidate_full_name text,
  candidate_email text,
  candidate_phone text default null,
  candidate_city text default null,
  candidate_source text default null,
  invitation_expires_at timestamptz default null
)
returns table (
  created_candidate_id uuid,
  created_application_id uuid,
  created_invitation_id uuid,
  invitation_token text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(candidate_email));
  selected_candidate_id uuid;
  selected_application_id uuid;
  selected_application_status text;
  generated_token text;
  effective_expires_at timestamptz := coalesce(invitation_expires_at, now() + interval '7 days');
begin
  if not public.can_manage_company_resources(target_company_id) then
    raise exception 'User cannot invite candidates for this company';
  end if;

  if btrim(coalesce(candidate_full_name, '')) = '' or normalized_email = '' then
    raise exception 'Candidate name and email are required';
  end if;

  if effective_expires_at <= now() then
    raise exception 'Invitation expiration must be in the future';
  end if;

  if not exists (
    select 1
    from public.jobs j
    where j.id = target_job_id
      and j.company_id = target_company_id
      and j.assessment_package_id is not null
      and j.status not in ('closed', 'archived')
  ) then
    raise exception 'Job is unavailable for invitations or has no assessment package';
  end if;

  select c.id
  into selected_candidate_id
  from public.candidates c
  where c.company_id = target_company_id
    and lower(c.email) = normalized_email
  limit 1
  for update;

  if selected_candidate_id is null then
    insert into public.candidates (
      company_id,
      full_name,
      email,
      phone,
      city,
      source
    )
    values (
      target_company_id,
      btrim(candidate_full_name),
      normalized_email,
      nullif(btrim(candidate_phone), ''),
      nullif(btrim(candidate_city), ''),
      nullif(btrim(candidate_source), '')
    )
    returning id into selected_candidate_id;
  else
    update public.candidates
    set
      full_name = btrim(candidate_full_name),
      phone = coalesce(nullif(btrim(candidate_phone), ''), phone),
      city = coalesce(nullif(btrim(candidate_city), ''), city),
      source = coalesce(nullif(btrim(candidate_source), ''), source)
    where id = selected_candidate_id;
  end if;

  select application.id, application.status
  into selected_application_id, selected_application_status
  from public.candidate_applications application
  where application.job_id = target_job_id
    and application.candidate_id = selected_candidate_id
  for update;

  if selected_application_id is null then
    insert into public.candidate_applications (
      company_id,
      job_id,
      candidate_id,
      status,
      current_stage
    )
    values (
      target_company_id,
      target_job_id,
      selected_candidate_id,
      'invited',
      'invitation'
    )
    returning id into selected_application_id;
  elsif selected_application_status in ('completed', 'hired', 'rejected', 'withdrawn') then
    raise exception 'This application cannot receive a new invitation';
  end if;

  if exists (
    select 1
    from public.invitations invitation
    where invitation.application_id = selected_application_id
      and invitation.status in ('started', 'completed')
  ) then
    raise exception 'Candidate has already started the assessment';
  end if;

  update public.invitations
  set status = 'cancelled'
  where application_id = selected_application_id
    and status in ('created', 'sent', 'opened');

  generated_token := encode(gen_random_bytes(32), 'hex');

  insert into public.invitations (
    company_id,
    job_id,
    candidate_id,
    application_id,
    token,
    status,
    expires_at,
    sent_at
  )
  values (
    target_company_id,
    target_job_id,
    selected_candidate_id,
    selected_application_id,
    generated_token,
    'sent',
    effective_expires_at,
    now()
  )
  returning id into created_invitation_id;

  created_candidate_id := selected_candidate_id;
  created_application_id := selected_application_id;
  invitation_token := generated_token;
  return next;
end;
$$;

revoke all on function public.invite_candidate_to_job(uuid, uuid, text, text, text, text, text, timestamptz)
  from public, anon;
grant execute on function public.invite_candidate_to_job(uuid, uuid, text, text, text, text, text, timestamptz)
  to authenticated;
