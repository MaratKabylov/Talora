-- Public candidate flow: consent persistence and assessment integrity checks.

alter table public.invitations
  add column if not exists consent_given_at timestamptz,
  add column if not exists consent_version text;

alter table public.candidates
  add column if not exists profile_completed_at timestamptz;

drop trigger if exists set_test_sessions_updated_at on public.test_sessions;
create trigger set_test_sessions_updated_at before update on public.test_sessions
for each row execute function public.set_updated_at();

drop trigger if exists set_candidate_answers_updated_at on public.candidate_answers;
create trigger set_candidate_answers_updated_at before update on public.candidate_answers
for each row execute function public.set_updated_at();

create or replace function public.validate_test_session_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.candidate_applications application
    join public.jobs job on job.id = application.job_id
    join public.assessment_package_tests package_test
      on package_test.package_id = job.assessment_package_id
     and package_test.test_version_id = new.test_version_id
    join public.test_versions version on version.id = package_test.test_version_id
    where application.id = new.application_id
      and application.candidate_id = new.candidate_id
      and version.status = 'published'
  ) then
    raise exception 'Test session must use a published test assigned to the application job';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_test_session_assignment on public.test_sessions;
create trigger validate_test_session_assignment
before insert or update of application_id, candidate_id, test_version_id on public.test_sessions
for each row execute function public.validate_test_session_assignment();

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
      and question.id = new.question_id
  ) then
    raise exception 'Answers can be saved only for an active session question';
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

drop trigger if exists validate_candidate_answer_assignment on public.candidate_answers;
create trigger validate_candidate_answer_assignment
before insert or update of session_id, question_id, selected_option_id, answer_text, answer_json
on public.candidate_answers
for each row execute function public.validate_candidate_answer_assignment();

drop policy if exists "members can read test sessions" on public.test_sessions;
create policy "members can read test sessions"
on public.test_sessions for select to authenticated
using (
  exists (
    select 1
    from public.candidate_applications application
    where application.id = test_sessions.application_id
      and public.is_company_member(application.company_id)
  )
);

drop policy if exists "members can read candidate answers" on public.candidate_answers;
create policy "members can read candidate answers"
on public.candidate_answers for select to authenticated
using (
  exists (
    select 1
    from public.test_sessions session
    join public.candidate_applications application on application.id = session.application_id
    where session.id = candidate_answers.session_id
      and public.is_company_member(application.company_id)
  )
);
