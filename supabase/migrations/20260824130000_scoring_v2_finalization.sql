-- Scoring Framework V2 finalization: interpretation ownership and atomic persistence.

alter table public.jobs
  add column if not exists interpretation_policy_json jsonb;

alter table public.jobs
  drop constraint if exists jobs_interpretation_policy_json_object,
  add constraint jobs_interpretation_policy_json_object
    check (
      interpretation_policy_json is null
      or jsonb_typeof(interpretation_policy_json) = 'object'
    );

alter table public.employee_assessments
  add column if not exists interpretation_policy_json jsonb;

alter table public.employee_assessments
  drop constraint if exists employee_assessments_interpretation_policy_json_object,
  add constraint employee_assessments_interpretation_policy_json_object
    check (
      interpretation_policy_json is null
      or jsonb_typeof(interpretation_policy_json) = 'object'
    );

comment on column public.jobs.interpretation_policy_json is
  'Report interpretation policy. Null uses the legacy-compatible application default.';
comment on column public.employee_assessments.interpretation_policy_json is
  'Report interpretation policy. Null uses the legacy-compatible participant default.';

alter table public.application_competency_summary
  add column if not exists interpretation_direction text,
  drop constraint if exists application_summary_interpretation_direction_check,
  add constraint application_summary_interpretation_direction_check check (
    interpretation_direction is null
    or interpretation_direction in (
      'higher_is_better', 'lower_is_better', 'neutral', 'target_range'
    )
  );

alter table public.employee_assessment_competency_summary
  add column if not exists interpretation_direction text,
  drop constraint if exists employee_summary_interpretation_direction_check,
  add constraint employee_summary_interpretation_direction_check check (
    interpretation_direction is null
    or interpretation_direction in (
      'higher_is_better', 'lower_is_better', 'neutral', 'target_range'
    )
  );

alter table public.candidate_applications
  add column if not exists scoring_revision integer not null default 0,
  drop constraint if exists candidate_applications_scoring_revision_nonnegative,
  add constraint candidate_applications_scoring_revision_nonnegative
    check (scoring_revision >= 0);

alter table public.employee_assessment_participants
  add column if not exists scoring_revision integer not null default 0,
  drop constraint if exists employee_participants_scoring_revision_nonnegative,
  add constraint employee_participants_scoring_revision_nonnegative
    check (scoring_revision >= 0);

update public.candidate_applications application
set scoring_revision = 1
where application.scoring_revision = 0
  and exists (
    select 1 from public.test_results result
    where result.application_id = application.id
  );

update public.employee_assessment_participants participant
set scoring_revision = 1
where participant.scoring_revision = 0
  and exists (
    select 1 from public.employee_assessment_test_results result
    where result.participant_id = participant.id
  );

alter table public.test_results
  add column if not exists scoring_revision integer not null default 0,
  add column if not exists recalculated_at timestamptz,
  drop constraint if exists test_results_scoring_revision_nonnegative,
  add constraint test_results_scoring_revision_nonnegative
    check (scoring_revision >= 0);

alter table public.employee_assessment_test_results
  add column if not exists scoring_revision integer not null default 0,
  add column if not exists recalculated_at timestamptz,
  drop constraint if exists employee_test_results_scoring_revision_nonnegative,
  add constraint employee_test_results_scoring_revision_nonnegative
    check (scoring_revision >= 0);

update public.test_results result
set scoring_revision = application.scoring_revision
from public.candidate_applications application
where application.id = result.application_id
  and result.scoring_revision = 0;

update public.employee_assessment_test_results result
set scoring_revision = participant.scoring_revision
from public.employee_assessment_participants participant
where participant.id = result.participant_id
  and result.scoring_revision = 0;

alter table public.scoring_recalculation_history
  add column if not exists previous_revision integer,
  add column if not exists new_revision integer;

alter table public.scoring_recalculation_history
  drop constraint if exists scoring_recalculation_revision_order,
  add constraint scoring_recalculation_revision_order check (
    previous_revision is null
    or new_revision is null
    or new_revision = previous_revision + 1
  );

