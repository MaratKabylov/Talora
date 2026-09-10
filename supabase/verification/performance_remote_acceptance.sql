-- Current-project PERF-010/011 checks and PERF-012 index inventory.
-- Paste the entire file into Supabase SQL Editor. Returns one JSON cell.
-- Read-only transaction; no business rows, tokens, credentials or SQL statistics text.
-- Composed from the three existing verification scripts; keep their checks in sync.
begin read only;
set local statement_timeout = '15s';
set local lock_timeout = '3s';
select jsonb_build_object(
  'checked_at', now(),
  'server_version', current_setting('server_version'),
  'postgrest_plan_setting', current_setting('pgrst.db_plan_enabled', true),
  'perf010_checks', (select coalesce(jsonb_agg(to_jsonb(result)), '[]'::jsonb) from (
-- Read-only deployment verification. Every row must have passed = true.
with expected(name, columns) as (values
  ('test_template_list', array['id','company_id','title','category','is_system','status','updated_at',
    'latest_version_id','latest_version_number','latest_version_status','published_version_id',
    'published_version_number','published_version_status','version_count','has_draft']),
  ('assessment_package_list', array['id','company_id','title','is_system','updated_at','test_count','required_count','duration_minutes']),
  ('employee_assessment_list', array['id','company_id','title','status','updated_at','assessment_package_title','participant_count','completed_count','average_fit_score']),
  ('job_comparison_summary', array['id','company_id','participant_count','completed_count','shortlisted_count','average_fit_score']),
  ('employee_comparison_filters', array['id','company_id','departments','role_titles'])
), checks as (
  select e.name, c.oid, c.relkind, c.reloptions, e.columns,
    (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as actual_columns
  from expected e left join pg_class c on c.oid = to_regclass('public.' || e.name)
)
select name || ': invoker view and column contract' as check_name,
  coalesce(relkind = 'v' and reloptions @> array['security_invoker=true'] and actual_columns = columns, false) as passed
from checks
union all
select name || ': SELECT-only grants', coalesce(
  has_table_privilege('authenticated', oid, 'SELECT') and has_table_privilege('service_role', oid, 'SELECT')
  and not has_table_privilege('anon', oid, 'SELECT')
  and not has_table_privilege('authenticated', oid, 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role', oid, 'INSERT,UPDATE,DELETE'), false)
from checks
union all
select table_name || ': base RLS enabled', coalesce(c.relrowsecurity, false)
from unnest(array['jobs','candidate_applications','test_templates','test_versions','assessment_packages',
  'assessment_package_tests','employees','employee_assessments','employee_assessment_participants']) table_name
left join pg_class c on c.oid = to_regclass('public.' || table_name)
order by check_name
  ) result),
  'perf011_checks', (select coalesce(jsonb_agg(to_jsonb(result)), '[]'::jsonb) from (
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
) from functions
  ) result),
  'indexes', (select coalesce(jsonb_agg(to_jsonb(result)), '[]'::jsonb) from (
-- PERF-012: read-only inventory, no user rows, SQL text, tokens or PII.
-- Run on staging before proposing index DDL. Repository migrations alone do not
-- establish which indexes are present, valid or used in the deployed database.
select
  t.relname as table_name,
  c.relname as index_name,
  pg_get_indexdef(i.indexrelid) as definition,
  i.indisvalid as is_valid,
  i.indisready as is_ready,
  i.indisunique as is_unique,
  pg_relation_size(i.indexrelid) as index_bytes,
  pg_relation_size(i.indrelid) as table_bytes,
  s.idx_scan,
  s.idx_tup_read,
  s.idx_tup_fetch,
  d.stats_reset,
  i.indkey::text as key_columns,
  i.indclass::text as operator_classes,
  i.indcollation::text as collations,
  i.indoption::text as sort_options,
  pg_get_expr(i.indpred, i.indrelid) as predicate,
  pg_get_expr(i.indexprs, i.indrelid) as expressions
from pg_index i
join pg_class c on c.oid = i.indexrelid
join pg_class t on t.oid = i.indrelid
join pg_namespace n on n.oid = t.relnamespace
left join pg_stat_user_indexes s on s.indexrelid = i.indexrelid
left join pg_stat_database d on d.datname = current_database()
where n.nspname = 'public'
  and t.relname in (
    'jobs', 'candidate_applications', 'test_sections', 'questions', 'answer_options',
    'employee_assessments', 'employee_assessment_participants', 'test_templates',
    'test_versions', 'assessment_packages', 'assessment_package_tests',
    'companies', 'profiles', 'platform_audit_logs', 'invitations',
    'employee_assessment_invitations'
  )
order by t.relname, c.relname
  ) result)
) as verification;
commit;
