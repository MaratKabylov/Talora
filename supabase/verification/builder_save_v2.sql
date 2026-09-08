-- READ ONLY. Run after the PERF-008.1 migration on a fully migrated staging DB.
-- All `passed` values must be true. Does not enroll, save or publish any version.
select 'revision_column' check_name, exists (
  select 1 from information_schema.columns where table_schema='public'
    and table_name='test_versions' and column_name='builder_revision'
    and data_type='bigint' and is_nullable='NO'
) passed
union all
select 'private_state_rls', coalesce((select relrowsecurity from pg_class
  where oid=to_regclass('public.builder_save_state')),false)
union all
select 'rpc_service_only', coalesce((select
  has_function_privilege('service_role',p.oid,'EXECUTE')
  and not has_function_privilege('anon',p.oid,'EXECUTE')
  and not has_function_privilege('authenticated',p.oid,'EXECUTE')
  and not p.prosecdef and p.proconfig @> array['search_path=""']
  from pg_proc p where p.oid=to_regprocedure('public.save_builder_delta_v2(uuid,uuid,uuid,uuid,bigint,uuid,jsonb)')),false)
union all
select 'state_not_client_accessible', coalesce((select
  not has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
  from pg_class c where c.oid=to_regclass('public.builder_save_state')),false)
union all
select 'private_helpers', count(*)=3 and coalesce(bool_and(
  not has_function_privilege('anon',p.oid,'EXECUTE')
  and not has_function_privilege('authenticated',p.oid,'EXECUTE')
  and p.prosecdef and p.proconfig @> array['search_path=""']),false)
from pg_proc p where p.oid in (
  to_regprocedure('public.guard_builder_version_revision()'),
  to_regprocedure('public.guard_builder_content_revision()'),
  to_regprocedure('public.touch_builder_content_revision(uuid)'))
union all
select 'revision_triggers', count(*)=4 and coalesce(bool_and(t.tgenabled='O'),false)
from pg_trigger t where not t.tgisinternal and (
  (t.tgrelid=to_regclass('public.test_versions') and t.tgname='aa_guard_builder_version_revision')
  or (t.tgrelid in (to_regclass('public.test_sections'),to_regclass('public.questions'),to_regclass('public.answer_options'))
    and t.tgname='aa_guard_builder_content_revision'));

-- Normally zero until V2 callers are implemented and deliberately enabled.
select count(*) enrolled_versions,
  count(*) filter (where write_transaction is not null) unfinished_writes
from public.builder_save_state;