comment on column public.candidate_applications.scoring_revision is
  'Monotonic version of the complete derived scoring snapshot. Zero means no snapshot.';
comment on column public.employee_assessment_participants.scoring_revision is
  'Monotonic version of the complete derived scoring snapshot. Zero means no snapshot.';
comment on column public.test_results.recalculated_at is
  'Time of the latest successful recalculation; scored_at remains the initial scoring time.';
comment on column public.employee_assessment_test_results.recalculated_at is
  'Time of the latest successful recalculation; scored_at remains the initial scoring time.';

create or replace function public.persist_scoring_snapshot(
  p_scope text,
  p_parent_id uuid,
  p_expected_revision integer,
  p_snapshot jsonb,
  p_audit jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry jsonb;
  target_result jsonb;
  affected integer;
  current_revision integer;
  next_revision integer;
  parent_company_id uuid;
  parent_candidate_id uuid;
  parent_job_id uuid;
  parent_employee_id uuid;
  audit_id uuid;
begin
  if p_scope not in ('candidate', 'employee') then
    raise exception 'Invalid scoring persistence scope';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Invalid expected scoring revision';
  end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object' then
    raise exception 'Scoring snapshot must be an object';
  end if;
  if jsonb_typeof(p_snapshot -> 'aggregate') is distinct from 'object'
     or jsonb_typeof(p_snapshot -> 'report') is distinct from 'object'
  then
    raise exception 'Scoring snapshot aggregate and report must be objects';
  end if;
  if exists (
    select 1
    from unnest(array[
      'answers', 'sessions', 'results', 'competency_scores', 'summaries', 'risks'
    ]) field_name
    where jsonb_typeof(p_snapshot -> field_name) is distinct from 'array'
  ) then
    raise exception 'Scoring snapshot collections must be arrays';
  end if;
  if jsonb_array_length(p_snapshot -> 'sessions') = 0
     or jsonb_array_length(p_snapshot -> 'sessions')
        <> jsonb_array_length(p_snapshot -> 'results')
     or (
       select count(distinct session_item.value ->> 'id')
       from jsonb_array_elements(p_snapshot -> 'sessions') session_item(value)
     ) <> jsonb_array_length(p_snapshot -> 'sessions')
     or (
       select count(distinct result_item.value ->> 'session_id')
       from jsonb_array_elements(p_snapshot -> 'results') result_item(value)
     ) <> jsonb_array_length(p_snapshot -> 'results')
     or exists (
       select 1
       from jsonb_array_elements(p_snapshot -> 'sessions') session_item(value)
       where not exists (
         select 1
         from jsonb_array_elements(p_snapshot -> 'results') result_item(value)
         where result_item.value ->> 'session_id' = session_item.value ->> 'id'
       )
     )
     or exists (
       select 1
       from jsonb_array_elements(p_snapshot -> 'results') result_item(value)
       where not exists (
         select 1
         from jsonb_array_elements(p_snapshot -> 'sessions') session_item(value)
         where session_item.value ->> 'id' = result_item.value ->> 'session_id'
       )
     )
  then
    raise exception 'Scoring snapshot sessions and results must form the same non-empty set';
  end if;
  if p_scope = 'candidate'
     and jsonb_typeof(p_snapshot -> 'comparison') is distinct from 'object'
  then
    raise exception 'Candidate scoring snapshot comparison must be an object';
  end if;
  if p_audit is not null and jsonb_typeof(p_audit) is distinct from 'object' then
    raise exception 'Scoring audit must be an object';
  end if;
  if p_audit is not null
     and (p_audit ->> 'previous_revision')::integer is distinct from p_expected_revision
  then
    raise exception 'Scoring audit revision does not match expected revision';
  end if;

  if p_scope = 'candidate' then
    select application.company_id, application.candidate_id,
           application.job_id, application.scoring_revision
    into parent_company_id, parent_candidate_id, parent_job_id, current_revision
    from public.candidate_applications application
    where application.id = p_parent_id
    for update;

    if not found then
      raise exception 'Candidate application was not found';
    end if;
    if current_revision <> p_expected_revision then
      raise exception 'Scoring revision conflict: expected %, found %',
        p_expected_revision, current_revision using errcode = '40001';
    end if;
    next_revision := current_revision + 1;

    for entry in
      select item.value
      from jsonb_array_elements(coalesce(p_snapshot -> 'answers', '[]'::jsonb)) item(value)
    loop
      update public.candidate_answers answer
      set is_correct = (entry ->> 'is_correct')::boolean,
          points_awarded = (entry ->> 'points_awarded')::numeric,
          raw_score = (entry ->> 'raw_score')::numeric
      where answer.id = (entry ->> 'id')::uuid
        and exists (
          select 1 from public.test_sessions session
          where session.id = answer.session_id
            and session.application_id = p_parent_id
        );
      get diagnostics affected = row_count;
      if affected <> 1 then
        raise exception 'Candidate answer does not belong to scoring parent';
      end if;
    end loop;

    for entry in
      select item.value
      from jsonb_array_elements(coalesce(p_snapshot -> 'sessions', '[]'::jsonb)) item(value)
    loop
      update public.test_sessions session
      set score = (entry ->> 'score')::numeric,
          max_score = (entry ->> 'max_score')::numeric,
          percentage = (entry ->> 'percentage')::numeric
      where session.id = (entry ->> 'id')::uuid
        and session.application_id = p_parent_id;
      get diagnostics affected = row_count;
      if affected <> 1 then
        raise exception 'Candidate session does not belong to scoring parent';
      end if;
    end loop;

    for entry in
      select item.value
      from jsonb_array_elements(coalesce(p_snapshot -> 'results', '[]'::jsonb)) item(value)
    loop
      insert into public.test_results (
        session_id, candidate_id, application_id, test_version_id,
        raw_score, max_score, percentage, level, summary, requires_review,
        scoring_result_json, scoring_engine_version, scoring_schema_version,
        scored_at, recalculated_at, scoring_revision
      )
      select session.id, parent_candidate_id, p_parent_id,
             (entry ->> 'test_version_id')::uuid,
             (entry ->> 'raw_score')::numeric,
             (entry ->> 'max_score')::numeric,
             (entry ->> 'percentage')::numeric,
             entry ->> 'level', entry ->> 'summary',
             coalesce((entry ->> 'requires_review')::boolean, false),
             nullif(entry -> 'scoring_result_json', 'null'::jsonb),
             entry ->> 'scoring_engine_version',
             entry ->> 'scoring_schema_version',
             (entry ->> 'scored_at')::timestamptz,
             case when p_audit is null then null else now() end,
             next_revision
      from public.test_sessions session
      where session.id = (entry ->> 'session_id')::uuid
        and session.application_id = p_parent_id
      on conflict (session_id) do update
      set raw_score = excluded.raw_score,
          max_score = excluded.max_score,
          percentage = excluded.percentage,
          level = excluded.level,
          summary = excluded.summary,
          requires_review = excluded.requires_review,
          scoring_result_json = excluded.scoring_result_json,
          scoring_engine_version = excluded.scoring_engine_version,
          scoring_schema_version = excluded.scoring_schema_version,
          scored_at = coalesce(public.test_results.scored_at, excluded.scored_at),
          recalculated_at = case
            when p_audit is null then public.test_results.recalculated_at
            else now()
          end,
          scoring_revision = next_revision;
      get diagnostics affected = row_count;
      if affected <> 1 then
        raise exception 'Candidate result session does not belong to scoring parent';
      end if;
    end loop;

    delete from public.competency_scores score
    where score.application_id = p_parent_id;

    for entry in
      select item.value
      from jsonb_array_elements(coalesce(p_snapshot -> 'competency_scores', '[]'::jsonb)) item(value)
    loop
      insert into public.competency_scores (
        result_id, application_id, competency_key, score, max_score, percentage
      )
      select result.id, p_parent_id, entry ->> 'competency_key',
             (entry ->> 'score')::numeric,
             (entry ->> 'max_score')::numeric,
             (entry ->> 'percentage')::numeric
      from public.test_results result
      where result.session_id = (entry ->> 'session_id')::uuid
        and result.application_id = p_parent_id;
      get diagnostics affected = row_count;
      if affected <> 1 then
        raise exception 'Candidate competency result was not persisted';
      end if;
    end loop;

    delete from public.application_competency_summary summary
    where summary.application_id = p_parent_id;
    for entry in
      select item.value
      from jsonb_array_elements(coalesce(p_snapshot -> 'summaries', '[]'::jsonb)) item(value)
    loop
      insert into public.application_competency_summary (
        application_id, competency_key, score, max_score, percentage,
        weighted_score, is_below_minimum, interpretation_direction
      ) values (
        p_parent_id, entry ->> 'competency_key',
        (entry ->> 'score')::numeric, (entry ->> 'max_score')::numeric,
        (entry ->> 'percentage')::numeric, (entry ->> 'weighted_score')::numeric,
        coalesce((entry ->> 'is_below_minimum')::boolean, false),
        entry ->> 'interpretation_direction'
      );
    end loop;

    delete from public.candidate_risk_flags risk
    where risk.application_id = p_parent_id and risk.source = 'scoring';
    for entry in
      select item.value
      from jsonb_array_elements(coalesce(p_snapshot -> 'risks', '[]'::jsonb)) item(value)
    loop
      insert into public.candidate_risk_flags (
        application_id, risk_key, risk_level, title, description, source
      ) values (
        p_parent_id, entry ->> 'risk_key', entry ->> 'risk_level',
        entry ->> 'title', entry ->> 'description', 'scoring'
      );
    end loop;

    update public.candidate_applications application
    set behavior_fit = (p_snapshot -> 'aggregate' ->> 'behavior_fit')::numeric,
        composite_result_json = nullif(
          p_snapshot -> 'aggregate' -> 'composite_result_json', 'null'::jsonb
        ),
        composite_score = (p_snapshot -> 'aggregate' ->> 'composite_score')::numeric,
        fit_score = (p_snapshot -> 'aggregate' ->> 'fit_score')::numeric,
        motivation_fit = (p_snapshot -> 'aggregate' ->> 'motivation_fit')::numeric,
        overall_score = (p_snapshot -> 'aggregate' ->> 'overall_score')::numeric,
        recommendation = p_snapshot -> 'aggregate' ->> 'recommendation',
        requires_review = coalesce(
          (p_snapshot -> 'aggregate' ->> 'requires_review')::boolean, false
        ),
        risk_level = p_snapshot -> 'aggregate' ->> 'risk_level',
        scoring_revision = next_revision
    where application.id = p_parent_id;

    insert into public.application_comparison_scores (
      application_id, job_id, candidate_id, overall_score, fit_score,
      recommendation, risk_level, completed_required_tests,
      motivation_fit, behavior_fit, composite_score
    ) values (
      p_parent_id, parent_job_id, parent_candidate_id,
      (p_snapshot -> 'comparison' ->> 'overall_score')::numeric,
      (p_snapshot -> 'comparison' ->> 'fit_score')::numeric,
      p_snapshot -> 'comparison' ->> 'recommendation',
      p_snapshot -> 'comparison' ->> 'risk_level',
      coalesce((p_snapshot -> 'comparison' ->> 'completed_required_tests')::boolean, false),
      (p_snapshot -> 'comparison' ->> 'motivation_fit')::numeric,
      (p_snapshot -> 'comparison' ->> 'behavior_fit')::numeric,
      (p_snapshot -> 'comparison' ->> 'composite_score')::numeric
    )
    on conflict (application_id) do update set
      job_id = excluded.job_id,
      candidate_id = excluded.candidate_id,
      overall_score = excluded.overall_score,
      fit_score = excluded.fit_score,
      recommendation = excluded.recommendation,
      risk_level = excluded.risk_level,
      completed_required_tests = excluded.completed_required_tests,
      motivation_fit = excluded.motivation_fit,
      behavior_fit = excluded.behavior_fit,
      composite_score = excluded.composite_score;

    insert into public.candidate_reports (
      application_id, candidate_id, overall_score, fit_score, recommendation,
      strengths_json, risks_json, suggested_roles_json,
      interview_questions_json, report_text,
      motivation_fit, behavior_fit, composite_score, composite_result_json
    ) values (
      p_parent_id, parent_candidate_id,
      (p_snapshot -> 'report' ->> 'overall_score')::numeric,
      (p_snapshot -> 'report' ->> 'fit_score')::numeric,
      p_snapshot -> 'report' ->> 'recommendation',
      coalesce(p_snapshot -> 'report' -> 'strengths_json', '[]'::jsonb),
      coalesce(p_snapshot -> 'report' -> 'risks_json', '[]'::jsonb),
      coalesce(p_snapshot -> 'report' -> 'suggested_roles_json', '[]'::jsonb),
      coalesce(p_snapshot -> 'report' -> 'interview_questions_json', '[]'::jsonb),
      p_snapshot -> 'report' ->> 'report_text',
      (p_snapshot -> 'report' ->> 'motivation_fit')::numeric,
      (p_snapshot -> 'report' ->> 'behavior_fit')::numeric,
      (p_snapshot -> 'report' ->> 'composite_score')::numeric,
      nullif(p_snapshot -> 'report' -> 'composite_result_json', 'null'::jsonb)
    )
    on conflict (application_id) do update set
      candidate_id = excluded.candidate_id,
      overall_score = excluded.overall_score,
      fit_score = excluded.fit_score,
      recommendation = excluded.recommendation,
      strengths_json = excluded.strengths_json,
      risks_json = excluded.risks_json,
      suggested_roles_json = excluded.suggested_roles_json,
      interview_questions_json = excluded.interview_questions_json,
      report_text = excluded.report_text,
      motivation_fit = excluded.motivation_fit,
      behavior_fit = excluded.behavior_fit,
      composite_score = excluded.composite_score,
      composite_result_json = excluded.composite_result_json;
  else
    select participant.company_id, participant.employee_id,
           participant.scoring_revision
    into parent_company_id, parent_employee_id, current_revision
    from public.employee_assessment_participants participant
    where participant.id = p_parent_id
    for update;

    if not found then
      raise exception 'Employee assessment participant was not found';
    end if;
    if current_revision <> p_expected_revision then
      raise exception 'Scoring revision conflict: expected %, found %',
        p_expected_revision, current_revision using errcode = '40001';
    end if;
    next_revision := current_revision + 1;

    for entry in
      select item.value
      from jsonb_array_elements(coalesce(p_snapshot -> 'answers', '[]'::jsonb)) item(value)
    loop
      update public.employee_assessment_answers answer
      set is_correct = (entry ->> 'is_correct')::boolean,
          points_awarded = (entry ->> 'points_awarded')::numeric,
          raw_score = (entry ->> 'raw_score')::numeric
      where answer.id = (entry ->> 'id')::uuid
        and exists (
          select 1 from public.employee_assessment_sessions session
          where session.id = answer.session_id
            and session.participant_id = p_parent_id
        );
      get diagnostics affected = row_count;
      if affected <> 1 then
        raise exception 'Employee answer does not belong to scoring parent';
      end if;
    end loop;

    for entry in
      select item.value
      from jsonb_array_elements(coalesce(p_snapshot -> 'sessions', '[]'::jsonb)) item(value)
    loop
      update public.employee_assessment_sessions session
      set score = (entry ->> 'score')::numeric,
          max_score = (entry ->> 'max_score')::numeric,
          percentage = (entry ->> 'percentage')::numeric
      where session.id = (entry ->> 'id')::uuid
        and session.participant_id = p_parent_id;
      get diagnostics affected = row_count;
      if affected <> 1 then
        raise exception 'Employee session does not belong to scoring parent';
      end if;
    end loop;

    for entry in
      select item.value
      from jsonb_array_elements(coalesce(p_snapshot -> 'results', '[]'::jsonb)) item(value)
    loop
      insert into public.employee_assessment_test_results (
        session_id, participant_id, employee_id, test_version_id,
        raw_score, max_score, percentage, level, summary, requires_review,
        scoring_result_json, scoring_engine_version, scoring_schema_version,
        scored_at, recalculated_at, scoring_revision
      )
      select session.id, p_parent_id, parent_employee_id,
             (entry ->> 'test_version_id')::uuid,
             (entry ->> 'raw_score')::numeric,
             (entry ->> 'max_score')::numeric,
             (entry ->> 'percentage')::numeric,
             entry ->> 'level', entry ->> 'summary',
             coalesce((entry ->> 'requires_review')::boolean, false),
             nullif(entry -> 'scoring_result_json', 'null'::jsonb),
             entry ->> 'scoring_engine_version',
             entry ->> 'scoring_schema_version',
             (entry ->> 'scored_at')::timestamptz,
             case when p_audit is null then null else now() end,
             next_revision
      from public.employee_assessment_sessions session
      where session.id = (entry ->> 'session_id')::uuid
        and session.participant_id = p_parent_id
      on conflict (session_id) do update
      set raw_score = excluded.raw_score,
          max_score = excluded.max_score,
          percentage = excluded.percentage,
          level = excluded.level,
          summary = excluded.summary,
          requires_review = excluded.requires_review,
          scoring_result_json = excluded.scoring_result_json,
          scoring_engine_version = excluded.scoring_engine_version,
          scoring_schema_version = excluded.scoring_schema_version,
          scored_at = coalesce(
            public.employee_assessment_test_results.scored_at, excluded.scored_at
          ),
          recalculated_at = case
            when p_audit is null
              then public.employee_assessment_test_results.recalculated_at
            else now()
          end,
          scoring_revision = next_revision;
      get diagnostics affected = row_count;
      if affected <> 1 then
        raise exception 'Employee result session does not belong to scoring parent';
      end if;
    end loop;

    delete from public.employee_assessment_competency_scores score
    where score.participant_id = p_parent_id;
    for entry in
      select item.value
      from jsonb_array_elements(coalesce(p_snapshot -> 'competency_scores', '[]'::jsonb)) item(value)
    loop
      insert into public.employee_assessment_competency_scores (
        result_id, participant_id, competency_key, score, max_score, percentage
      )
      select result.id, p_parent_id, entry ->> 'competency_key',
             (entry ->> 'score')::numeric,
             (entry ->> 'max_score')::numeric,
             (entry ->> 'percentage')::numeric
      from public.employee_assessment_test_results result
      where result.session_id = (entry ->> 'session_id')::uuid
        and result.participant_id = p_parent_id;
      get diagnostics affected = row_count;
      if affected <> 1 then
        raise exception 'Employee competency result was not persisted';
      end if;
    end loop;

    delete from public.employee_assessment_competency_summary summary
    where summary.participant_id = p_parent_id;
    for entry in
      select item.value
      from jsonb_array_elements(coalesce(p_snapshot -> 'summaries', '[]'::jsonb)) item(value)
    loop
      insert into public.employee_assessment_competency_summary (
        participant_id, competency_key, score, max_score, percentage,
        weighted_score, is_below_minimum, interpretation_direction
      ) values (
        p_parent_id, entry ->> 'competency_key',
        (entry ->> 'score')::numeric, (entry ->> 'max_score')::numeric,
        (entry ->> 'percentage')::numeric, (entry ->> 'weighted_score')::numeric,
        coalesce((entry ->> 'is_below_minimum')::boolean, false),
        entry ->> 'interpretation_direction'
      );
    end loop;

    delete from public.employee_assessment_risk_flags risk
    where risk.participant_id = p_parent_id and risk.source = 'scoring';
    for entry in
      select item.value
      from jsonb_array_elements(coalesce(p_snapshot -> 'risks', '[]'::jsonb)) item(value)
    loop
      insert into public.employee_assessment_risk_flags (
        participant_id, risk_key, risk_level, title, description, source
      ) values (
        p_parent_id, entry ->> 'risk_key', entry ->> 'risk_level',
        entry ->> 'title', entry ->> 'description', 'scoring'
      );
    end loop;

    update public.employee_assessment_participants participant
    set fit_score = (p_snapshot -> 'aggregate' ->> 'fit_score')::numeric,
        overall_score = (p_snapshot -> 'aggregate' ->> 'overall_score')::numeric,
        recommendation = p_snapshot -> 'aggregate' ->> 'recommendation',
        requires_review = coalesce(
          (p_snapshot -> 'aggregate' ->> 'requires_review')::boolean, false
        ),
        risk_level = p_snapshot -> 'aggregate' ->> 'risk_level',
        scoring_revision = next_revision
    where participant.id = p_parent_id;

    insert into public.employee_assessment_reports (
      participant_id, employee_id, overall_score, fit_score, recommendation,
      strengths_json, risks_json, suggested_roles_json,
      interview_questions_json, report_text
    ) values (
      p_parent_id, parent_employee_id,
      (p_snapshot -> 'report' ->> 'overall_score')::numeric,
      (p_snapshot -> 'report' ->> 'fit_score')::numeric,
      p_snapshot -> 'report' ->> 'recommendation',
      coalesce(p_snapshot -> 'report' -> 'strengths_json', '[]'::jsonb),
      coalesce(p_snapshot -> 'report' -> 'risks_json', '[]'::jsonb),
      coalesce(p_snapshot -> 'report' -> 'suggested_roles_json', '[]'::jsonb),
      coalesce(p_snapshot -> 'report' -> 'interview_questions_json', '[]'::jsonb),
      p_snapshot -> 'report' ->> 'report_text'
    )
    on conflict (participant_id) do update set
      employee_id = excluded.employee_id,
      overall_score = excluded.overall_score,
      fit_score = excluded.fit_score,
      recommendation = excluded.recommendation,
      strengths_json = excluded.strengths_json,
      risks_json = excluded.risks_json,
      suggested_roles_json = excluded.suggested_roles_json,
      interview_questions_json = excluded.interview_questions_json,
      report_text = excluded.report_text;
  end if;

  if p_audit is not null then
    select item.value into target_result
    from jsonb_array_elements(coalesce(p_snapshot -> 'results', '[]'::jsonb)) item(value)
    where item.value ->> 'session_id' = p_audit ->> 'session_id';
    if target_result is null then
      raise exception 'Recalculation audit session is absent from scoring snapshot';
    end if;

    insert into public.scoring_recalculation_history (
      company_id, session_id, scope, reason, actor_id, status,
      previous_engine_version, new_engine_version,
      previous_schema_version, new_schema_version,
      previous_result_json, new_result_json,
      previous_aggregate_json, new_aggregate_json,
      previous_revision, new_revision, recalculated_at, completed_at
    ) values (
      parent_company_id, (p_audit ->> 'session_id')::uuid, p_scope,
      p_audit ->> 'reason', (p_audit ->> 'actor_id')::uuid, 'completed',
      p_audit ->> 'previous_engine_version',
      target_result ->> 'scoring_engine_version',
      p_audit ->> 'previous_schema_version',
      target_result ->> 'scoring_schema_version',
      nullif(p_audit -> 'previous_result_json', 'null'::jsonb),
      nullif(target_result -> 'scoring_result_json', 'null'::jsonb),
      nullif(p_audit -> 'previous_aggregate_json', 'null'::jsonb),
      p_snapshot -> 'aggregate',
      (p_audit ->> 'previous_revision')::integer,
      next_revision, now(), now()
    ) returning id into audit_id;
  end if;

  return jsonb_build_object('revision', next_revision, 'audit_id', audit_id);
end;
$$;

revoke all on function public.persist_scoring_snapshot(text, uuid, integer, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.persist_scoring_snapshot(text, uuid, integer, jsonb, jsonb)
  to service_role;
