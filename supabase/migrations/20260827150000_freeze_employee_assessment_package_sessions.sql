-- Freeze employee assessment package test settings when a participant starts.
-- Package edits must not change an assessment that is already in progress.

alter table public.employee_assessment_sessions
  add column if not exists package_id uuid references public.assessment_packages(id) on delete restrict,
  add column if not exists package_order_index integer,
  add column if not exists package_weight numeric(6,4),
  add column if not exists package_is_required boolean,
  add column if not exists package_passing_score numeric(5,2);

alter table public.employee_assessment_sessions
  drop constraint if exists employee_assessment_sessions_package_order_index_check,
  add constraint employee_assessment_sessions_package_order_index_check
    check (package_order_index is null or package_order_index >= 0),
  drop constraint if exists employee_assessment_sessions_package_weight_check,
  add constraint employee_assessment_sessions_package_weight_check
    check (package_weight is null or package_weight between 0 and 1),
  drop constraint if exists employee_assessment_sessions_package_passing_score_check,
  add constraint employee_assessment_sessions_package_passing_score_check
    check (package_passing_score is null or package_passing_score between 0 and 100);

-- First recover the original package when the complete session version set
-- uniquely matches one existing package. This also repairs assessments whose
-- package_id was switched while the participant was taking the tests.
with session_sets as (
  select
    session.participant_id,
    array_agg(session.test_version_id order by session.test_version_id) as test_version_ids
  from public.employee_assessment_sessions session
  where session.package_id is null
  group by session.participant_id
),
package_sets as (
  select
    package_test.package_id,
    array_agg(package_test.test_version_id order by package_test.test_version_id) as test_version_ids
  from public.assessment_package_tests package_test
  group by package_test.package_id
),
unique_matches as (
  select
    session_set.participant_id,
    max(package_set.package_id::text)::uuid as package_id
  from session_sets session_set
  join package_sets package_set
    on package_set.test_version_ids = session_set.test_version_ids
  group by session_set.participant_id
  having count(*) = 1
)
update public.employee_assessment_sessions session
set
  package_id = unique_match.package_id,
  package_order_index = package_test.order_index,
  package_weight = package_test.weight,
  package_is_required = package_test.is_required,
  package_passing_score = package_test.passing_score
from unique_matches unique_match
join public.assessment_package_tests package_test
  on package_test.package_id = unique_match.package_id
where session.participant_id = unique_match.participant_id
  and session.test_version_id = package_test.test_version_id
  and session.package_id is null;

-- A package may only have gained tests since the sessions were created. In that
-- case every historical session is still unambiguously configurable from the
-- current package, while newly added tests must not be appended to the attempt.
update public.employee_assessment_sessions session
set
  package_id = assessment.assessment_package_id,
  package_order_index = package_test.order_index,
  package_weight = package_test.weight,
  package_is_required = package_test.is_required,
  package_passing_score = package_test.passing_score
from public.employee_assessment_participants participant
join public.employee_assessments assessment
  on assessment.id = participant.employee_assessment_id
join public.assessment_package_tests package_test
  on package_test.package_id = assessment.assessment_package_id
where session.participant_id = participant.id
  and session.test_version_id = package_test.test_version_id
  and session.package_id is null
  and not exists (
    select 1
    from public.employee_assessment_sessions other_session
    where other_session.participant_id = participant.id
      and not exists (
        select 1
        from public.assessment_package_tests current_package_test
        where current_package_test.package_id = assessment.assessment_package_id
          and current_package_test.test_version_id = other_session.test_version_id
      )
  );

-- Rows that still cannot be matched remain nullable so the application can use
-- its legacy compatibility path without inventing historical scoring weights.

create or replace function public.prepare_employee_assessment_sessions(
  target_participant_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_employee_id uuid;
  selected_package_id uuid;
begin
  select
    participant.employee_id,
    assessment.assessment_package_id
  into
    selected_employee_id,
    selected_package_id
  from public.employee_assessment_participants participant
  join public.employee_assessments assessment
    on assessment.id = participant.employee_assessment_id
  where participant.id = target_participant_id
    and participant.status in ('invited', 'in_progress')
  for update of participant;

  if selected_employee_id is null or selected_package_id is null then
    raise exception 'Employee assessment participant is unavailable for session preparation';
  end if;

  -- Package replacement functions lock this row FOR UPDATE, so this lock makes
  -- reading the package and inserting every frozen session one atomic snapshot.
  perform 1
  from public.assessment_packages package
  where package.id = selected_package_id
  for key share;

  -- Once any session exists, the participant has already been bound to a package
  -- snapshot. Reopening the profile must never append tests added later.
  if exists (
    select 1
    from public.employee_assessment_sessions session
    where session.participant_id = target_participant_id
  ) then
    return;
  end if;

  insert into public.employee_assessment_sessions (
    participant_id,
    employee_id,
    test_version_id,
    status,
    package_id,
    package_order_index,
    package_weight,
    package_is_required,
    package_passing_score
  )
  select
    target_participant_id,
    selected_employee_id,
    package_test.test_version_id,
    'not_started',
    selected_package_id,
    package_test.order_index,
    package_test.weight,
    package_test.is_required,
    package_test.passing_score
  from public.assessment_package_tests package_test
  join public.test_versions version
    on version.id = package_test.test_version_id
  where package_test.package_id = selected_package_id
    and version.status = 'published'
  order by package_test.order_index, package_test.test_version_id;

  if not found then
    raise exception 'Employee assessment package has no published tests';
  end if;
end;
$$;

revoke all on function public.prepare_employee_assessment_sessions(uuid)
  from public, anon, authenticated;
grant execute on function public.prepare_employee_assessment_sessions(uuid)
  to service_role;
