-- READ ONLY. Run AFTER 20260907150000_assessment_section_save_v2.sql.
with expected(signature) as (
  values ('public.save_assessment_section_v2(text,text,uuid,text,text,uuid,jsonb,text)')
)
select expected.signature, procedure.oid is not null as installed,
  coalesce(procedure.prosecdef and procedure.proconfig @> array['search_path=""']
    and not has_function_privilege('anon', procedure.oid, 'execute')
    and not has_function_privilege('authenticated', procedure.oid, 'execute')
    and has_function_privilege('service_role', procedure.oid, 'execute'), false) as permissions_ok
from expected left join pg_catalog.pg_proc procedure on procedure.oid = to_regprocedure(expected.signature);
