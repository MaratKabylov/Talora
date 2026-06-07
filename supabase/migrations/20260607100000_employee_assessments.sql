-- Employee assessments: assessments for existing employees without jobs.

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 180),
  email text not null,
  phone text,
  department text,
  role_title text,
  metadata jsonb not null default '{}'::jsonb,
  profile_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_assessments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  assessment_package_id uuid not null references public.assessment_packages(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 2 and 180),
  description text,
  status text not null default 'draft' check (status in ('draft','active','paused','closed','archived')),
  passing_score numeric(5,2),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_assessment_competency_weights (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_assessment_id uuid not null references public.employee_assessments(id) on delete cascade,
  competency_key text not null,
  weight numeric(6,4) not null default 0,
  minimum_score numeric(5,2),
  is_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_assessment_id, competency_key)
);

create table if not exists public.employee_assessment_participants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_assessment_id uuid not null references public.employee_assessments(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','in_progress','completed','cancelled','archived')),
  current_stage text,
  overall_score numeric(5,2),
  fit_score numeric(5,2),
  recommendation text,
  risk_level text check (risk_level in ('low','medium','high')),
  requires_review boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_assessment_id, employee_id)
);

create table if not exists public.employee_assessment_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_assessment_id uuid not null references public.employee_assessments(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  participant_id uuid not null references public.employee_assessment_participants(id) on delete cascade,
  token text not null unique,
  status text not null default 'sent' check (status in ('created','sent','opened','started','completed','expired','cancelled')),
  expires_at timestamptz,
  sent_at timestamptz,
  opened_at timestamptz,
  consent_given_at timestamptz,
  consent_version text,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_assessment_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.employee_assessment_participants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  test_version_id uuid not null references public.test_versions(id) on delete restrict,
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed','expired','cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  time_spent_seconds integer,
  score numeric(8,2),
  max_score numeric(8,2),
  percentage numeric(5,2) check (percentage is null or percentage between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(participant_id, test_version_id)
);

create table if not exists public.employee_assessment_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.employee_assessment_sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  selected_option_id uuid references public.answer_options(id) on delete restrict,
  answer_text text,
  answer_json jsonb not null default '{}'::jsonb,
  is_correct boolean,
  points_awarded numeric(8,2),
  time_spent_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, question_id)
);

create table if not exists public.employee_assessment_test_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.employee_assessment_sessions(id) on delete cascade,
  participant_id uuid not null references public.employee_assessment_participants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  test_version_id uuid not null references public.test_versions(id) on delete restrict,
  raw_score numeric(8,2),
  max_score numeric(8,2),
  percentage numeric(5,2) check (percentage is null or percentage between 0 and 100),
  level text,
  summary text,
  requires_review boolean not null default false,
  created_at timestamptz not null default now(),
  unique(session_id)
);

