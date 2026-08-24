-- Run against a migrated disposable database. Any failed assertion aborts the script.
-- This is not a migration: apply 20260824130000_scoring_v2_finalization.sql first,
-- then execute this test separately.
begin;

insert into public.companies (id, name)
values ('f1000000-0000-4000-8000-000000000001', 'Scoring atomicity fixture');

insert into public.assessment_packages (id, company_id, title)
values (
  'f1000000-0000-4000-8000-000000000002',
  'f1000000-0000-4000-8000-000000000001',
  'Atomic package'
);

insert into public.jobs (
  id, company_id, title, assessment_package_id
) values (
  'f1000000-0000-4000-8000-000000000003',
  'f1000000-0000-4000-8000-000000000001',
  'Atomic job',
  'f1000000-0000-4000-8000-000000000002'
);

insert into public.candidates (id, company_id, full_name)
values (
  'f1000000-0000-4000-8000-000000000004',
  'f1000000-0000-4000-8000-000000000001',
  'Atomic Candidate'
);

insert into public.candidate_applications (
  id, company_id, job_id, candidate_id
) values (
  'f1000000-0000-4000-8000-000000000005',
  'f1000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000003',
  'f1000000-0000-4000-8000-000000000004'
);

insert into public.test_templates (id, company_id, title)
values (
  'f1000000-0000-4000-8000-000000000006',
  'f1000000-0000-4000-8000-000000000001',
  'Atomic test'
);

insert into public.test_versions (
  id, test_template_id, title, duration_minutes
) values (
  'f1000000-0000-4000-8000-000000000007',
  'f1000000-0000-4000-8000-000000000006',
  'Atomic test v1',
  5
);

insert into public.test_sections (id, test_version_id, title)
values (
  'f1000000-0000-4000-8000-000000000008',
  'f1000000-0000-4000-8000-000000000007',
  'Atomic section'
);

insert into public.questions (id, section_id, question_type, text)
values (
  'f1000000-0000-4000-8000-000000000009',
  'f1000000-0000-4000-8000-000000000008',
  'open_text',
  'Raw response must survive'
);

update public.test_versions
set status = 'published'
where id = 'f1000000-0000-4000-8000-000000000007';

insert into public.assessment_package_tests (
  package_id, test_version_id, order_index, weight, is_required
) values (
  'f1000000-0000-4000-8000-000000000002',
  'f1000000-0000-4000-8000-000000000007',
  0,
  1,
  true
);

insert into public.test_sessions (
  id, application_id, candidate_id, test_version_id, status
) values (
  'f1000000-0000-4000-8000-000000000010',
  'f1000000-0000-4000-8000-000000000005',
  'f1000000-0000-4000-8000-000000000004',
  'f1000000-0000-4000-8000-000000000007',
  'in_progress'
);

insert into public.candidate_answers (
  id, session_id, question_id, answer_text, answer_json
) values (
  'f1000000-0000-4000-8000-000000000011',
  'f1000000-0000-4000-8000-000000000010',
  'f1000000-0000-4000-8000-000000000009',
  'immutable raw text',
  '{"raw":"immutable"}'::jsonb
);

update public.test_sessions
set status = 'completed', completed_at = now()
where id = 'f1000000-0000-4000-8000-000000000010';

do $$
declare
  parent_id constant uuid := 'f1000000-0000-4000-8000-000000000005';
  fixture_session_id constant uuid := 'f1000000-0000-4000-8000-000000000010';
  version_id constant uuid := 'f1000000-0000-4000-8000-000000000007';
  answer_id constant uuid := 'f1000000-0000-4000-8000-000000000011';
  base_snapshot jsonb;
  attempted_snapshot jsonb;
  audit_payload jsonb;
  persisted jsonb;
  stored_revision integer;
  stored_score numeric;
  audit_count integer;
