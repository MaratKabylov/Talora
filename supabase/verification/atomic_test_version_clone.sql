-- READ ONLY. Run after PERF-008.1, PERF-008.2 and PERF-009 migrations.
-- Every passed value must be true. Does not inspect content or personal data.
select 'clone_rpc_service_only' check_name, coalesce(
  has_function_privilege('service_role', p.oid, 'EXECUTE')
  and not has_function_privilege('anon', p.oid, 'EXECUTE')
  and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
  and not p.prosecdef and p.proconfig @> array['search_path=""'], false) passed
from (values ('public.clone_published_test_version(uuid,uuid,uuid,uuid)')) expected(signature)
left join pg_proc p on p.oid = to_regprocedure(expected.signature);

select 'clone_temp_privilege' check_name,
  has_database_privilege('service_role', current_database(), 'TEMP') passed;

select expected.table_name || '_content_guards' check_name, count(t.oid) = 2 passed
from (values ('test_versions', 'protect_published_test_version', 'aa_guard_builder_version_revision'),
  ('test_sections', 'protect_published_test_sections', 'aa_guard_builder_content_revision'),
  ('questions', 'protect_published_questions', 'aa_guard_builder_content_revision'),
  ('answer_options', 'protect_published_answer_options', 'aa_guard_builder_content_revision'))
  expected(table_name, publication_trigger, revision_trigger)
left join pg_trigger t on t.tgrelid = to_regclass('public.' || expected.table_name)
  and t.tgname in (expected.publication_trigger, expected.revision_trigger)
  and t.tgenabled = 'O' and not t.tgisinternal
group by expected.table_name;

select expected.table_name || '_service_access' check_name,
  bool_and(has_table_privilege('service_role', 'public.' || expected.table_name, required.privilege)) passed
from (values ('test_templates','SELECT,UPDATE'), ('test_versions','SELECT,INSERT,UPDATE'),
  ('test_sections','SELECT,INSERT'), ('questions','SELECT,INSERT'), ('answer_options','SELECT,INSERT'),
  ('companies','SELECT,UPDATE'), ('company_users','SELECT,UPDATE'), ('platform_users','SELECT,UPDATE'),
  ('platform_audit_logs','INSERT')) expected(table_name, privileges)
cross join lateral unnest(string_to_array(expected.privileges, ',')) required(privilege)
group by expected.table_name;