create table if not exists public.employee_assessment_competency_scores (
  id uuid primary key default gen_random_uuid(),
  result_id uuid references public.employee_assessment_test_results(id) on delete cascade,
  participant_id uuid not null references public.employee_assessment_participants(id) on delete cascade,
  competency_key text not null,
  score numeric(8,2),
  max_score numeric(8,2),
  percentage numeric(5,2) check (percentage is null or percentage between 0 and 100),
  level text,
  interpretation text,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_assessment_competency_summary (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.employee_assessment_participants(id) on delete cascade,
  competency_key text not null,
  score numeric(8,2),
  max_score numeric(8,2),
  percentage numeric(5,2) check (percentage is null or percentage between 0 and 100),
  level text,
  weighted_score numeric(8,2),
  is_below_minimum boolean not null default false,
  created_at timestamptz not null default now(),
  unique(participant_id, competency_key)
);

create table if not exists public.employee_assessment_risk_flags (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.employee_assessment_participants(id) on delete cascade,
  risk_key text not null,
  risk_level text not null check (risk_level in ('low','medium','high')),
  title text not null,
  description text,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_assessment_reports (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.employee_assessment_participants(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  overall_score numeric(5,2),
  fit_score numeric(5,2),
  recommendation text,
  strengths_json jsonb not null default '[]'::jsonb,
  risks_json jsonb not null default '[]'::jsonb,
  suggested_roles_json jsonb not null default '[]'::jsonb,
  interview_questions_json jsonb not null default '[]'::jsonb,
  report_text text,
  created_at timestamptz not null default now(),
  unique(participant_id)
);

create index if not exists idx_employees_company_created_at
  on public.employees(company_id, created_at desc);
create unique index if not exists idx_employees_company_email_unique
  on public.employees(company_id, lower(email));
create index if not exists idx_employee_assessments_company_updated_at
  on public.employee_assessments(company_id, updated_at desc);
create index if not exists idx_employee_assessment_participants_assessment
  on public.employee_assessment_participants(employee_assessment_id, created_at desc);
create index if not exists idx_employee_assessment_invitations_token
  on public.employee_assessment_invitations(token);
create index if not exists idx_employee_assessment_sessions_participant
  on public.employee_assessment_sessions(participant_id);
create index if not exists idx_employee_assessment_answers_session
  on public.employee_assessment_answers(session_id);
create unique index if not exists idx_employee_assessment_competency_scores_result_key_unique
  on public.employee_assessment_competency_scores(result_id, competency_key)
  where result_id is not null;

drop trigger if exists set_employees_updated_at on public.employees;
create trigger set_employees_updated_at before update on public.employees
for each row execute function public.set_updated_at();

drop trigger if exists set_employee_assessments_updated_at on public.employee_assessments;
create trigger set_employee_assessments_updated_at before update on public.employee_assessments
for each row execute function public.set_updated_at();

drop trigger if exists set_employee_assessment_weights_updated_at on public.employee_assessment_competency_weights;
create trigger set_employee_assessment_weights_updated_at before update on public.employee_assessment_competency_weights
for each row execute function public.set_updated_at();

drop trigger if exists set_employee_assessment_participants_updated_at on public.employee_assessment_participants;
create trigger set_employee_assessment_participants_updated_at before update on public.employee_assessment_participants
for each row execute function public.set_updated_at();

drop trigger if exists set_employee_assessment_sessions_updated_at on public.employee_assessment_sessions;
create trigger set_employee_assessment_sessions_updated_at before update on public.employee_assessment_sessions
for each row execute function public.set_updated_at();

drop trigger if exists set_employee_assessment_answers_updated_at on public.employee_assessment_answers;
create trigger set_employee_assessment_answers_updated_at before update on public.employee_assessment_answers
for each row execute function public.set_updated_at();

drop trigger if exists prevent_employee_company_reassignment on public.employees;
create trigger prevent_employee_company_reassignment
before update of company_id on public.employees
for each row execute function public.prevent_company_reassignment();

drop trigger if exists prevent_employee_assessment_company_reassignment on public.employee_assessments;
create trigger prevent_employee_assessment_company_reassignment
before update of company_id on public.employee_assessments
for each row execute function public.prevent_company_reassignment();

drop trigger if exists prevent_employee_assessment_weight_company_reassignment on public.employee_assessment_competency_weights;
create trigger prevent_employee_assessment_weight_company_reassignment
before update of company_id on public.employee_assessment_competency_weights
for each row execute function public.prevent_company_reassignment();

drop trigger if exists prevent_employee_assessment_participant_company_reassignment on public.employee_assessment_participants;
create trigger prevent_employee_assessment_participant_company_reassignment
before update of company_id on public.employee_assessment_participants
for each row execute function public.prevent_company_reassignment();

drop trigger if exists prevent_employee_assessment_invitation_company_reassignment on public.employee_assessment_invitations;
create trigger prevent_employee_assessment_invitation_company_reassignment
before update of company_id on public.employee_assessment_invitations
for each row execute function public.prevent_company_reassignment();

create or replace function public.validate_employee_assessment_package_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.assessment_packages package
    where package.id = new.assessment_package_id
      and (
        (
          package.is_system = false
          and package.company_id = new.company_id
        )
        or (
          package.is_system = true
          and public.company_can_access_system_package(new.company_id, package.id)
        )
      )
  ) then
    raise exception 'Assessment package is not available to the employee assessment company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_employee_assessment_package_tenant on public.employee_assessments;
create trigger validate_employee_assessment_package_tenant
before insert or update of company_id, assessment_package_id on public.employee_assessments
for each row execute function public.validate_employee_assessment_package_tenant();

create or replace function public.validate_employee_assessment_weight_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.employee_assessments assessment
    where assessment.id = new.employee_assessment_id
      and assessment.company_id = new.company_id
  ) then
    raise exception 'Employee assessment weight must belong to its company assessment';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_employee_assessment_weight_tenant on public.employee_assessment_competency_weights;
create trigger validate_employee_assessment_weight_tenant
before insert or update of company_id, employee_assessment_id on public.employee_assessment_competency_weights
for each row execute function public.validate_employee_assessment_weight_tenant();

create or replace function public.validate_employee_assessment_participant_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.employee_assessments assessment
    where assessment.id = new.employee_assessment_id
      and assessment.company_id = new.company_id
  ) then
    raise exception 'Employee assessment participant assessment must belong to its company';
  end if;

  if not exists (
    select 1
    from public.employees employee
    where employee.id = new.employee_id
      and employee.company_id = new.company_id
  ) then
    raise exception 'Employee assessment participant employee must belong to its company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_employee_assessment_participant_tenant on public.employee_assessment_participants;
