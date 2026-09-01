-- Dynamic assessment reports and explicit package contribution semantics.

alter table public.assessment_package_tests
  add column if not exists contributes_to_overall boolean not null default true;

comment on column public.assessment_package_tests.contributes_to_overall is
  'Whether this test contributes to the package overall score. Profile tests default to false.';

-- Preserve the deployed scoring behavior: competency profiles were excluded from
-- overall even when their historical package weight was non-zero.
update public.assessment_package_tests package_test
set contributes_to_overall = false
from public.test_versions version
where version.id = package_test.test_version_id
  and (
    version.result_shape = 'profile'
    or version.scoring_type = 'competency_profile'
  );

update public.assessment_package_tests
set weight = 0
where contributes_to_overall = false;

-- Normalize only contributing rows. The first row receives the rounding remainder
-- so every non-empty contributing set still sums to exactly 1.0000.
with contributing as (
  select
    package_test.id,
    package_test.package_id,
    package_test.weight,
    row_number() over (
      partition by package_test.package_id
      order by package_test.order_index, package_test.id
    ) as row_number,
    sum(package_test.weight) over (partition by package_test.package_id) as total_weight
  from public.assessment_package_tests package_test
  where package_test.contributes_to_overall = true
),
normalized as (
  select
    contributing.id,
    contributing.package_id,
    contributing.row_number,
    round(contributing.weight / contributing.total_weight, 4) as normalized_weight
  from contributing
  where contributing.total_weight > 0
),
adjusted as (
  select
    normalized.id,
    normalized.normalized_weight,
    normalized.row_number,
    sum(normalized.normalized_weight) over (partition by normalized.package_id) as rounded_total
  from normalized
)
update public.assessment_package_tests package_test
set weight = adjusted.normalized_weight + case
  when adjusted.row_number = 1 then 1 - adjusted.rounded_total
  else 0
end
from adjusted
where adjusted.id = package_test.id;

alter table public.employee_assessment_sessions
  add column if not exists package_contributes_to_overall boolean;

update public.employee_assessment_sessions session
set package_contributes_to_overall = not (
  coalesce(version.result_shape = 'profile', false)
  or version.scoring_type = 'competency_profile'
)
from public.test_versions version
where version.id = session.test_version_id
  and session.package_contributes_to_overall is null;

alter table public.employee_assessment_sessions
  alter column package_contributes_to_overall set default true,
  alter column package_contributes_to_overall set not null;

comment on column public.employee_assessment_sessions.package_contributes_to_overall is
  'Frozen contributes_to_overall value from the package when employee sessions are prepared.';

create or replace function public.replace_assessment_package_tests(
  target_package_id uuid,
  package_tests jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_company_id uuid;
  test_count integer;
  distinct_test_count integer;
  total_weight numeric;
begin
  select package.company_id
  into target_company_id
  from public.assessment_packages package
  where package.id = target_package_id
    and package.is_system = false
    and package.company_id is not null
    and public.can_manage_company_resources(package.company_id)
  for update;

  if target_company_id is null then
    raise exception 'User cannot manage this assessment package';
  end if;

  if jsonb_typeof(package_tests) is distinct from 'array' then
    raise exception 'Package tests must be an array';
  end if;

  select
    count(*),
    count(distinct entry.test_version_id),
    coalesce(sum(entry.weight) filter (where entry.contributes_to_overall), 0)
  into test_count, distinct_test_count, total_weight
  from jsonb_to_recordset(package_tests) as entry(
    test_version_id uuid,
    order_index integer,
    weight numeric,
    is_required boolean,
    passing_score numeric,
    contributes_to_overall boolean
  );

  if test_count = 0 then
    raise exception 'Assessment package must include at least one test';
  end if;

  if distinct_test_count <> test_count then
    raise exception 'Assessment package cannot include the same test version twice';
  end if;

  if abs(total_weight - 1) > 0.0001 then
    raise exception 'Contributing package test weights must sum to 100%%';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(package_tests) as entry(
      test_version_id uuid,
      order_index integer,
      weight numeric,
      is_required boolean,
      passing_score numeric,
      contributes_to_overall boolean
    )
    where entry.test_version_id is null
      or entry.order_index is null
      or entry.order_index < 0
      or entry.weight is null
      or entry.weight < 0
      or entry.weight > 1
      or entry.contributes_to_overall is null
      or (entry.contributes_to_overall = false and entry.weight <> 0)
      or (entry.passing_score is not null and (entry.passing_score < 0 or entry.passing_score > 100))
      or not public.package_can_use_test_version(target_package_id, entry.test_version_id)
  ) then
    raise exception 'Assessment package contains unavailable or invalid test settings';
  end if;

  delete from public.assessment_package_tests
  where package_id = target_package_id;

  insert into public.assessment_package_tests (
    package_id,
    test_version_id,
    order_index,
    weight,
    is_required,
    passing_score,
    contributes_to_overall
  )
  select
    target_package_id,
    entry.test_version_id,
    entry.order_index,
    entry.weight,
    coalesce(entry.is_required, true),
    entry.passing_score,
    entry.contributes_to_overall
  from jsonb_to_recordset(package_tests) as entry(
    test_version_id uuid,
    order_index integer,
    weight numeric,
    is_required boolean,
    passing_score numeric,
    contributes_to_overall boolean
  );
