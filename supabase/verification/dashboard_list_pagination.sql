-- Read-only PERF-011 deployment checks. Run after both PERF-010 and PERF-011.
with functions as (
  select p.*, n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('list_company_test_templates', 'list_company_assessment_packages')
)
select 'both_functions_exist' as check_name, count(*) = 2 as passed from functions
union all
select proname || ': invoker_stable_set', not prosecdef and provolatile = 's' and proretset from functions
union all
select proname || ': empty_search_path', proconfig @> array['search_path=""'] from functions
union all
select proname || ': authenticated_execute', has_function_privilege('authenticated', oid, 'execute') from functions
union all
select proname || ': no_anon_execute', not has_function_privilege('anon', oid, 'execute') from functions
union all
select proname || ': no_service_execute', not has_function_privilege('service_role', oid, 'execute') from functions
union all
select proname || ': no_public_execute', not exists (
  select 1 from aclexplode(coalesce(proacl, acldefault('f', proowner))) acl
  where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
) from functions;