create trigger validate_employee_assessment_participant_tenant
before insert or update of company_id, employee_assessment_id, employee_id
on public.employee_assessment_participants
for each row execute function public.validate_employee_assessment_participant_tenant();

create or replace function public.validate_employee_assessment_invitation_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.employee_assessment_participants participant
    where participant.id = new.participant_id
      and participant.company_id = new.company_id
      and participant.employee_assessment_id = new.employee_assessment_id
      and participant.employee_id = new.employee_id
  ) then
    raise exception 'Employee assessment invitation must match its participant';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_employee_assessment_invitation_tenant on public.employee_assessment_invitations;
create trigger validate_employee_assessment_invitation_tenant
before insert or update of company_id, employee_assessment_id, employee_id, participant_id
on public.employee_assessment_invitations
for each row execute function public.validate_employee_assessment_invitation_tenant();

create or replace function public.validate_employee_assessment_session_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.employee_assessment_participants participant
    join public.employee_assessments assessment on assessment.id = participant.employee_assessment_id
    join public.assessment_package_tests package_test
      on package_test.package_id = assessment.assessment_package_id
     and package_test.test_version_id = new.test_version_id
    join public.test_versions version on version.id = package_test.test_version_id
    where participant.id = new.participant_id
      and participant.employee_id = new.employee_id
      and version.status = 'published'
  ) then
    raise exception 'Employee assessment session must use a published test assigned to the assessment package';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_employee_assessment_session_assignment on public.employee_assessment_sessions;
create trigger validate_employee_assessment_session_assignment
before insert or update of participant_id, employee_id, test_version_id
on public.employee_assessment_sessions
for each row execute function public.validate_employee_assessment_session_assignment();

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
      and question.id = new.question_id
  ) then
    raise exception 'Employee answers can be saved only for an active session question';
  end if;

  if new.selected_option_id is not null
     and not exists (
       select 1
       from public.answer_options option
       where option.id = new.selected_option_id
         and option.question_id = new.question_id
     ) then
    raise exception 'Selected option must belong to the question';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_employee_assessment_answer_assignment on public.employee_assessment_answers;
create trigger validate_employee_assessment_answer_assignment
before insert or update of session_id, question_id, selected_option_id, answer_text, answer_json
on public.employee_assessment_answers
for each row execute function public.validate_employee_assessment_answer_assignment();

create or replace function public.validate_employee_assessment_test_result_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.employee_assessment_sessions session
    where session.id = new.session_id
      and session.participant_id = new.participant_id
      and session.employee_id = new.employee_id
      and session.test_version_id = new.test_version_id
  ) then
    raise exception 'Employee assessment result must match its test session';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_employee_assessment_test_result_scope on public.employee_assessment_test_results;