begin
  base_snapshot := jsonb_build_object(
    'answers', jsonb_build_array(jsonb_build_object(
      'id', answer_id, 'is_correct', null, 'points_awarded', null, 'raw_score', null
    )),
    'sessions', jsonb_build_array(jsonb_build_object(
      'id', fixture_session_id, 'score', 10, 'max_score', 10, 'percentage', 100
    )),
    'results', jsonb_build_array(jsonb_build_object(
      'session_id', fixture_session_id,
      'test_version_id', version_id,
      'raw_score', 10,
      'max_score', 10,
      'percentage', 100,
      'level', 'requires_review',
      'summary', 'Manual review',
      'requires_review', true,
      'scoring_result_json', null,
      'scoring_engine_version', null,
      'scoring_schema_version', null,
      'scored_at', null
    )),
    'competency_scores', '[]'::jsonb,
    'summaries', '[]'::jsonb,
    'risks', '[]'::jsonb,
    'aggregate', jsonb_build_object(
      'behavior_fit', null,
      'composite_result_json', null,
      'composite_score', null,
      'fit_score', null,
      'motivation_fit', null,
      'overall_score', null,
      'recommendation', 'requires_review',
      'requires_review', true,
      'risk_level', null
    ),
    'comparison', jsonb_build_object(
      'overall_score', null,
      'fit_score', null,
      'recommendation', 'requires_review',
      'risk_level', null,
      'completed_required_tests', true,
      'motivation_fit', null,
      'behavior_fit', null,
      'composite_score', null
    ),
    'report', jsonb_build_object(
      'overall_score', null,
      'fit_score', null,
      'recommendation', 'requires_review',
      'strengths_json', '[]'::jsonb,
      'risks_json', '[]'::jsonb,
      'suggested_roles_json', '[]'::jsonb,
      'interview_questions_json', '[]'::jsonb,
      'report_text', 'Atomic report',
      'motivation_fit', null,
      'behavior_fit', null,
      'composite_score', null,
      'composite_result_json', null
    )
  );

  persisted := public.persist_scoring_snapshot(
    'candidate', parent_id, 0, base_snapshot, null
  );
  if (persisted ->> 'revision')::integer <> 1 then
    raise exception 'Initial scoring revision must be 1';
  end if;

  if not exists (
    select 1 from public.candidate_answers answer
    where answer.id = answer_id
      and answer.answer_text = 'immutable raw text'
      and answer.answer_json = '{"raw":"immutable"}'::jsonb
  ) then
    raise exception 'Raw response changed during scoring persistence';
  end if;

  audit_payload := jsonb_build_object(
    'actor_id', null,
    'reason', 'manual',
    'session_id', fixture_session_id,
    'previous_engine_version', null,
    'previous_schema_version', null,
    'previous_result_json', null,
    'previous_aggregate_json', '{}'::jsonb,
    'previous_revision', 1
  );
  attempted_snapshot := jsonb_set(
    jsonb_set(base_snapshot, '{sessions,0,score}', '20'::jsonb),
    '{results,0,raw_score}', '20'::jsonb
  );
  persisted := public.persist_scoring_snapshot(
    'candidate', parent_id, 1, attempted_snapshot, audit_payload
  );
  if (persisted ->> 'revision')::integer <> 2 then
    raise exception 'First recalculation revision must be 2';
  end if;

  -- Fail after session/results/child replacements have begun. The complete
  -- function call must roll back to revision 2 and score 20.
  attempted_snapshot := jsonb_set(
    attempted_snapshot,
    '{risks}',
    '[{"risk_key":"forced_failure","risk_level":"invalid","title":"fail"}]'::jsonb
  );
  begin
    perform public.persist_scoring_snapshot(
      'candidate', parent_id, 2, attempted_snapshot, null
    );
    raise exception 'Expected mid-persistence failure';
  exception when check_violation then
    null;
  end;
  select application.scoring_revision, session.score
  into stored_revision, stored_score
  from public.candidate_applications application
  join public.test_sessions session on session.application_id = application.id
  where application.id = parent_id and session.id = fixture_session_id;
  if stored_revision <> 2 or stored_score <> 20 then
    raise exception 'Mid-persistence failure left partial derived state';
  end if;

  -- A foreign actor makes the final audit insert fail. Every scoring write in
  -- the same RPC must roll back.
  audit_payload := jsonb_set(
    audit_payload,
    '{actor_id}',
    '"f1000000-0000-4000-8000-000000000099"'::jsonb
  );
  audit_payload := jsonb_set(audit_payload, '{previous_revision}', '2'::jsonb);
  begin
    perform public.persist_scoring_snapshot(
      'candidate', parent_id, 2,
      jsonb_set(attempted_snapshot, '{risks}', '[]'::jsonb),
      audit_payload
    );
    raise exception 'Expected audit insert failure';
  exception when foreign_key_violation then
    null;
  end;
  select application.scoring_revision, session.score
  into stored_revision, stored_score
  from public.candidate_applications application
  join public.test_sessions session on session.application_id = application.id
  where application.id = parent_id and session.id = fixture_session_id;
  if stored_revision <> 2 or stored_score <> 20 then
    raise exception 'Audit failure did not roll back scoring changes';
  end if;

  -- A stale writer models the loser of two concurrent recalculations.
  begin
    perform public.persist_scoring_snapshot(
      'candidate', parent_id, 1, base_snapshot, null
    );
    raise exception 'Expected stale revision conflict';
  exception when serialization_failure then
    null;
  end;

  audit_payload := jsonb_set(audit_payload, '{actor_id}', 'null'::jsonb);
  persisted := public.persist_scoring_snapshot(
    'candidate', parent_id, 2,
    jsonb_set(attempted_snapshot, '{risks}', '[]'::jsonb),
    audit_payload
  );
  if (persisted ->> 'revision')::integer <> 3 then
    raise exception 'Two successful recalculations must advance revision twice';
  end if;

  select count(*) into audit_count
  from public.scoring_recalculation_history history
  where history.session_id = fixture_session_id and history.status = 'completed';
  if audit_count <> 2 then
    raise exception 'Successful recalculation and audit did not persist together';
  end if;
end;
$$;

rollback;
