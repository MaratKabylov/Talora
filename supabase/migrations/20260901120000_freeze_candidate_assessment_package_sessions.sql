-- Freeze package settings for candidate sessions just as employee sessions do.
-- Nullable columns preserve a compatibility path for historical rows that
-- cannot be matched to one package without inventing history.

alter table public.test_sessions
  add column if not exists package_id uuid references public.assessment_packages(id) on delete restrict,
  add column if not exists package_order_index integer,
  add column if not exists package_weight numeric(6,4),
  add column if not exists package_is_required boolean,
  add column if not exists package_passing_score numeric(5,2),
  add column if not exists package_contributes_to_overall boolean;

alter table public.test_sessions
  drop constraint if exists test_sessions_package_order_index_check,
  add constraint test_sessions_package_order_index_check
    check (package_order_index is null or package_order_index >= 0),
  drop constraint if exists test_sessions_package_weight_check,
  add constraint test_sessions_package_weight_check
    check (package_weight is null or package_weight between 0 and 1),
  drop constraint if exists test_sessions_package_passing_score_check,
  add constraint test_sessions_package_passing_score_check
    check (package_passing_score is null or package_passing_score between 0 and 100);

with session_sets as (
  select
    session.application_id,
    array_agg(session.test_version_id order by session.test_version_id) as test_version_ids
  from public.test_sessions session
  where session.package_id is null
  group by session.application_id
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
    session_set.application_id,
    max(package_set.package_id::text)::uuid as package_id
  from session_sets session_set
  join package_sets package_set
    on package_set.test_version_ids = session_set.test_version_ids
  group by session_set.application_id
  having count(*) = 1
)
update public.test_sessions session
set
  package_id = unique_match.package_id,
  package_order_index = package_test.order_index,
  package_weight = package_test.weight,
  package_is_required = package_test.is_required,
  package_passing_score = package_test.passing_score,
  package_contributes_to_overall = package_test.contributes_to_overall
from unique_matches unique_match
join public.assessment_package_tests package_test
  on package_test.package_id = unique_match.package_id
where session.application_id = unique_match.application_id
  and session.test_version_id = package_test.test_version_id
  and session.package_id is null;

-- If every old session still belongs to the application's current package,
-- use that package as the legacy fallback. Ambiguous rows remain nullable.
update public.test_sessions session
set
  package_id = job.assessment_package_id,
  package_order_index = package_test.order_index,
  package_weight = package_test.weight,
  package_is_required = package_test.is_required,
  package_passing_score = package_test.passing_score,
  package_contributes_to_overall = package_test.contributes_to_overall
from public.candidate_applications application
join public.jobs job on job.id = application.job_id
join public.assessment_package_tests package_test
  on package_test.package_id = job.assessment_package_id
where session.application_id = application.id
  and session.test_version_id = package_test.test_version_id
  and session.package_id is null
  and not exists (
    select 1
    from public.test_sessions other_session
    where other_session.application_id = application.id
      and not exists (
        select 1
        from public.assessment_package_tests current_package_test
        where current_package_test.package_id = job.assessment_package_id
          and current_package_test.test_version_id = other_session.test_version_id
      )
  );

create or replace function public.freeze_test_session_package_configuration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select
    package_test.package_id,
    package_test.order_index,
    package_test.weight,
    package_test.is_required,
    package_test.passing_score,
    package_test.contributes_to_overall
  into
    new.package_id,
    new.package_order_index,
    new.package_weight,
    new.package_is_required,
    new.package_passing_score,
    new.package_contributes_to_overall
  from public.candidate_applications application
  join public.jobs job on job.id = application.job_id
  join public.assessment_packages package on package.id = job.assessment_package_id
  join public.assessment_package_tests package_test
    on package_test.package_id = job.assessment_package_id
   and package_test.test_version_id = new.test_version_id
  where application.id = new.application_id
    and application.candidate_id = new.candidate_id
  for key share of package;

  if new.package_id is null then
    raise exception 'Test session has no package configuration to freeze';
  end if;
  return new;
end;
$$;

drop trigger if exists freeze_test_session_package_configuration on public.test_sessions;
create trigger freeze_test_session_package_configuration
before insert on public.test_sessions
for each row execute function public.freeze_test_session_package_configuration();

create or replace function public.prevent_test_session_package_snapshot_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.package_id is not null and (
    new.package_id is distinct from old.package_id or
    new.package_order_index is distinct from old.package_order_index or
    new.package_weight is distinct from old.package_weight or
    new.package_is_required is distinct from old.package_is_required or
    new.package_passing_score is distinct from old.package_passing_score or
    new.package_contributes_to_overall is distinct from old.package_contributes_to_overall
  ) then
    raise exception 'Candidate package session snapshot is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_test_session_package_snapshot_update on public.test_sessions;
create trigger prevent_test_session_package_snapshot_update
before update of package_id, package_order_index, package_weight, package_is_required,
  package_passing_score, package_contributes_to_overall
on public.test_sessions
for each row execute function public.prevent_test_session_package_snapshot_update();
