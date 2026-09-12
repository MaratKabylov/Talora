-- PERF-014 read-only verification. Run after the migration in Supabase SQL Editor.

with catalog as (
  select
    to_regclass('public.employee_assessment_dimension_scores') is not null as table_installed,
    to_regprocedure('public.try_persist_scoring_snapshot(text,uuid,integer,jsonb,jsonb)') is not null as wrapper_installed,
    coalesce((
      select c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'employee_assessment_dimension_scores'
    ), false) as rls_enabled,
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'employee_assessment_dimension_scores'
        and policyname = 'members can read employee assessment dimensions'
        and cmd = 'SELECT'
    ) as member_select_policy,
    has_table_privilege('authenticated', 'public.employee_assessment_dimension_scores', 'SELECT') as authenticated_select,
    not has_table_privilege('authenticated', 'public.employee_assessment_dimension_scores', 'INSERT')
      and not has_table_privilege('authenticated', 'public.employee_assessment_dimension_scores', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.employee_assessment_dimension_scores', 'DELETE')
      as authenticated_read_only,
    not has_function_privilege(
      'authenticated',
      'public.try_persist_scoring_snapshot(text,uuid,integer,jsonb,jsonb)',
      'EXECUTE'
    ) as wrapper_private,
    has_function_privilege(
      'service_role',
      'public.try_persist_scoring_snapshot(text,uuid,integer,jsonb,jsonb)',
      'EXECUTE'
    ) as wrapper_service_only,
    has_function_privilege(
      'service_role',
      'public.backfill_employee_assessment_dimensions(uuid,integer,jsonb)',
      'EXECUTE'
    ) as backfill_service_only,
    not has_function_privilege(
      'authenticated',
      'public.backfill_employee_assessment_dimensions(uuid,integer,jsonb)',
      'EXECUTE'
    ) as backfill_private,
    not has_function_privilege(
      'service_role',
      'public.replace_employee_assessment_dimensions(uuid,integer,jsonb,boolean)',
      'EXECUTE'
    ) as inner_dimension_writer_private,
    not has_function_privilege(
      'service_role',
      'public.persist_scoring_snapshot(text,uuid,integer,jsonb,jsonb)',
      'EXECUTE'
    ) as inner_not_directly_callable
), integrity as (
  select
    count(*) as row_count,
    count(*) filter (
      where participant.company_id is distinct from dimension.company_id
         or participant.employee_assessment_id is distinct from dimension.employee_assessment_id
    ) as tenant_scope_mismatches,
    count(*) filter (
      where dimension.scoring_revision is distinct from participant.scoring_revision
    ) as stale_revision_rows,
    count(*) filter (
      where dimension.session_id is not null
        and not exists (
          select 1
          from public.employee_assessment_sessions session
          where session.id = dimension.session_id
            and session.participant_id = dimension.participant_id
            and session.test_version_id = dimension.test_version_id
        )
    ) as session_scope_mismatches
  from public.employee_assessment_dimension_scores dimension
  join public.employee_assessment_participants participant
    on participant.id = dimension.participant_id
), coverage as (
  select count(*) as scored_participants_without_current_dimensions
  from public.employee_assessment_participants participant
  where participant.scoring_revision > 0
    and not exists (
      select 1
      from public.employee_assessment_dimension_scores dimension
      where dimension.participant_id = participant.id
        and dimension.scoring_revision = participant.scoring_revision
    )
)
select jsonb_build_object(
  'perf014_employee_dimension_scores', jsonb_build_object(
    'checked_at', now(),
    'server_version', current_setting('server_version'),
    'catalog', to_jsonb(catalog),
    'integrity', to_jsonb(integrity),
    'coverage', to_jsonb(coverage),
    'note', 'Read-only catalog, privilege, tenant integrity and rollout coverage verification.'
  )
) as result
from catalog cross join integrity cross join coverage;