create trigger validate_employee_assessment_test_result_scope
before insert or update of session_id, participant_id, employee_id, test_version_id
on public.employee_assessment_test_results
for each row execute function public.validate_employee_assessment_test_result_scope();

create or replace function public.validate_employee_assessment_competency_score_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.result_id is not null
    and not exists (
      select 1
      from public.employee_assessment_test_results result
      where result.id = new.result_id
        and result.participant_id = new.participant_id
    ) then
    raise exception 'Employee competency score must match its participant result';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_employee_assessment_competency_score_scope on public.employee_assessment_competency_scores;
create trigger validate_employee_assessment_competency_score_scope
before insert or update of result_id, participant_id on public.employee_assessment_competency_scores
for each row execute function public.validate_employee_assessment_competency_score_scope();

create or replace function public.validate_employee_assessment_report_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.employee_assessment_participants participant
    where participant.id = new.participant_id
      and participant.employee_id = new.employee_id
  ) then
    raise exception 'Employee assessment report must match its participant';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_employee_assessment_report_scope on public.employee_assessment_reports;
create trigger validate_employee_assessment_report_scope
before insert or update of participant_id, employee_id on public.employee_assessment_reports
for each row execute function public.validate_employee_assessment_report_scope();

create or replace function public.invite_employee_to_assessment(
  target_company_id uuid,
  target_employee_assessment_id uuid,
  employee_full_name text,
  employee_email text,
  employee_phone text default null,
  employee_department text default null,
  employee_role_title text default null,
  invitation_expires_at timestamptz default null
)
returns table (
  created_employee_id uuid,
  created_participant_id uuid,
  created_invitation_id uuid,
  invitation_token text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(employee_email));
  selected_employee_id uuid;
  selected_participant_id uuid;
  selected_participant_status text;
  generated_token text;
  effective_expires_at timestamptz := coalesce(invitation_expires_at, now() + interval '7 days');
begin
  if not public.can_manage_company_resources(target_company_id) then
    raise exception 'User cannot invite employees for this company';
  end if;

  if btrim(coalesce(employee_full_name, '')) = '' or normalized_email = '' then
    raise exception 'Employee name and email are required';
  end if;

  if effective_expires_at <= now() then
    raise exception 'Invitation expiration must be in the future';
  end if;

  if not exists (
    select 1
    from public.employee_assessments assessment
    join public.assessment_packages package on package.id = assessment.assessment_package_id
    where assessment.id = target_employee_assessment_id
      and assessment.company_id = target_company_id
      and assessment.status = 'active'
      and (
        (
          package.is_system = false
          and package.company_id = target_company_id
        )
        or (
          package.is_system = true
          and public.company_can_access_system_package(target_company_id, package.id)
        )
      )
  ) then
    raise exception 'Employee assessment is unavailable for invitations or has no assessment package';
  end if;

  select employee.id
  into selected_employee_id
  from public.employees employee
  where employee.company_id = target_company_id
    and lower(employee.email) = normalized_email
  limit 1
  for update;

  if selected_employee_id is null then
    insert into public.employees (
      company_id,
      full_name,
      email,
      phone,
      department,
      role_title
    )
    values (
      target_company_id,
      btrim(employee_full_name),
      normalized_email,
      nullif(btrim(employee_phone), ''),
      nullif(btrim(employee_department), ''),
      nullif(btrim(employee_role_title), '')
    )
    returning id into selected_employee_id;
  else
    update public.employees
    set
      full_name = btrim(employee_full_name),
      phone = coalesce(nullif(btrim(employee_phone), ''), phone),
      department = coalesce(nullif(btrim(employee_department), ''), department),
      role_title = coalesce(nullif(btrim(employee_role_title), ''), role_title)
    where id = selected_employee_id;
  end if;

  select participant.id, participant.status
  into selected_participant_id, selected_participant_status
  from public.employee_assessment_participants participant
  where participant.employee_assessment_id = target_employee_assessment_id
    and participant.employee_id = selected_employee_id
  for update;

  if selected_participant_id is null then
    insert into public.employee_assessment_participants (
      company_id,
      employee_assessment_id,
      employee_id,
      status,
      current_stage
    )
    values (
      target_company_id,
      target_employee_assessment_id,
      selected_employee_id,
      'invited',
      'invitation'
    )
    returning id into selected_participant_id;
  elsif selected_participant_status in ('completed', 'cancelled', 'archived') then
    raise exception 'This employee assessment participant cannot receive a new invitation';
  end if;

  if exists (
    select 1
    from public.employee_assessment_invitations invitation
    where invitation.participant_id = selected_participant_id
      and invitation.status in ('started', 'completed')
  ) then
    raise exception 'Employee has already started the assessment';
  end if;

  update public.employee_assessment_invitations
  set status = 'cancelled'
  where participant_id = selected_participant_id
    and status in ('created', 'sent', 'opened');

  generated_token := encode(gen_random_bytes(32), 'hex');

  insert into public.employee_assessment_invitations (
    company_id,
    employee_assessment_id,
    employee_id,
    participant_id,
    token,
    status,
    expires_at,
    sent_at
  )
  values (
    target_company_id,
    target_employee_assessment_id,
    selected_employee_id,
    selected_participant_id,
    generated_token,
    'sent',
    effective_expires_at,
    now()
  )
  returning id into created_invitation_id;

  created_employee_id := selected_employee_id;
  created_participant_id := selected_participant_id;
  invitation_token := generated_token;
  return next;
