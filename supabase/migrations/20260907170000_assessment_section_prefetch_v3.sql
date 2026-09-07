-- PERF-004c/005c. Requires read_assessment_section_v2 and the existing integrity schema.
-- No writes, progress/lease changes or scoring. Old V2 remains the rollout fallback.
create or replace function public.read_assessment_section_navigation_v3(
  p_scope text, p_token text, p_session_id uuid, p_section_index integer,
  p_review boolean default false, p_mode text default 'navigate',
  p_cached_section_id uuid default null, p_cached_version_id uuid default null
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
     or p_token is null or p_token !~* '^[a-f0-9]{64}$' or p_session_id is null
     or p_section_index is null or p_section_index < 0
     or p_mode is null or p_mode not in ('prefetch', 'navigate') then return null; end if;
  if p_scope = 'employee' then
    invitation_table := 'employee_assessment_invitations';
    owner_table := 'employee_assessment_participants'; owner_column := 'participant_id';
    session_table := 'employee_assessment_sessions'; answer_table := 'employee_assessment_answers';
  else
    invitation_table := 'invitations';
    owner_table := 'candidate_applications'; owner_column := 'application_id';
    session_table := 'test_sessions'; answer_table := 'candidate_answers';
  end if;
  -- Access, canonical selection and answers share one statement snapshot. Validate
  -- again on EVERY transition; a prefetched object is never evidence of live access.
  execute format(
    'select session.test_version_id, version.settings_json
     from public.%I invitation
     join public.%I owner on owner.id = invitation.%I and owner.company_id = invitation.company_id
     join public.%I session on session.%I = owner.id and session.id = $2
     join public.test_versions version on version.id = session.test_version_id
     where invitation.token = $1 and invitation.status = ''started''
       and invitation.consent_given_at is not null
       and (invitation.expires_at is null or invitation.expires_at > statement_timestamp())
       and session.status = ''in_progress''
       and (session.deadline_at is null or session.deadline_at > statement_timestamp())
       and version.status in (''published'', ''archived'')',
    invitation_table, owner_table, owner_column, session_table, owner_column
  ) into access_row using p_token, p_session_id;
  if access_row.test_version_id is null then return null; end if;

  -- Keep V2's section/progress semantics, including optional skips and remediation.
  execute format(
    'with version_questions as materialized (
       select q.id, q.section_id, q.settings_json ->> ''remediationQuestionId'' as remediation_question_id
       from public.questions q join public.test_sections s on s.id = q.section_id where s.test_version_id = $1
     ), counts as (
       select s.id, s.title, s.order_index, count(q.id)::integer as question_count,
         count(q.id) filter (where parent.id is null or pa.is_correct = false)::integer as visible_count,
         count(q.id) filter (where (parent.id is null or pa.is_correct = false) and a.id is null)::integer as incomplete_count
       from public.test_sections s left join version_questions q on q.section_id = s.id
       left join version_questions parent on parent.remediation_question_id = q.id::text
       left join public.%I a on a.session_id = $2 and a.question_id = q.id
       left join public.%I pa on pa.session_id = $2 and pa.question_id = parent.id
       where s.test_version_id = $1 group by s.id, s.title, s.order_index
     ) select coalesce(jsonb_agg(jsonb_build_object(''id'', id, ''title'', title, ''orderIndex'', order_index,
       ''questionCount'', question_count, ''visibleQuestionCount'', visible_count,
       ''incompleteQuestionCount'', incomplete_count) order by order_index, id), ''[]''::jsonb) from counts',
    answer_table, answer_table
  ) into manifest using access_row.test_version_id, p_session_id;
  review_mode := coalesce(access_row.settings_json ->> 'presentationMode' = 'one_question', false)
    and case when jsonb_typeof(access_row.settings_json -> 'allowBack') = 'boolean'
      then (access_row.settings_json ->> 'allowBack')::boolean else true end and coalesce(p_review, false);
  section_index := least(p_section_index, greatest(jsonb_array_length(manifest) - 1, 0));
  if access_row.settings_json ->> 'presentationMode' = 'one_question' and not review_mode then
    select (ordinality - 1)::integer into first_incomplete
    from jsonb_array_elements(manifest) with ordinality entry(value, ordinality)
    where (value ->> 'incompleteQuestionCount')::integer > 0 order by ordinality limit 1;
    section_index := coalesce(first_incomplete, section_index);
  end if;

  if p_mode = 'prefetch' then
    -- Exactly ONE lookahead from the authorized current selection. A client cannot
    -- chain lookaheads past the first unfinished one-question section. No review prefetch.
    if review_mode or p_review is true or section_index <> p_section_index
      or section_index + 1 >= jsonb_array_length(manifest) then return null; end if;
    section_index := section_index + 1;
  end if;
  selected_section_id := (manifest -> section_index ->> 'id')::uuid;
  if selected_section_id is null then return null; end if;

  if p_mode = 'navigate' then
    if p_cached_section_id is distinct from selected_section_id
      or p_cached_version_id is distinct from access_row.test_version_id then
      -- Remediation, progress or cache identity changed: return the real full section
      -- in this RPC, not stale content and not a second browser request.
      return jsonb_build_object('kind', 'full', 'snapshot',
        public.read_assessment_section_v2(p_scope, p_token, p_session_id, p_section_index, p_review));
    end if;
    -- No question text/options/content blocks on a cache hit. Metadata here is
    -- SERVER-ONLY: the TS presenter uses it to strip historical/scoring answer_json.
    execute format(
      'select coalesce(jsonb_object_agg(a.question_id::text, jsonb_build_object(
        ''questionType'', q.question_type, ''isStructured'', coalesce(q.settings_json -> ''structuredResponseVersion'' = ''1''::jsonb, false),
        ''answerJson'', a.answer_json, ''answerText'', a.answer_text, ''selectedOptionId'', a.selected_option_id,
        ''timeSpentSeconds'', a.time_spent_seconds,
        ''remediationRequired'', coalesce(a.is_correct = false and q.settings_json ->> ''remediationQuestionId'' is not null, false),
        ''incorrectFeedback'', case when a.is_correct = false and q.settings_json ->> ''remediationQuestionId'' is not null
          then q.settings_json ->> ''incorrectFeedback'' end
      )), ''{}''::jsonb) from public.%I a join public.questions q on q.id = a.question_id
      where a.session_id = $1 and q.section_id = $2', answer_table
    ) into answer_payload using p_session_id, selected_section_id;
    return jsonb_build_object('kind', 'state', 'versionId', access_row.test_version_id,
      'sectionId', selected_section_id, 'sectionIndex', section_index, 'reviewMode', review_mode,
      'sections', manifest, 'answers', answer_payload);
  end if;

  -- Immutable content only: NO answers, progress, incorrect feedback or scoring keys.
  -- Raw option/target links must be separated and shuffled by the server presenter.
  select jsonb_build_object('id', s.id, 'title', s.title, 'description', s.description,
    'settings_json', jsonb_build_object('contentBlocks', s.settings_json -> 'contentBlocks'),
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', q.id, 'question_type', q.question_type, 'text', q.text, 'description', q.description,
      'order_index', q.order_index, 'settings_json', jsonb_strip_nulls(jsonb_build_object(
        'required', q.settings_json -> 'required', 'min', q.settings_json -> 'min', 'max', q.settings_json -> 'max',
        'minSelections', q.settings_json -> 'minSelections', 'maxSelections', q.settings_json -> 'maxSelections',
        'mode', q.settings_json -> 'mode', 'structuredResponseVersion', q.settings_json -> 'structuredResponseVersion',
        'shuffleOptions', q.settings_json -> 'shuffleOptions', 'remediationQuestionId', q.settings_json -> 'remediationQuestionId')),
      'answer_options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'text', o.text,
        'order_index', o.order_index, 'match_text', o.match_text, 'match_target_id', o.match_target_id)
        order by o.order_index, o.id) from public.answer_options o where o.question_id = q.id), '[]'::jsonb)
    ) order by q.order_index, q.id) from public.questions q where q.section_id = s.id), '[]'::jsonb))
    into section_payload from public.test_sections s where s.id = selected_section_id and s.test_version_id = access_row.test_version_id;
  return jsonb_build_object('kind', 'content', 'versionId', access_row.test_version_id,
    'sectionIndex', section_index, 'section', section_payload);
end;
$$;
revoke all on function public.read_assessment_section_navigation_v3(text, text, uuid, integer, boolean, text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.read_assessment_section_navigation_v3(text, text, uuid, integer, boolean, text, uuid, uuid)
  to service_role;
