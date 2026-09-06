-- PERF-003b. Apply AFTER 20260906120000_assessment_session_lease_v2.sql.
-- This is the deployable migration; tests/fixtures/*.sql are NOT migrations.

-- Private normalization helper. Returns NULL for an empty/incomplete draft.
-- The public server-only save RPC verifies access before calling it.
create or replace function public.normalize_assessment_answer_v2(
  p_question_id uuid, p_draft jsonb, p_finalize boolean
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  question_row record;
  option_ids text[];
  target_ids text[];
  selected_ids text[];
  matching_ids text[];
  matching_targets text[];
  most_id text;
  least_id text;
  answer_json jsonb := '{}'::jsonb;
  answer_text text;
  selected_option text;
  scale_value numeric;
  minimum_count integer;
  maximum_count integer;
  required boolean;
  array_key text;
begin
  if jsonb_typeof(p_draft) is distinct from 'object' or p_finalize is null then
    raise exception 'Invalid answer draft' using errcode = '22023';
  end if;
  if p_draft ? 'answerText' and jsonb_typeof(p_draft -> 'answerText') not in ('null', 'string') then
    raise exception 'Invalid text answer';
  end if;
  foreach array_key in array array['selectedOptionIds', 'orderedOptionIds', 'matches'] loop
    if p_draft ? array_key then
      if jsonb_typeof(p_draft -> array_key) <> 'array' then raise exception 'Invalid answer array'; end if;
      if jsonb_array_length(p_draft -> array_key) > 100 then raise exception 'Answer array is too large'; end if;
    end if;
  end loop;
  select question.question_type, question.settings_json into question_row
  from public.questions question where question.id = p_question_id;
  if not found then raise exception 'Assessment question was not found'; end if;
  select coalesce(array_agg(option.id::text), array[]::text[]),
         coalesce(array_agg(option.match_target_id::text), array[]::text[])
    into option_ids, target_ids
  from public.answer_options option where option.question_id = p_question_id;
  required := coalesce((question_row.settings_json ->> 'required')::boolean, true);

  if question_row.question_type = 'forced_choice' then
    most_id := nullif(p_draft ->> 'mostOptionId', '');
    least_id := nullif(p_draft ->> 'leastOptionId', '');
    if most_id is null and least_id is null and not (p_finalize and required) then
      return null;
    end if;
    if not p_finalize and (most_id is null or least_id is null) then return null; end if;
    if question_row.settings_json ->> 'mode' is distinct from 'most_least' then
      raise exception 'mode' using errcode = 'TVF01';
    end if;
    if most_id is null or least_id is null then
      raise exception 'required' using errcode = 'TVF01';
    end if;
    if most_id = least_id then raise exception 'same' using errcode = 'TVF01'; end if;
    if not (most_id = any(option_ids)) or not (least_id = any(option_ids)) then
      raise exception 'foreign' using errcode = 'TVF01';
    end if;
    answer_json := jsonb_build_object('mostOptionId', most_id, 'leastOptionId', least_id);
  elsif question_row.question_type = 'single_choice' then
    selected_option := nullif(p_draft ->> 'selectedOptionId', '');
    if selected_option is null then return null; end if;
    if not (selected_option = any(option_ids)) then raise exception 'Invalid answer option'; end if;
  elsif question_row.question_type = 'multiple_choice' then
    if p_draft ? 'selectedOptionIds' and jsonb_typeof(p_draft -> 'selectedOptionIds') <> 'array' then
      raise exception 'ids' using errcode = 'TVM01';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_draft -> 'selectedOptionIds') item
      where jsonb_typeof(item) <> 'string'
        or item #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) then raise exception 'ids' using errcode = 'TVM01'; end if;
    select coalesce(array_agg(value order by value collate "C"), array[]::text[])
    into selected_ids from (select distinct value from jsonb_array_elements_text(p_draft -> 'selectedOptionIds')) ids;
    if cardinality(selected_ids) = 0 and not p_finalize then return null; end if;
    minimum_count := coalesce((question_row.settings_json ->> 'minSelections')::integer, case when required then 1 else 0 end);
    maximum_count := coalesce((question_row.settings_json ->> 'maxSelections')::integer, cardinality(option_ids));
    if cardinality(selected_ids) = 0 and not required then
      answer_json := '{"skipped":true}'::jsonb;
    else
      if exists (select 1 from unnest(selected_ids) selected_id where not (selected_id = any(option_ids))) then
        raise exception 'foreign' using errcode = 'TVM01';
      end if;
      if (cardinality(selected_ids) = 0 and required)
         or cardinality(selected_ids) < minimum_count or cardinality(selected_ids) > maximum_count then
        raise exception 'limits' using errcode = 'TVM01',
          detail = jsonb_build_object('min', minimum_count, 'max', maximum_count)::text;
      end if;
      answer_json := jsonb_build_object('selectedOptionIds', selected_ids);
    end if;
  elsif question_row.question_type = 'scale' then
    if coalesce(p_draft -> 'scaleValue', 'null'::jsonb) = 'null'::jsonb then return null; end if;
    if jsonb_typeof(p_draft -> 'scaleValue') <> 'number' then raise exception 'Invalid scale value'; end if;
    scale_value := (p_draft ->> 'scaleValue')::numeric;
    if scale_value <> trunc(scale_value)
       or scale_value < coalesce((question_row.settings_json ->> 'min')::numeric, 1)
       or scale_value > coalesce((question_row.settings_json ->> 'max')::numeric, 5) then
      raise exception 'Invalid scale value';
    end if;
    answer_json := jsonb_build_object('value', scale_value);
    answer_text := trunc(scale_value)::text;
  elsif question_row.question_type = 'ordering'
        and question_row.settings_json -> 'structuredResponseVersion' = '1'::jsonb then
    if not (p_draft ? 'orderedOptionIds') then return null; end if;
    if jsonb_typeof(p_draft -> 'orderedOptionIds') <> 'array' then raise exception 'Invalid ordering answer'; end if;
    if jsonb_array_length(p_draft -> 'orderedOptionIds') = 0 then return null; end if;
    select array_agg(value) into selected_ids from jsonb_array_elements_text(p_draft -> 'orderedOptionIds');
    if cardinality(selected_ids) <> cardinality(option_ids)
       or (select count(distinct value) from unnest(selected_ids) value) <> cardinality(selected_ids)
       or exists (select 1 from unnest(selected_ids) value where value is null or not (value = any(option_ids))) then
      raise exception 'Invalid ordering answer';
    end if;
    answer_json := jsonb_build_object('orderedOptionIds', selected_ids);
  elsif question_row.question_type = 'matching'
        and question_row.settings_json -> 'structuredResponseVersion' = '1'::jsonb then
    if not (p_draft ? 'matches') then return null; end if;
    if jsonb_typeof(p_draft -> 'matches') <> 'array' then raise exception 'Invalid matching answer'; end if;
    if jsonb_array_length(p_draft -> 'matches') = 0 then return null; end if;
    select array_agg(pair ->> 'optionId'), array_agg(pair ->> 'targetId'),
           jsonb_build_object('matches', jsonb_agg(jsonb_build_object('optionId', pair ->> 'optionId', 'targetId', pair ->> 'targetId')))
    into matching_ids, matching_targets, answer_json from jsonb_array_elements(p_draft -> 'matches') pair;
    if cardinality(matching_ids) > cardinality(option_ids)
       or (p_finalize and cardinality(matching_ids) <> cardinality(option_ids))
       or (select count(distinct value) from unnest(matching_ids) value) <> cardinality(matching_ids)
       or (select count(distinct value) from unnest(matching_targets) value) <> cardinality(matching_targets)
       or (select count(distinct value) from unnest(target_ids) value) <> cardinality(option_ids)
       or exists (select 1 from unnest(matching_ids) value where value is null or not (value = any(option_ids)))
       or exists (select 1 from unnest(matching_targets) value where value is null or not (value = any(target_ids))) then
      raise exception 'Invalid matching answer';
    end if;
  else
    -- JavaScript String.trim whitespace, including NBSP/BOM (not SQL btrim's space only).
    answer_text := btrim(coalesce(p_draft ->> 'answerText', ''),
      U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
    if answer_text = '' then return null; end if;
    -- JS length counts supplementary Unicode characters as two UTF-16 code units.
    if (select sum(case when octet_length(character) > 3 then 2 else 1 end)
        from regexp_split_to_table(answer_text, '') character) > 4000 then
      raise exception 'Assessment answer is too long';
    end if;
  end if;
  return jsonb_build_object('answer_json', answer_json, 'answer_text', answer_text,
                           'selected_option_id', selected_option);
end;
$$;
revoke all on function public.normalize_assessment_answer_v2(uuid, jsonb, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.save_assessment_answer_v2(
  p_scope text, p_token text, p_session_id uuid, p_client_id text, p_device_id text,
  p_question_id uuid, p_draft jsonb, p_finalize boolean default false,
  p_time_spent_seconds integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  control_result jsonb;
  answer_table text;
  session_table text;
  version_id uuid;
  presentation jsonb;
  question_row record;
  existing_answer record;
  next_question_id uuid;
  remediation_parent_id uuid;
  remediation_target_id uuid;
  normalized_answer jsonb;
  answer_is_correct boolean;
  incorrect_feedback text;
  one_question boolean;
  allow_back boolean;
  capture_time boolean;
  stored_time integer;
  invitation_deadline timestamptz;
begin
  -- The nested RPC holds owner/invitation/session locks until THIS transaction ends.
  -- Any validation/answer/remediation failure also rolls back its lease update.
  control_result := public.control_assessment_session_lease_v2(
    p_scope, p_token, p_session_id, p_client_id, p_device_id, 'heartbeat', '{}'::jsonb);
  if control_result ->> 'status' <> 'active' then return control_result; end if;
  if p_question_id is null or p_finalize is null or jsonb_typeof(p_draft) is distinct from 'object'
     or p_time_spent_seconds < 0 or p_time_spent_seconds > 604800 then
    raise exception 'Invalid answer request' using errcode = '22023';
  end if;
  answer_table := case when p_scope = 'employee' then 'employee_assessment_answers' else 'candidate_answers' end;
  session_table := case when p_scope = 'employee' then 'employee_assessment_sessions' else 'test_sessions' end;
  execute format('select session.test_version_id, version.settings_json from public.%I session
    join public.test_versions version on version.id = session.test_version_id where session.id = $1', session_table)
    into version_id, presentation using p_session_id;
  execute format('select expires_at from public.%I where token = $1',
    case when p_scope = 'employee' then 'employee_assessment_invitations' else 'invitations' end)
    into invitation_deadline using p_token;
  one_question := coalesce(presentation ->> 'presentationMode' = 'one_question', false);
  allow_back := case when jsonb_typeof(presentation -> 'allowBack') = 'boolean'
                     then (presentation ->> 'allowBack')::boolean else true end;
  capture_time := coalesce(presentation -> 'captureQuestionTime' = 'true'::jsonb, false);
  if one_question and not p_finalize then raise exception 'One-question answers must be finalized explicitly'; end if;

  select question.id, question.settings_json into question_row
  from public.questions question join public.test_sections section on section.id = question.section_id
  where question.id = p_question_id and section.test_version_id = version_id;
  if not found then raise exception 'Assessment question does not belong to the active test'; end if;

  if one_question then
    select parent.id into remediation_parent_id from public.questions parent
    join public.test_sections section on section.id = parent.section_id
    where section.test_version_id = version_id and parent.settings_json ->> 'remediationQuestionId' = p_question_id::text;
    -- Only accept an in-version target. Never delete another test's answer via metadata.
    select target.id into remediation_target_id from public.questions target
    join public.test_sections section on section.id = target.section_id
    where section.test_version_id = version_id and target.id::text = question_row.settings_json ->> 'remediationQuestionId';

    if not allow_back then
      execute format('select id, is_correct from public.%I where session_id = $1 and question_id = $2', answer_table)
        into existing_answer using p_session_id, p_question_id;
      if existing_answer.id is not null then
        return control_result || jsonb_build_object('answerIsCorrect', existing_answer.is_correct,
          'incorrectFeedback', case when existing_answer.is_correct = false then question_row.settings_json ->> 'incorrectFeedback' end,
          'savedAt', clock_timestamp());
      end if;
      execute format(
        'select question.id from public.questions question
         join public.test_sections section on section.id = question.section_id
         left join public.%I answer on answer.session_id = $1 and answer.question_id = question.id
         left join public.questions parent on parent.settings_json ->> ''remediationQuestionId'' = question.id::text
           and parent.section_id in (select id from public.test_sections where test_version_id = $2)
         left join public.%I parent_answer on parent_answer.session_id = $1 and parent_answer.question_id = parent.id
         where section.test_version_id = $2 and answer.id is null
           and (parent.id is null or parent_answer.is_correct = false)
         order by section.order_index, section.id, question.order_index, question.id limit 1', answer_table, answer_table)
        into next_question_id using p_session_id, version_id;
      if next_question_id is distinct from p_question_id then
        raise exception 'The assessment question is no longer available for editing';
      end if;
    end if;
  end if;

  normalized_answer := public.normalize_assessment_answer_v2(p_question_id, p_draft, p_finalize);
  if p_finalize and normalized_answer is null and one_question
     and (coalesce((question_row.settings_json ->> 'required')::boolean, true) or remediation_parent_id is not null) then
    raise exception 'A required assessment answer cannot be empty';
  end if;
  if p_finalize and normalized_answer is null then
    normalized_answer := jsonb_build_object('answer_json', '{"skipped":true}'::jsonb,
                                          'answer_text', null, 'selected_option_id', null);
  end if;
  if p_finalize and remediation_target_id is not null then
    -- Preserve V1 branch semantics. This is NOT a new scoring calculation.
    select option.is_correct into answer_is_correct from public.answer_options option
    where option.question_id = p_question_id and option.id::text = normalized_answer ->> 'selected_option_id';
    if answer_is_correct = false then incorrect_feedback := question_row.settings_json ->> 'incorrectFeedback'; end if;
  end if;

  if normalized_answer is null then
    execute format('delete from public.%I where session_id = $1 and question_id = $2', answer_table)
      using p_session_id, p_question_id;
  else
    stored_time := case when capture_time then p_time_spent_seconds end;
    execute format(
      'insert into public.%I as answer
        (session_id, question_id, answer_json, answer_text, selected_option_id, is_correct, points_awarded, time_spent_seconds)
       values ($1, $2, $3, $4, $5, $6, null, $7)
       on conflict (session_id, question_id) do update set
         answer_json = excluded.answer_json, answer_text = excluded.answer_text,
         selected_option_id = excluded.selected_option_id, is_correct = excluded.is_correct,
         points_awarded = null,
         time_spent_seconds = case when $8 then excluded.time_spent_seconds else answer.time_spent_seconds end', answer_table)
      using p_session_id, p_question_id, normalized_answer -> 'answer_json', normalized_answer ->> 'answer_text',
        (normalized_answer ->> 'selected_option_id')::uuid, answer_is_correct, stored_time, stored_time is not null;
  end if;
  if p_finalize and remediation_target_id is not null and answer_is_correct is distinct from false then
    execute format('delete from public.%I where session_id = $1 and question_id = $2', answer_table)
      using p_session_id, remediation_target_id;
  end if;
  -- A slow trigger/answer-row wait must not commit an answer after either cutoff.
  -- Raising inside this block rolls back answers, remediation AND the nested lease.
  if invitation_deadline <= clock_timestamp() then raise exception 'unavailable' using errcode = 'TVA02'; end if;
  if (control_result ->> 'deadlineAt')::timestamptz <= clock_timestamp() then
    raise exception 'expired' using errcode = 'TVA01';
  end if;
  return control_result || jsonb_build_object('answerIsCorrect', answer_is_correct,
      'incorrectFeedback', incorrect_feedback, 'savedAt', clock_timestamp());
exception
  when sqlstate 'TVA01' then return jsonb_build_object('status', 'expired');
  when sqlstate 'TVA02' then return jsonb_build_object('status', 'unavailable');
end;
$$;
revoke all on function public.save_assessment_answer_v2(text, text, uuid, text, text, uuid, jsonb, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.save_assessment_answer_v2(text, text, uuid, text, text, uuid, jsonb, boolean, integer)
  to service_role;
