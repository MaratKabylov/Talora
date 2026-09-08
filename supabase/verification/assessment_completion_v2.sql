-- READ ONLY. Run AFTER the completion migration. Never run tests/fixtures in Supabase.
-- Both values must be true. Does not invoke completion or change any data.
with expected(signature) as (
  values ('public.complete_assessment_session_v2(text,text,uuid,text,text)')
)
select expected.signature, p.oid is not null as installed,
  coalesce(p.prosecdef and p.proconfig @> array['search_path=""']
    and not has_function_privilege('anon',p.oid,'execute')
    and not has_function_privilege('authenticated',p.oid,'execute')
    and has_function_privilege('service_role',p.oid,'execute'),false) as permissions_ok
from expected left join pg_catalog.pg_proc p on p.oid = to_regprocedure(expected.signature);