end;
$$;

create or replace function public.replace_system_assessment_package_tests(
  target_package_id uuid,
  package_tests jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_package_id uuid;
  test_count integer;
  distinct_test_count integer;
  total_weight numeric;
begin
  select package.id
  into selected_package_id
  from public.assessment_packages package
  where package.id = target_package_id
    and package.is_system = true
    and package.company_id is null
  for update;

  if selected_package_id is null then
    raise exception 'System assessment package was not found';
  end if;

  if jsonb_typeof(package_tests) is distinct from 'array' then
    raise exception 'Package tests must be an array';
  end if;

  select
    count(*),
    count(distinct entry.test_version_id),
    coalesce(sum(entry.weight) filter (where entry.contributes_to_overall), 0)
  into test_count, distinct_test_count, total_weight
  from jsonb_to_recordset(package_tests) as entry(
    test_version_id uuid,
    order_index integer,
    weight numeric,
    is_required boolean,
    passing_score numeric,
    contributes_to_overall boolean
  );

  if test_count = 0 then
    raise exception 'Assessment package must include at least one test';
  end if;

  if distinct_test_count <> test_count then
    raise exception 'Assessment package cannot include the same test version twice';
  end if;

  if abs(total_weight - 1) > 0.0001 then
    raise exception 'Contributing package test weights must sum to 100%%';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(package_tests) as entry(
      test_version_id uuid,
      order_index integer,
      weight numeric,
      is_required boolean,
      passing_score numeric,
      contributes_to_overall boolean
    )
    where entry.test_version_id is null
      or entry.order_index is null
      or entry.order_index < 0
      or entry.weight is null
      or entry.weight < 0
      or entry.weight > 1
      or entry.contributes_to_overall is null
      or (entry.contributes_to_overall = false and entry.weight <> 0)
      or (entry.passing_score is not null and (entry.passing_score < 0 or entry.passing_score > 100))
      or not public.package_can_use_test_version(target_package_id, entry.test_version_id)
  ) then
    raise exception 'Assessment package contains unavailable or invalid system test settings';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(package_tests) as entry(test_version_id uuid)
    join public.test_versions version on version.id = entry.test_version_id
    group by version.test_template_id
    having count(*) > 1
  ) then
    raise exception 'Assessment package cannot include multiple versions of the same test';
  end if;

  delete from public.assessment_package_tests
  where package_id = target_package_id;

  insert into public.assessment_package_tests (
    package_id,
    test_version_id,
    order_index,
    weight,
    is_required,
    passing_score,
    contributes_to_overall
  )
  select
    target_package_id,
    entry.test_version_id,
    entry.order_index,
    entry.weight,
    coalesce(entry.is_required, true),
    entry.passing_score,
    entry.contributes_to_overall
  from jsonb_to_recordset(package_tests) as entry(
    test_version_id uuid,
    order_index integer,
    weight numeric,
    is_required boolean,
    passing_score numeric,
    contributes_to_overall boolean
  );

  update public.assessment_packages
  set updated_at = now()
  where id = target_package_id;