end;
$$;

alter table public.employees enable row level security;
alter table public.employee_assessments enable row level security;
alter table public.employee_assessment_competency_weights enable row level security;
alter table public.employee_assessment_participants enable row level security;
alter table public.employee_assessment_invitations enable row level security;
alter table public.employee_assessment_sessions enable row level security;
alter table public.employee_assessment_answers enable row level security;
alter table public.employee_assessment_test_results enable row level security;
alter table public.employee_assessment_competency_scores enable row level security;
alter table public.employee_assessment_competency_summary enable row level security;
alter table public.employee_assessment_risk_flags enable row level security;
alter table public.employee_assessment_reports enable row level security;

drop policy if exists "members can read employees" on public.employees;
create policy "members can read employees"
on public.employees for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists "recruiters can manage employees" on public.employees;
create policy "recruiters can manage employees"
on public.employees for all to authenticated
using (public.can_manage_company_resources(company_id))
with check (public.can_manage_company_resources(company_id));

drop policy if exists "members can read employee assessments" on public.employee_assessments;
create policy "members can read employee assessments"
on public.employee_assessments for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists "recruiters can manage employee assessments" on public.employee_assessments;
create policy "recruiters can manage employee assessments"
on public.employee_assessments for all to authenticated
using (public.can_manage_company_resources(company_id))
with check (public.can_manage_company_resources(company_id));

drop policy if exists "members can read employee assessment weights" on public.employee_assessment_competency_weights;
create policy "members can read employee assessment weights"
on public.employee_assessment_competency_weights for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists "recruiters can manage employee assessment weights" on public.employee_assessment_competency_weights;
create policy "recruiters can manage employee assessment weights"
on public.employee_assessment_competency_weights for all to authenticated
using (public.can_manage_company_resources(company_id))
with check (public.can_manage_company_resources(company_id));

drop policy if exists "members can read employee assessment participants" on public.employee_assessment_participants;
create policy "members can read employee assessment participants"
on public.employee_assessment_participants for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists "recruiters can manage employee assessment participants" on public.employee_assessment_participants;
create policy "recruiters can manage employee assessment participants"
on public.employee_assessment_participants for all to authenticated
using (public.can_manage_company_resources(company_id))
with check (public.can_manage_company_resources(company_id));

drop policy if exists "recruiters can read employee assessment invitations" on public.employee_assessment_invitations;
create policy "recruiters can read employee assessment invitations"
on public.employee_assessment_invitations for select to authenticated
using (public.can_manage_company_resources(company_id));

