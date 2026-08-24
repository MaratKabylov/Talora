-- Final Scoring Framework V2 hardening.
-- Aggregate recommendation policy belongs to the job/employee assessment,
-- never to an individual test's interpretation thresholds.

alter table public.jobs
  add column if not exists recommendation_policy_json jsonb;

alter table public.jobs
  drop constraint if exists jobs_recommendation_policy_json_object,
  add constraint jobs_recommendation_policy_json_object
    check (
      recommendation_policy_json is null
      or jsonb_typeof(recommendation_policy_json) = 'object'
    );

alter table public.employee_assessments
  add column if not exists recommendation_policy_json jsonb;

alter table public.employee_assessments
  drop constraint if exists employee_assessments_recommendation_policy_json_object,
  add constraint employee_assessments_recommendation_policy_json_object
    check (
      recommendation_policy_json is null
      or jsonb_typeof(recommendation_policy_json) = 'object'
    );

comment on column public.jobs.recommendation_policy_json is
  'Validated aggregate hiring recommendation policy. Null preserves the legacy default policy.';
comment on column public.employee_assessments.recommendation_policy_json is
  'Validated aggregate recommendation policy. Null preserves the legacy default policy.';

-- Preserve the deployed atomic importer and add attention-only structured
-- fields as a post-step in the same database transaction.
alter function public.apply_talvia_scoring_v2(uuid, jsonb)
  rename to apply_talvia_scoring_v2_pre_attention;

create function public.apply_talvia_scoring_v2(
  target_version_id uuid,
  import_document jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  item_entry record;
  created_question_id uuid;
begin
  perform public.apply_talvia_scoring_v2_pre_attention(
    target_version_id,
    import_document
  );

  for item_entry in
    select item.value
    from jsonb_array_elements(import_document -> 'scoring' -> 'items') as item(value)
    where item.value ->> 'scoring_model' = 'criterion'
      and item.value ? 'signal_classification'
  loop
    if import_document -> 'scoring' ->> 'assessment_domain' <> 'attention' then
      raise exception 'signal_classification is only valid for attention assessments';
    end if;

    select question.id
    into strict created_question_id
    from jsonb_array_elements(import_document -> 'test' -> 'sections')
      with ordinality as source_section(value, ordinality)
    cross join lateral jsonb_array_elements(source_section.value -> 'questions')
      with ordinality as source_question(value, ordinality)
    join public.test_sections section
      on section.test_version_id = target_version_id
     and section.order_index = source_section.ordinality::integer
    join public.questions question
      on question.section_id = section.id
     and question.order_index = source_question.ordinality::integer
    where source_question.value ->> 'key' = item_entry.value ->> 'question_key';

    update public.questions
    set scoring_config_json = scoring_config_json || jsonb_build_object(
      'signalClassification', jsonb_build_object(
        'targetPresent', (
          item_entry.value -> 'signal_classification' ->> 'target_present'
        )::boolean
      )
    )
    where id = created_question_id;
  end loop;
end;
$$;

revoke all on function public.apply_talvia_scoring_v2_pre_attention(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.apply_talvia_scoring_v2(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_talvia_scoring_v2(uuid, jsonb)
  to service_role;

alter table public.test_results
  add column if not exists scoring_schema_version text;

update public.test_results
set scoring_schema_version = scoring_result_json ->> 'schemaVersion'
where scoring_result_json is not null
  and scoring_schema_version is null;

alter table public.test_results
  drop constraint if exists test_results_scoring_schema_version_check,
  add constraint test_results_scoring_schema_version_check
    check (scoring_schema_version is null or scoring_schema_version = '2.0'),
  drop constraint if exists test_results_scoring_schema_snapshot_check,
  add constraint test_results_scoring_schema_snapshot_check
    check (
      (scoring_result_json is null and scoring_schema_version is null)
      or (
        scoring_result_json is not null
        and scoring_schema_version is not null
        and scoring_schema_version = scoring_result_json ->> 'schemaVersion'
      )
    );

alter table public.employee_assessment_test_results
  add column if not exists scoring_schema_version text;

update public.employee_assessment_test_results
set scoring_schema_version = scoring_result_json ->> 'schemaVersion'
where scoring_result_json is not null
  and scoring_schema_version is null;

alter table public.employee_assessment_test_results
  drop constraint if exists employee_test_results_scoring_schema_version_check,
  add constraint employee_test_results_scoring_schema_version_check
    check (scoring_schema_version is null or scoring_schema_version = '2.0'),
  drop constraint if exists employee_test_results_scoring_schema_snapshot_check,
  add constraint employee_test_results_scoring_schema_snapshot_check
    check (
      (scoring_result_json is null and scoring_schema_version is null)
      or (
        scoring_result_json is not null
        and scoring_schema_version is not null
        and scoring_schema_version = scoring_result_json ->> 'schemaVersion'
      )
    );

create table if not exists public.scoring_recalculation_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid not null,
  scope text not null check (scope in ('candidate', 'employee')),
  reason text not null check (
    reason in ('manual', 'scoring_upgrade', 'definition_change', 'admin_repair')
  ),
  actor_id uuid references public.profiles(id) on delete set null,
  status text not null default 'started' check (status in ('started', 'completed', 'failed')),
  previous_engine_version text,
  new_engine_version text,
  previous_schema_version text,
  new_schema_version text,
  previous_result_json jsonb,
  new_result_json jsonb,
  previous_aggregate_json jsonb,
  new_aggregate_json jsonb,
  error_message text,
  recalculated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (previous_result_json is null or jsonb_typeof(previous_result_json) = 'object'),
  check (new_result_json is null or jsonb_typeof(new_result_json) = 'object'),
  check (previous_aggregate_json is null or jsonb_typeof(previous_aggregate_json) = 'object'),
  check (new_aggregate_json is null or jsonb_typeof(new_aggregate_json) = 'object'),
  check (
    (status = 'started' and completed_at is null)
    or (status in ('completed', 'failed') and completed_at is not null)
  )
);

create index if not exists idx_scoring_recalculation_history_session_time
  on public.scoring_recalculation_history(session_id, recalculated_at desc);
create index if not exists idx_scoring_recalculation_history_company_time
  on public.scoring_recalculation_history(company_id, recalculated_at desc);
create unique index if not exists idx_scoring_recalculation_one_active_per_session
  on public.scoring_recalculation_history(session_id)
  where status = 'started';

alter table public.scoring_recalculation_history enable row level security;

drop policy if exists "members can read scoring recalculation history"
on public.scoring_recalculation_history;
create policy "members can read scoring recalculation history"
on public.scoring_recalculation_history for select to authenticated
using (public.is_company_member(company_id));

revoke all on table public.scoring_recalculation_history from anon;
revoke insert, update, delete on table public.scoring_recalculation_history from authenticated;
grant select on table public.scoring_recalculation_history to authenticated;