end;
$$;

revoke all on function public.replace_assessment_package_tests(uuid, jsonb) from public, anon;
grant execute on function public.replace_assessment_package_tests(uuid, jsonb) to authenticated;
revoke all on function public.replace_system_assessment_package_tests(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_system_assessment_package_tests(uuid, jsonb)
  to service_role;

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

  perform 1
  from public.assessment_packages package
  where package.id = selected_package_id
  for key share;

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
    package_passing_score,
    package_contributes_to_overall
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
    package_test.passing_score,
    package_test.contributes_to_overall
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

-- Historical reports remain readable through their stored sessions even when a
-- company no longer has library access to the source system test. This keeps the
-- report independent from removed legacy server keys without exposing other tenants.
create or replace function public.current_user_has_historical_test_version_access(
  target_test_version_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.test_sessions session
      join public.candidate_applications application on application.id = session.application_id
      join public.company_users membership on membership.company_id = application.company_id
      where session.test_version_id = target_test_version_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
    )
    or exists (
      select 1
      from public.employee_assessment_sessions session
      join public.employee_assessment_participants participant on participant.id = session.participant_id
      join public.company_users membership on membership.company_id = participant.company_id
      where session.test_version_id = target_test_version_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
    );
$$;

create or replace function public.current_user_has_historical_test_template_access(
  target_test_template_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.test_versions version
    where version.test_template_id = target_test_template_id
      and public.current_user_has_historical_test_version_access(version.id)
  );
$$;

revoke all on function public.current_user_has_historical_test_version_access(uuid)
  from public, anon;
revoke all on function public.current_user_has_historical_test_template_access(uuid)
  from public, anon;
grant execute on function public.current_user_has_historical_test_version_access(uuid)
  to authenticated;
grant execute on function public.current_user_has_historical_test_template_access(uuid)
  to authenticated;

drop policy if exists "members can read historical assessment test versions" on public.test_versions;
create policy "members can read historical assessment test versions"
on public.test_versions for select to authenticated
using (public.current_user_has_historical_test_version_access(id));

drop policy if exists "members can read historical assessment test templates" on public.test_templates;
create policy "members can read historical assessment test templates"
on public.test_templates for select to authenticated
using (public.current_user_has_historical_test_template_access(id));

drop policy if exists "members can read historical assessment questions" on public.questions;
create policy "members can read historical assessment questions"
on public.questions for select to authenticated
using (
  exists (
    select 1
    from public.candidate_answers answer
    join public.test_sessions session on session.id = answer.session_id
    join public.candidate_applications application on application.id = session.application_id
    where answer.question_id = questions.id
      and public.is_company_member(application.company_id)
  )
  or exists (
    select 1
    from public.employee_assessment_answers answer
    join public.employee_assessment_sessions session on session.id = answer.session_id
    join public.employee_assessment_participants participant on participant.id = session.participant_id
    where answer.question_id = questions.id
      and public.is_company_member(participant.company_id)
  )
);

drop policy if exists "members can read historical assessment answer options" on public.answer_options;
create policy "members can read historical assessment answer options"
on public.answer_options for select to authenticated
using (
  exists (
    select 1
    from public.candidate_answers answer
    join public.test_sessions session on session.id = answer.session_id
    join public.candidate_applications application on application.id = session.application_id
    where answer.question_id = answer_options.question_id
      and public.is_company_member(application.company_id)
  )
  or exists (
    select 1
    from public.employee_assessment_answers answer
    join public.employee_assessment_sessions session on session.id = answer.session_id
    join public.employee_assessment_participants participant on participant.id = session.participant_id
    where answer.question_id = answer_options.question_id
      and public.is_company_member(participant.company_id)
  )
);
