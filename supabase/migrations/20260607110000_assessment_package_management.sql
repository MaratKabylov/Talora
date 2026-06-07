-- Company assessment package management.

create or replace function public.package_can_use_test_version(
  target_package_id uuid,
  target_test_version_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assessment_packages package
    join public.test_versions version on version.id = target_test_version_id
    join public.test_templates template on template.id = version.test_template_id
    where package.id = target_package_id
      and package.is_system = false
      and package.company_id is not null
      and version.status = 'published'
      and (
        (
          template.is_system = false
          and template.company_id = package.company_id
        )
        or (
          template.is_system = true
          and template.company_id is null
          and public.company_can_access_system_test(package.company_id, template.id)
        )
      )
  );
$$;

create or replace function public.validate_assessment_package_test_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.package_can_use_test_version(new.package_id, new.test_version_id) then
    raise exception 'Test version is not available to this assessment package';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_assessment_package_test_access on public.assessment_package_tests;
create trigger validate_assessment_package_test_access
before insert or update of package_id, test_version_id on public.assessment_package_tests
for each row execute function public.validate_assessment_package_test_access();

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
    coalesce(sum(entry.weight), 0)
  into test_count, distinct_test_count, total_weight
  from jsonb_to_recordset(package_tests) as entry(
    test_version_id uuid,
    order_index integer,
    weight numeric,
    is_required boolean,
    passing_score numeric
  );

  if test_count = 0 then
    raise exception 'Assessment package must include at least one test';
  end if;

  if distinct_test_count <> test_count then
    raise exception 'Assessment package cannot include the same test version twice';
  end if;

  if abs(total_weight - 1) > 0.0001 then
    raise exception 'Package test weights must sum to 100%%';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(package_tests) as entry(
      test_version_id uuid,
      order_index integer,
      weight numeric,
      is_required boolean,
      passing_score numeric
    )
    where entry.test_version_id is null
      or entry.order_index is null
      or entry.order_index < 0
      or entry.weight is null
      or entry.weight < 0
      or entry.weight > 1
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
    passing_score
  )
  select
    target_package_id,
    entry.test_version_id,
    entry.order_index,
    entry.weight,
    coalesce(entry.is_required, true),
    entry.passing_score
  from jsonb_to_recordset(package_tests) as entry(
    test_version_id uuid,
    order_index integer,
    weight numeric,
    is_required boolean,
    passing_score numeric
  );
end;
$$;

drop policy if exists "members can read package tests" on public.assessment_package_tests;
create policy "members can read package tests"
on public.assessment_package_tests for select to authenticated
using (
  exists (
    select 1
    from public.assessment_packages package
    where package.id = assessment_package_tests.package_id
      and (
        (
          package.is_system = true
          and public.current_user_can_access_system_package(package.id)
        )
        or (
          package.is_system = false
          and package.company_id is not null
          and public.is_company_member(package.company_id)
        )
      )
  )
);

drop policy if exists "recruiters can insert package tests" on public.assessment_package_tests;
create policy "recruiters can insert package tests"
on public.assessment_package_tests for insert to authenticated
with check (
  public.package_can_use_test_version(package_id, test_version_id)
  and exists (
    select 1
    from public.assessment_packages package
    where package.id = assessment_package_tests.package_id
      and package.is_system = false
      and package.company_id is not null
      and public.can_manage_company_resources(package.company_id)
  )
);

drop policy if exists "recruiters can update package tests" on public.assessment_package_tests;
create policy "recruiters can update package tests"
on public.assessment_package_tests for update to authenticated
using (
  exists (
    select 1
    from public.assessment_packages package
    where package.id = assessment_package_tests.package_id
      and package.is_system = false
      and package.company_id is not null
      and public.can_manage_company_resources(package.company_id)
  )
)
with check (
  public.package_can_use_test_version(package_id, test_version_id)
  and exists (
    select 1
    from public.assessment_packages package
    where package.id = assessment_package_tests.package_id
      and package.is_system = false
      and package.company_id is not null
      and public.can_manage_company_resources(package.company_id)
  )
);

drop policy if exists "recruiters can delete package tests" on public.assessment_package_tests;
create policy "recruiters can delete package tests"
on public.assessment_package_tests for delete to authenticated
using (
  exists (
    select 1
    from public.assessment_packages package
    where package.id = assessment_package_tests.package_id
      and package.is_system = false
      and package.company_id is not null
      and public.can_manage_company_resources(package.company_id)
  )
);

revoke all on function public.package_can_use_test_version(uuid, uuid) from public, anon;
revoke all on function public.validate_assessment_package_test_access() from public, anon, authenticated;
revoke all on function public.replace_assessment_package_tests(uuid, jsonb) from public, anon;

grant execute on function public.package_can_use_test_version(uuid, uuid) to authenticated;
grant execute on function public.replace_assessment_package_tests(uuid, jsonb) to authenticated;
