-- PERF-005b. Requires the lease/answer V2 migrations. NOT a test fixture.
create or replace function public.save_assessment_section_v2(
  p_scope text, p_token text, p_session_id uuid, p_client_id text, p_device_id text,
  p_section_id uuid, p_answers jsonb, p_direction text default 'next'
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
  invitation_deadline timestamptz;
  consent_at timestamptz;
  section_index integer;
  section_count integer;
  question_row record;
  submitted jsonb;
  normalized jsonb;
  normalized_by_id jsonb := '{}'::jsonb;
  rows_to_save jsonb := '[]'::jsonb;
  ids_to_clear uuid[] := array[]::uuid[];
  parent_id uuid;
  parent_correct boolean;
  answer_correct boolean;
  elapsed_seconds integer;
  needs_remediation boolean := false;
begin
  -- Holds owner/invitation/session locks until the entire batch commits.
  control_result := public.control_assessment_session_lease_v2(
    p_scope, p_token, p_session_id, p_client_id, p_device_id, 'heartbeat', '{}'::jsonb);
  if control_result ->> 'status' <> 'active' then return control_result; end if;
  if p_section_id is null or p_direction is null or p_direction not in ('next', 'previous')
     or jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'invalid' using errcode = 'TVS01';
  end if;
  if jsonb_array_length(p_answers) > 1000 then raise exception 'invalid' using errcode = 'TVS01'; end if;
  answer_table := case when p_scope = 'employee' then 'employee_assessment_answers' else 'candidate_answers' end;
  session_table := case when p_scope = 'employee' then 'employee_assessment_sessions' else 'test_sessions' end;
  execute format('select s.test_version_id, v.settings_json from public.%I s
    join public.test_versions v on v.id = s.test_version_id where s.id = $1', session_table)
    into version_id, presentation using p_session_id;
  execute format('select expires_at, consent_given_at from public.%I where token = $1',
    case when p_scope = 'employee' then 'employee_assessment_invitations' else 'invitations' end)
    into invitation_deadline, consent_at using p_token;
  if consent_at is null then raise exception 'unavailable' using errcode = 'TVS03'; end if;
  if presentation ->> 'presentationMode' = 'one_question' then raise exception 'mode' using errcode = 'TVS01'; end if;
  if p_direction = 'previous' and presentation -> 'allowBack' = 'false'::jsonb then
    raise exception 'back' using errcode = 'TVS01';
  end if;
  select position, total into section_index, section_count from (
    select id, (row_number() over (order by order_index, id) - 1)::integer position,
      count(*) over ()::integer total from public.test_sections where test_version_id = version_id
  ) sections where id = p_section_id;
  if section_index is null then raise exception 'section' using errcode = 'TVS01'; end if;

  -- Unknown/duplicate IDs must not become a partial write or cross-section update.
  if exists (select 1 from jsonb_array_elements(p_answers) item
      where jsonb_typeof(item) <> 'object' or jsonb_typeof(item -> 'answer') is distinct from 'object'
        or not exists (select 1 from public.questions q where q.section_id = p_section_id and q.id::text = item ->> 'questionId'))
     or (select count(*) <> count(distinct item ->> 'questionId') from jsonb_array_elements(p_answers) item) then
    raise exception 'invalid' using errcode = 'TVS01';
  end if;

  -- Normalize root answers first so branch visibility is based on THIS submission,
  -- never on a stale autosave. Remediation targets are handled in the second pass.
  for question_row in select q.* from public.questions q where q.section_id = p_section_id
    and not exists (select 1 from public.questions parent join public.test_sections s on s.id = parent.section_id
      where s.test_version_id = version_id and parent.settings_json ->> 'remediationQuestionId' = q.id::text)
    order by q.order_index, q.id
  loop
    select item into submitted from jsonb_array_elements(p_answers) item where item ->> 'questionId' = question_row.id::text;
    if submitted is null then raise exception 'missing' using errcode = 'TVS01'; end if;
    normalized := public.normalize_assessment_answer_v2(question_row.id, submitted -> 'answer', true);
    if normalized is null and coalesce((question_row.settings_json ->> 'required')::boolean, true) then
      raise exception 'required' using errcode = 'TVS01';
    end if;
    answer_correct := null;
    if question_row.question_type = 'single_choice' and question_row.settings_json ->> 'remediationQuestionId' is not null then
      select is_correct into answer_correct from public.answer_options
        where question_id = question_row.id and id::text = normalized ->> 'selected_option_id';
    end if;
    normalized_by_id := normalized_by_id || jsonb_build_object(question_row.id::text,
      jsonb_build_object('answer', normalized, 'is_correct', answer_correct));
    if answer_correct is distinct from false then
      ids_to_clear := ids_to_clear || array(select target.id from public.questions target
        join public.test_sections s on s.id = target.section_id
        where s.test_version_id = version_id and target.id::text = question_row.settings_json ->> 'remediationQuestionId');
    end if;
  end loop;

  for question_row in select * from public.questions where section_id = p_section_id order by order_index, id loop
    select item into submitted from jsonb_array_elements(p_answers) item where item ->> 'questionId' = question_row.id::text;
    select parent.id into parent_id from public.questions parent join public.test_sections s on s.id = parent.section_id
      where s.test_version_id = version_id and parent.settings_json ->> 'remediationQuestionId' = question_row.id::text;
    if parent_id is not null then
      if normalized_by_id ? parent_id::text then
        parent_correct := (normalized_by_id -> parent_id::text ->> 'is_correct')::boolean;
      else
        execute format('select is_correct from public.%I where session_id = $1 and question_id = $2', answer_table)
          into parent_correct using p_session_id, parent_id;
      end if;
      if parent_correct is distinct from false then
        ids_to_clear := array_append(ids_to_clear, question_row.id);
        continue;
      end if;
      -- A newly activated follow-up was not in the submitted form. Commit the parent
      -- and stay on this section so the participant can answer the new question.
      if submitted is null then
        normalized := null;
      else
        normalized := public.normalize_assessment_answer_v2(question_row.id, submitted -> 'answer', true);
      end if;
      if normalized is null or normalized -> 'answer_json' -> 'skipped' = 'true'::jsonb then
        needs_remediation := true;
        normalized := null;
      end if;
      answer_correct := null;
    else
      normalized := nullif(normalized_by_id -> question_row.id::text -> 'answer', 'null'::jsonb);
      answer_correct := (normalized_by_id -> question_row.id::text ->> 'is_correct')::boolean;
    end if;
    if submitted ? 'timeSpentSeconds' and jsonb_typeof(submitted -> 'timeSpentSeconds') is distinct from 'number' then
      raise exception 'invalid' using errcode = 'TVS01';
    end if;
    if (submitted ->> 'timeSpentSeconds')::numeric <> trunc((submitted ->> 'timeSpentSeconds')::numeric) then
      raise exception 'invalid' using errcode = 'TVS01';
    end if;
    elapsed_seconds := (submitted ->> 'timeSpentSeconds')::integer;
    if elapsed_seconds < 0 or elapsed_seconds > 604800 then raise exception 'invalid' using errcode = 'TVS01'; end if;
    if normalized is null then
      ids_to_clear := array_append(ids_to_clear, question_row.id);
    else
      rows_to_save := rows_to_save || jsonb_build_array(normalized || jsonb_build_object(
        'question_id', question_row.id, 'is_correct', answer_correct,
        'time_spent_seconds', case when presentation -> 'captureQuestionTime' = 'true'::jsonb then elapsed_seconds end));
    end if;
  end loop;

  execute format('insert into public.%I as a
    (session_id, question_id, answer_json, answer_text, selected_option_id, is_correct, points_awarded, time_spent_seconds)
    select $1, r.question_id, r.answer_json, r.answer_text, r.selected_option_id, r.is_correct, null, r.time_spent_seconds
    from jsonb_to_recordset($2) r(question_id uuid, answer_json jsonb, answer_text text,
      selected_option_id uuid, is_correct boolean, time_spent_seconds integer)
    on conflict (session_id, question_id) do update set answer_json = excluded.answer_json,
      answer_text = excluded.answer_text, selected_option_id = excluded.selected_option_id,
      is_correct = excluded.is_correct, points_awarded = null,
      time_spent_seconds = coalesce(excluded.time_spent_seconds, a.time_spent_seconds)', answer_table)
    using p_session_id, rows_to_save;
  execute format('delete from public.%I where session_id = $1 and question_id = any($2)', answer_table)
    using p_session_id, ids_to_clear;
  if invitation_deadline <= clock_timestamp() then raise exception 'unavailable' using errcode = 'TVS03'; end if;
  if (control_result ->> 'deadlineAt')::timestamptz <= clock_timestamp() then
    raise exception 'expired' using errcode = 'TVS02';
  end if;
  return control_result || jsonb_build_object('savedAt', clock_timestamp(), 'needsRemediation', needs_remediation,
    'sectionIndex', section_index, 'nextSectionIndex', case
      when p_direction = 'previous' then greatest(section_index - 1, 0)
      when needs_remediation then section_index
      else least(section_index + 1, section_count - 1) end);
exception
  -- These exceptions roll back the WHOLE batch and lease, including slow trigger writes.
  when sqlstate 'TVS02' then return jsonb_build_object('status', 'expired');
  when sqlstate 'TVS03' then return jsonb_build_object('status', 'unavailable');
end;
$$;
revoke all on function public.save_assessment_section_v2(text, text, uuid, text, text, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.save_assessment_section_v2(text, text, uuid, text, text, uuid, jsonb, text)
  to service_role;
