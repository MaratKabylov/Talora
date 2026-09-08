-- READ ONLY. Run after BOTH builder V2 migrations. Every passed value must be true.
select expected.signature check_name, coalesce(
  has_function_privilege('service_role',p.oid,'EXECUTE')
  and not has_function_privilege('anon',p.oid,'EXECUTE')
  and not has_function_privilege('authenticated',p.oid,'EXECUTE')
  and not p.prosecdef and p.proconfig @> array['search_path=""'],false) passed
from (values
  ('public.lock_builder_version_v2(uuid,uuid,uuid,uuid)'),
  ('public.read_builder_snapshot_v2(uuid,uuid,uuid,uuid)'),
  ('public.commit_builder_delta_v2(uuid,uuid,uuid,uuid,bigint,uuid,text,jsonb)'),
  ('public.publish_builder_version_v2(uuid,uuid,uuid,uuid,bigint,uuid,text)')
) expected(signature) left join pg_proc p on p.oid=to_regprocedure(expected.signature);

select 'browser_and_publication_receipts' check_name, count(*)=3 passed
from information_schema.columns where table_schema='public' and table_name='builder_save_state'
  and column_name in ('client_payload_hash','publication_request_id','published_from_revision');

select count(*) enrolled_versions,
  count(*) filter (where write_transaction is not null) unfinished_writes
from public.builder_save_state;
