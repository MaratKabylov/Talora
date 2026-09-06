-- READ-ONLY: run in Supabase SQL Editor AFTER the section-read migration.
-- НЕ миграция и НЕ fixture: ничего не создает, не изменяет и не удаляет.
-- Expected: installed=true, permissions_ok=true, stable_snapshot=true.
with expected(signature) as (
  values ('public.read_assessment_section_v2(text,text,uuid,integer,boolean)')
)
select expected.signature,
  procedure.oid is not null as installed,
  coalesce(
    procedure.prosecdef
    and procedure.proconfig @> array['search_path=""']
    and not has_function_privilege('anon', procedure.oid, 'execute')
    and not has_function_privilege('authenticated', procedure.oid, 'execute')
    and has_function_privilege('service_role', procedure.oid, 'execute'),
    false
  ) as permissions_ok,
  coalesce(procedure.provolatile = 's', false) as stable_snapshot
from expected
left join pg_catalog.pg_proc procedure on procedure.oid = to_regprocedure(expected.signature);
