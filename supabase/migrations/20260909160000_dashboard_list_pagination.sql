-- PERF-011: tenant-scoped, composable read functions. PostgREST applies filters,
-- keyset ordering and limit to these row sets without transferring grant ID arrays.
begin;

create or replace function public.list_company_test_templates(target_company_id uuid)
returns setof public.test_template_list
language sql stable security invoker set search_path = ''
as $$
  select template.* from public.test_template_list template
  where public.is_company_member(target_company_id)
    and (
      (template.company_id = target_company_id and not template.is_system)
      or (template.company_id is null and template.is_system
        and public.company_can_access_system_test(target_company_id, template.id))
    );
$$;

create or replace function public.list_company_assessment_packages(target_company_id uuid)
returns setof public.assessment_package_list
language sql stable security invoker set search_path = ''
as $$
  select package.* from public.assessment_package_list package
  where public.is_company_member(target_company_id)
    and (
      (package.company_id = target_company_id and not package.is_system)
      or (package.company_id is null and package.is_system
        and public.company_can_access_system_package(target_company_id, package.id))
    );
$$;

revoke all on function public.list_company_test_templates(uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_company_assessment_packages(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_company_test_templates(uuid) to authenticated;
grant execute on function public.list_company_assessment_packages(uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