drop policy if exists "recruiters can manage employee assessment invitations" on public.employee_assessment_invitations;
create policy "recruiters can manage employee assessment invitations"
on public.employee_assessment_invitations for all to authenticated
using (public.can_manage_company_resources(company_id))
with check (public.can_manage_company_resources(company_id));

drop policy if exists "members can read employee assessment sessions" on public.employee_assessment_sessions;
create policy "members can read employee assessment sessions"
on public.employee_assessment_sessions for select to authenticated
using (
  exists (
    select 1
    from public.employee_assessment_participants participant
    where participant.id = employee_assessment_sessions.participant_id
      and public.is_company_member(participant.company_id)
  )
);

drop policy if exists "members can read employee assessment answers" on public.employee_assessment_answers;
create policy "members can read employee assessment answers"
on public.employee_assessment_answers for select to authenticated
using (
  exists (
    select 1
    from public.employee_assessment_sessions session
    join public.employee_assessment_participants participant on participant.id = session.participant_id
    where session.id = employee_assessment_answers.session_id
      and public.is_company_member(participant.company_id)
  )
);

drop policy if exists "members can read employee assessment test results" on public.employee_assessment_test_results;
create policy "members can read employee assessment test results"
on public.employee_assessment_test_results for select to authenticated
using (
  exists (
    select 1
    from public.employee_assessment_participants participant
    where participant.id = employee_assessment_test_results.participant_id
      and public.is_company_member(participant.company_id)
  )
);

drop policy if exists "members can read employee competency scores" on public.employee_assessment_competency_scores;
create policy "members can read employee competency scores"
on public.employee_assessment_competency_scores for select to authenticated
using (
  exists (
    select 1
    from public.employee_assessment_participants participant
    where participant.id = employee_assessment_competency_scores.participant_id
      and public.is_company_member(participant.company_id)
  )
);

drop policy if exists "members can read employee competency summary" on public.employee_assessment_competency_summary;
create policy "members can read employee competency summary"
on public.employee_assessment_competency_summary for select to authenticated
using (
  exists (
    select 1
    from public.employee_assessment_participants participant
    where participant.id = employee_assessment_competency_summary.participant_id
      and public.is_company_member(participant.company_id)
  )
);

drop policy if exists "members can read employee risk flags" on public.employee_assessment_risk_flags;
create policy "members can read employee risk flags"
on public.employee_assessment_risk_flags for select to authenticated
using (
  exists (
    select 1
    from public.employee_assessment_participants participant
    where participant.id = employee_assessment_risk_flags.participant_id
      and public.is_company_member(participant.company_id)
  )
);

drop policy if exists "members can read employee reports" on public.employee_assessment_reports;
create policy "members can read employee reports"
on public.employee_assessment_reports for select to authenticated
using (
  exists (
    select 1
    from public.employee_assessment_participants participant
    where participant.id = employee_assessment_reports.participant_id
      and public.is_company_member(participant.company_id)
  )
);

revoke all on function public.validate_employee_assessment_package_tenant() from public, anon, authenticated;
revoke all on function public.validate_employee_assessment_weight_tenant() from public, anon, authenticated;
revoke all on function public.validate_employee_assessment_participant_tenant() from public, anon, authenticated;
revoke all on function public.validate_employee_assessment_invitation_tenant() from public, anon, authenticated;
revoke all on function public.validate_employee_assessment_session_assignment() from public, anon, authenticated;
revoke all on function public.validate_employee_assessment_answer_assignment() from public, anon, authenticated;
revoke all on function public.validate_employee_assessment_test_result_scope() from public, anon, authenticated;
revoke all on function public.validate_employee_assessment_competency_score_scope() from public, anon, authenticated;
revoke all on function public.validate_employee_assessment_report_scope() from public, anon, authenticated;

revoke all on function public.invite_employee_to_assessment(uuid, uuid, text, text, text, text, text, timestamptz)
  from public, anon;
grant execute on function public.invite_employee_to_assessment(uuid, uuid, text, text, text, text, text, timestamptz)
  to authenticated;
