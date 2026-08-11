-- Candidate assessment integrity controls: server timer, single active client and audit events.

alter table public.test_versions
  drop constraint if exists published_test_versions_require_duration,
  add constraint published_test_versions_require_duration
    check (status <> 'published' or duration_minutes is not null) not valid;

alter table public.test_sessions
  add column if not exists deadline_at timestamptz,
  add column if not exists active_client_id_hash text,
  add column if not exists active_device_id_hash text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists last_heartbeat_at timestamptz,
  add column if not exists submission_reason text;

alter table public.test_sessions
  drop constraint if exists test_sessions_client_hash_format,
  add constraint test_sessions_client_hash_format
    check (active_client_id_hash is null or active_client_id_hash ~ '^[a-f0-9]{64}$'),
  drop constraint if exists test_sessions_device_hash_format,
  add constraint test_sessions_device_hash_format
    check (active_device_id_hash is null or active_device_id_hash ~ '^[a-f0-9]{64}$'),
  drop constraint if exists test_sessions_submission_reason_check,
  add constraint test_sessions_submission_reason_check
    check (submission_reason is null or submission_reason in ('candidate', 'time_expired'));

update public.test_sessions session
set deadline_at = session.started_at + make_interval(mins => version.duration_minutes)
from public.test_versions version
where version.id = session.test_version_id
  and session.status = 'in_progress'
  and session.started_at is not null
  and session.deadline_at is null
  and version.duration_minutes is not null;

create table if not exists public.assessment_session_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  application_id uuid not null references public.candidate_applications(id) on delete cascade,
  session_id uuid not null references public.test_sessions(id) on delete cascade,
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

create index if not exists idx_assessment_session_events_application_time
  on public.assessment_session_events(application_id, occurred_at);
create index if not exists idx_assessment_session_events_session_time
  on public.assessment_session_events(session_id, occurred_at);

create or replace function public.validate_assessment_session_event_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.test_sessions session
    join public.candidate_applications application on application.id = session.application_id
    where session.id = new.session_id
      and session.application_id = new.application_id
      and application.company_id = new.company_id
  ) then
    raise exception 'Assessment event must match its session, application and company';
  end if;

  if new.question_id is not null and not exists (
    select 1
    from public.test_sessions session
    join public.test_sections section on section.test_version_id = session.test_version_id
    join public.questions question on question.section_id = section.id
    where session.id = new.session_id
      and question.id = new.question_id
  ) then
    raise exception 'Assessment event question must belong to the session test version';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_assessment_session_event_scope on public.assessment_session_events;
create trigger validate_assessment_session_event_scope
before insert or update of company_id, application_id, session_id, question_id
on public.assessment_session_events
for each row execute function public.validate_assessment_session_event_scope();

-- Reject late answer writes even when a stale browser still holds the invitation token.
create or replace function public.validate_candidate_answer_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.test_sessions session
    join public.test_sections section on section.test_version_id = session.test_version_id
    join public.questions question on question.section_id = section.id
    where session.id = new.session_id
      and session.status = 'in_progress'
      and (session.deadline_at is null or session.deadline_at > now())
      and question.id = new.question_id
  ) then
    raise exception 'Answers can be saved only for an active session question before its deadline';
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

alter table public.assessment_session_events enable row level security;

drop policy if exists "members can read assessment session events"
on public.assessment_session_events;
create policy "members can read assessment session events"
on public.assessment_session_events for select to authenticated
using (public.is_company_member(company_id));

grant select on table public.assessment_session_events to authenticated;
revoke insert, update, delete on table public.assessment_session_events from anon, authenticated;
revoke all on function public.validate_assessment_session_event_scope() from public, anon, authenticated;
