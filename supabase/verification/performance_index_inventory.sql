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
order by t.relname, c.relname;
