-- PERF-004a: read-only section snapshot. Deploy this file, NOT tests/fixtures/*.sql.
create or replace function public.read_assessment_section_v2(
  p_scope text, p_token text, p_session_id uuid,
  p_section_index integer default 0, p_review boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  invitation_table text;
  owner_table text;
  owner_column text;
  session_table text;
  answer_table text;
  access_row record;
  manifest jsonb;
  section_index integer;
  selected_section_id uuid;
  first_incomplete integer;
  review_mode boolean;
  section_payload jsonb;
  answer_payload jsonb;
begin
  if p_scope is null or p_scope not in ('candidate', 'employee')
     or p_token is null or p_token !~* '^[a-f0-9]{64}$' or p_session_id is null then
    return null;
  end if;
  if p_scope = 'employee' then
    invitation_table := 'employee_assessment_invitations';
    owner_table := 'employee_assessment_participants'; owner_column := 'participant_id';
    session_table := 'employee_assessment_sessions'; answer_table := 'employee_assessment_answers';
  else
    invitation_table := 'invitations';
    owner_table := 'candidate_applications'; owner_column := 'application_id';
    session_table := 'test_sessions'; answer_table := 'candidate_answers';
  end if;

  -- The function is STABLE: access, progress and content use one statement snapshot.
  -- No Auth user/lease mutation is needed to read public token-flow content.
  execute format(
    'select session.test_version_id, version.settings_json
     from public.%I invitation
     join public.%I owner on owner.id = invitation.%I and owner.company_id = invitation.company_id
     join public.%I session on session.%I = owner.id and session.id = $2
     join public.test_versions version on version.id = session.test_version_id
     where invitation.token = $1 and invitation.status = ''started''
       and invitation.consent_given_at is not null
       and (invitation.expires_at is null or invitation.expires_at > statement_timestamp())
       and session.status = ''in_progress''',
    invitation_table, owner_table, owner_column, session_table, owner_column
  ) into access_row using p_token, p_session_id;
  if access_row.test_version_id is null then return null; end if;

  -- Compute progress in SQL without returning other sections' question IDs/answers.
  execute format(
    'with version_questions as materialized (
       select question.id, question.section_id,
         question.settings_json ->> ''remediationQuestionId'' as remediation_question_id
       from public.questions question join public.test_sections section on section.id = question.section_id
       where section.test_version_id = $1
     ), counts as (
       select section.id, section.title, section.order_index,
         count(question.id)::integer as question_count,
         count(question.id) filter (where parent.id is null or parent_answer.is_correct = false)::integer as visible_count,
         count(question.id) filter (where (parent.id is null or parent_answer.is_correct = false) and answer.id is null)::integer as incomplete_count
       from public.test_sections section
       left join version_questions question on question.section_id = section.id
       left join version_questions parent on parent.remediation_question_id = question.id::text
       left join public.%I answer on answer.session_id = $2 and answer.question_id = question.id
       left join public.%I parent_answer on parent_answer.session_id = $2 and parent_answer.question_id = parent.id
       where section.test_version_id = $1
       group by section.id, section.title, section.order_index
     ) select coalesce(jsonb_agg(jsonb_build_object(
       ''id'', id, ''title'', title, ''orderIndex'', order_index, ''questionCount'', question_count,
       ''visibleQuestionCount'', visible_count, ''incompleteQuestionCount'', incomplete_count
     ) order by order_index, id), ''[]''::jsonb) from counts', answer_table, answer_table
  ) into manifest using access_row.test_version_id, p_session_id;

  review_mode := coalesce(access_row.settings_json ->> 'presentationMode' = 'one_question', false)
    and case when jsonb_typeof(access_row.settings_json -> 'allowBack') = 'boolean'
      then (access_row.settings_json ->> 'allowBack')::boolean else true end
    and coalesce(p_review, false);
  section_index := least(greatest(coalesce(p_section_index, 0), 0), greatest(jsonb_array_length(manifest) - 1, 0));
  if access_row.settings_json ->> 'presentationMode' = 'one_question' and not review_mode then
    select (ordinality - 1)::integer into first_incomplete
    from jsonb_array_elements(manifest) with ordinality entry(value, ordinality)
    where (value ->> 'incompleteQuestionCount')::integer > 0 order by ordinality limit 1;
    section_index := coalesce(first_incomplete, section_index);
  end if;
  selected_section_id := (manifest -> section_index ->> 'id')::uuid;

  -- Explicit projections only. Raw option-target links below are SERVER-ONLY and
  -- must be separated/shuffled by the TS presenter before any browser serialization.
  execute format(
    'select jsonb_build_object(''id'', section.id, ''title'', section.title,
       ''description'', section.description, ''settings_json'', jsonb_build_object(''contentBlocks'', section.settings_json -> ''contentBlocks''),
       ''questions'', coalesce((select jsonb_agg(jsonb_build_object(
         ''id'', question.id, ''question_type'', question.question_type, ''text'', question.text,
         ''description'', question.description, ''order_index'', question.order_index,
         ''settings_json'', jsonb_strip_nulls(jsonb_build_object(
           ''required'', question.settings_json -> ''required'', ''min'', question.settings_json -> ''min'',
           ''max'', question.settings_json -> ''max'', ''minSelections'', question.settings_json -> ''minSelections'',
           ''maxSelections'', question.settings_json -> ''maxSelections'', ''mode'', question.settings_json -> ''mode'',
           ''structuredResponseVersion'', question.settings_json -> ''structuredResponseVersion'',
           ''shuffleOptions'', question.settings_json -> ''shuffleOptions'',
           ''remediationQuestionId'', question.settings_json -> ''remediationQuestionId'',
           ''incorrectFeedback'', case when answer.is_correct = false then question.settings_json -> ''incorrectFeedback'' end)),
         ''answer_options'', coalesce((select jsonb_agg(jsonb_build_object(
           ''id'', option.id, ''text'', option.text, ''order_index'', option.order_index,
           ''match_text'', option.match_text, ''match_target_id'', option.match_target_id
         ) order by option.order_index, option.id) from public.answer_options option where option.question_id = question.id), ''[]''::jsonb)
       ) order by question.order_index, question.id)
       from public.questions question left join public.%I answer on answer.session_id = $2 and answer.question_id = question.id
       where question.section_id = section.id), ''[]''::jsonb))
     from public.test_sections section where section.id = $1 and section.test_version_id = $3', answer_table
  ) into section_payload using selected_section_id, p_session_id, access_row.test_version_id;

  execute format(
    'select coalesce(jsonb_object_agg(answer.question_id::text, jsonb_build_object(
       ''answerJson'', answer.answer_json, ''answerText'', answer.answer_text,
       ''selectedOptionId'', answer.selected_option_id, ''timeSpentSeconds'', answer.time_spent_seconds,
       ''remediationRequired'', coalesce(answer.is_correct = false and question.settings_json ->> ''remediationQuestionId'' is not null, false)
     )), ''{}''::jsonb)
     from public.%I answer join public.questions question on question.id = answer.question_id
     where answer.session_id = $1 and question.section_id = $2', answer_table
  ) into answer_payload using p_session_id, selected_section_id;
  return jsonb_build_object('sections', manifest, 'sectionIndex', section_index,
    'reviewMode', review_mode, 'section', section_payload, 'answers', answer_payload);
end;
$$;
revoke all on function public.read_assessment_section_v2(text, text, uuid, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.read_assessment_section_v2(text, text, uuid, integer, boolean)
  to service_role;
