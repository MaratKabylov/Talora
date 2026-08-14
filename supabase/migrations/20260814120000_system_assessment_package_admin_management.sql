-- Platform administration for system assessment packages.
-- Admin pages use the server-only service client after application role checks.

drop trigger if exists set_assessment_packages_updated_at on public.assessment_packages;
create trigger set_assessment_packages_updated_at
before update on public.assessment_packages
for each row execute function public.set_updated_at();

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
      and version.status = 'published'
      and (
        (
          package.is_system = true
          and package.company_id is null
          and template.is_system = true
          and template.company_id is null
          and template.status = 'active'
        )
        or (
          package.is_system = false
          and package.company_id is not null
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
        )
      )
  );
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

  update public.assessment_packages
  set updated_at = now()
  where id = target_package_id;
end;
$$;

revoke all on function public.replace_system_assessment_package_tests(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.replace_system_assessment_package_tests(uuid, jsonb)
  to service_role;
