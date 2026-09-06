-- READ-ONLY verification: safe to run in Supabase SQL Editor after the migrations.
-- НЕ миграция и НЕ fixture: этот файл ничего не создает, не меняет и не удаляет.
-- Expected: installed=true and permissions_ok=true for every row.
with expected(signature, service_execute, security_definer) as (
  values
    ('public.control_assessment_session_lease_v2(text,text,uuid,text,text,text,jsonb)', true, true),
    ('public.save_assessment_answer_v2(text,text,uuid,text,text,uuid,jsonb,boolean,integer)', true, true),
    ('public.normalize_assessment_answer_v2(uuid,jsonb,boolean)', false, false)
)
select expected.signature,
  procedure.oid is not null as installed,
  coalesce(
    procedure.prosecdef = expected.security_definer
    and procedure.proconfig @> array['search_path=""']
    and not has_function_privilege('anon', procedure.oid, 'execute')
    and not has_function_privilege('authenticated', procedure.oid, 'execute')
    and has_function_privilege('service_role', procedure.oid, 'execute') = expected.service_execute,
    false
  ) as permissions_ok
from expected
left join pg_catalog.pg_proc procedure on procedure.oid = to_regprocedure(expected.signature);

-- Expected: true for all markers. Missing/old save RPC => false, not an exception.
-- These are deployment guards, not a substitute for integration/concurrency tests.
with definition as (
  select coalesce(pg_get_functiondef(to_regprocedure(
    'public.save_assessment_answer_v2(text,text,uuid,text,text,uuid,jsonb,boolean,integer)'
  )), '') as body
)
select position('existing_answer.id is not null' in body) > 0 as nullable_answer_retry_guard,
       position('TVA01' in body) > 0 as late_deadline_rollback_guard,
       position('TVA02' in body) > 0 as late_token_rollback_guard,
       position('control_assessment_session_lease_v2' in body) > 0 as shared_lease_checks
from definition;
