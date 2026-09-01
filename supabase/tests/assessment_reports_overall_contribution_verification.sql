-- Run after 20260831120000_assessment_reports_and_overall_contribution.sql on a
-- staging copy. The block is read-only and rolls back automatically on failure.

begin;

do $$
declare
  invalid_count bigint;
begin
  select count(*)
  into invalid_count
  from public.assessment_package_tests package_test
  join public.test_versions version on version.id = package_test.test_version_id
  where (version.result_shape = 'profile' or version.scoring_type = 'competency_profile')
    and (package_test.contributes_to_overall or package_test.weight <> 0);

  if invalid_count > 0 then
    raise exception '% profile package rows still contribute to overall', invalid_count;
  end if;

  select count(*)
  into invalid_count
  from public.assessment_package_tests
  where contributes_to_overall = false
    and weight <> 0;

  if invalid_count > 0 then
    raise exception '% excluded package rows have a non-zero weight', invalid_count;
  end if;

  select count(*)
  into invalid_count
  from (
    select package_id
    from public.assessment_package_tests
    group by package_id
    having count(*) filter (where contributes_to_overall) > 0
      and abs(sum(weight) filter (where contributes_to_overall) - 1) > 0.0001
  ) invalid_package;

  if invalid_count > 0 then
    raise exception '% packages have contributing weights that do not sum to 1', invalid_count;
  end if;

  select count(*)
  into invalid_count
  from public.employee_assessment_sessions
  where package_contributes_to_overall is null;

  if invalid_count > 0 then
    raise exception '% employee sessions have no frozen overall flag', invalid_count;
  end if;
end;
$$;

rollback;
