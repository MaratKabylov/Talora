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
order by check_name;
