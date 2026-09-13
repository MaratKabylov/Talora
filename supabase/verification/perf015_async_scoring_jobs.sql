-- Read-only catalog, privilege and queue-health verification after PERF-015 migration.
with function_catalog as (
  select routine.proname,
         routine.prosecdef,
         routine.proconfig,
         pg_get_function_identity_arguments(routine.oid) as arguments
  from pg_proc routine
  join pg_namespace schema_catalog on schema_catalog.oid = routine.pronamespace
  where schema_catalog.nspname = 'public'
    and routine.proname in (
      'enqueue_scoring_job', 'claim_scoring_jobs', 'finish_scoring_job',
      'try_persist_queued_scoring_snapshot'
    )
), function_checks as (
  select count(*) = 4 as installed,
         bool_and(prosecdef) as security_definer,
         bool_and(proconfig @> array['search_path=""']) as empty_search_path
  from function_catalog
), privilege_checks as (
  select
    not has_table_privilege('anon', 'public.scoring_jobs', 'select,insert,update,delete') as anon_table_private,
    not has_table_privilege('authenticated', 'public.scoring_jobs', 'select,insert,update,delete') as authenticated_table_private,
    not has_table_privilege('service_role', 'public.scoring_jobs', 'insert,update,delete') as service_direct_write_private,
    has_function_privilege('service_role', 'public.enqueue_scoring_job(text,uuid,uuid,boolean)', 'execute') as service_enqueue,
    has_function_privilege('service_role', 'public.claim_scoring_jobs(uuid,integer,integer)', 'execute') as service_claim,
    has_function_privilege('service_role', 'public.finish_scoring_job(uuid,uuid,boolean,text)', 'execute') as service_finish,
    has_function_privilege('service_role', 'public.try_persist_queued_scoring_snapshot(uuid,uuid,text,uuid,integer,jsonb,jsonb)', 'execute') as service_persist,
    not has_function_privilege('anon', 'public.enqueue_scoring_job(text,uuid,uuid,boolean)', 'execute') as anon_enqueue_private,
    not has_function_privilege('authenticated', 'public.enqueue_scoring_job(text,uuid,uuid,boolean)', 'execute') as authenticated_enqueue_private
), queue_health as (
  select count(*)::integer as row_count,
         count(*) filter (where status = 'pending')::integer as pending,
         count(*) filter (where status = 'retry')::integer as retry,
         count(*) filter (where status = 'processing')::integer as processing,
         count(*) filter (where status = 'failed')::integer as failed,
         count(*) filter (
           where status = 'processing' and locked_until <= clock_timestamp()
         )::integer as expired_leases,
         count(*) filter (
           where (scope = 'candidate' and not exists (
             select 1 from public.candidate_applications application
             where application.id = scoring_jobs.parent_id
               and application.company_id = scoring_jobs.company_id
           )) or (scope = 'employee' and not exists (
             select 1 from public.employee_assessment_participants participant
             where participant.id = scoring_jobs.parent_id
               and participant.company_id = scoring_jobs.company_id
           ))
         )::integer as tenant_parent_mismatches
  from public.scoring_jobs
)
select jsonb_build_object(
  'perf015_async_scoring_jobs', jsonb_build_object(
    'checked_at', clock_timestamp(),
    'server_version', current_setting('server_version'),
    'catalog', jsonb_build_object(
      'table_installed', to_regclass('public.scoring_jobs') is not null,
      'rls_enabled', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.scoring_jobs')), false),
      'functions_installed', function_checks.installed,
      'functions_security_definer', function_checks.security_definer,
      'functions_empty_search_path', function_checks.empty_search_path
    ),
    'privileges', to_jsonb(privilege_checks),
    'queue', to_jsonb(queue_health)
  )
) as result
from function_checks, privilege_checks, queue_health;
