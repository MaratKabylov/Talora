-- PERF-005d: finish a saved session and start its successor atomically.
-- Requires lease/answer V2 and the current candidate/employee schema. No scoring here.
create or replace function public.complete_assessment_session_v2(
  p_scope text, p_token text, p_session_id uuid, p_client_id text, p_device_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owners text; invitations text; sessions text; answers text; owner_column text;
  people text; person_column text; contexts text; context_column text;
  owner_row record; access_row record; session_row record; question_row record; next_row record;
  control_result jsonb; normalized jsonb; draft jsonb; eligible_sql text;
  presentation jsonb; all_completed boolean; missing_section integer := 0;
  completed_time timestamptz; effective_deadline timestamptz;
begin
  if p_scope is null or p_scope not in ('candidate','employee') or p_token is null
    or p_token !~* '^[a-f0-9]{64}$' or p_session_id is null
    or p_client_id is null or p_client_id !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    or p_device_id is null or p_device_id !~* '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
    then return jsonb_build_object('status','unavailable'); end if;
  if p_scope = 'employee' then
    owners := 'employee_assessment_participants'; invitations := 'employee_assessment_invitations';
    sessions := 'employee_assessment_sessions'; answers := 'employee_assessment_answers'; owner_column := 'participant_id';
    people := 'employees'; person_column := 'employee_id'; contexts := 'employee_assessments'; context_column := 'employee_assessment_id';
  else
    owners := 'candidate_applications'; invitations := 'invitations'; sessions := 'test_sessions';
    answers := 'candidate_answers'; owner_column := 'application_id';
    people := 'candidates'; person_column := 'candidate_id'; contexts := 'jobs'; context_column := 'job_id';
  end if;
  -- Same owner -> invitation -> session lock order as lease/cancellation. Acquire
  -- UPDATE up front, never upgrade a shared owner lock after locking the session.
  -- Serializes simultaneous completion/retries for different tests of one owner.
  execute format('select o.id, o.company_id, o.status, i.id as invitation_id from public.%I i
    join public.%I o on o.id = i.%I and o.company_id = i.company_id
    where i.token = $1 for update of o', invitations, owners, owner_column) into owner_row using p_token;
  if owner_row.id is null or owner_row.status not in ('invited','in_progress','completed') then
    return jsonb_build_object('status','unavailable'); end if;
  execute format('select i.id, i.status, i.expires_at, i.consent_given_at, person.id as person_id, package.id as package_id
    from public.%I i join public.%I o on o.id = i.%I and o.company_id = i.company_id
    join public.%I person on person.id = i.%I and person.id = o.%I and person.company_id = i.company_id
    join public.%I context on context.id = i.%I and context.id = o.%I and context.company_id = i.company_id
    left join public.assessment_packages package on package.id = context.assessment_package_id
      and (package.company_id is null or package.company_id = i.company_id)
    where i.token = $1 and i.id = $2 and o.id = $3 and i.company_id = $4 for share of i',
    invitations, owners, owner_column, people, person_column, person_column, contexts, context_column, context_column)
    into access_row using p_token, owner_row.invitation_id, owner_row.id, owner_row.company_id;
  if access_row.id is null then return jsonb_build_object('status','unavailable'); end if;
  execute format('select s.* from public.%I s where s.id = $1 and s.%I = $2 and s.%I = $3 for update of s',
    sessions, owner_column, person_column) into session_row using p_session_id, owner_row.id, access_row.person_id;
  if session_row.id is null then return jsonb_build_object('status','unavailable'); end if;
  if access_row.status = 'completed' and session_row.status = 'completed' then
    return jsonb_build_object('status','finished'); end if;
  if access_row.status <> 'started' or access_row.consent_given_at is null
    or access_row.expires_at <= clock_timestamp() then return jsonb_build_object('status','unavailable'); end if;

  -- Match the overview/legacy eligibility and ordering, without loading other test content.
  if p_scope = 'candidate' then
    eligible_sql := 'select s.id, s.status, s.test_version_id, pt.order_index::bigint as order_index
      from public.test_sessions s join public.assessment_package_tests pt on pt.package_id = $3 and pt.test_version_id = s.test_version_id
      join public.test_versions v on v.id = s.test_version_id and v.status = ''published''
      where s.application_id = $1 and s.candidate_id = $2';
  else
    if access_row.package_id is null and not exists (select 1 from public.employee_assessment_sessions s
      join public.assessment_packages p on p.id = s.package_id and (p.company_id is null or p.company_id = owner_row.company_id)
      where s.participant_id = owner_row.id and s.employee_id = access_row.person_id) then
      return jsonb_build_object('status','unavailable'); end if;
    eligible_sql := 'select s.id, s.status, s.test_version_id,
      coalesce(case when v.status = ''published'' then pt.order_index end, s.package_order_index,
        row_number() over (order by s.created_at, s.id) - 1) as order_index
      from public.employee_assessment_sessions s join public.test_versions v on v.id = s.test_version_id
      left join public.assessment_package_tests pt on pt.package_id = $3 and pt.test_version_id = s.test_version_id
      where s.participant_id = $1 and s.employee_id = $2';
  end if;
  execute format('select exists(select 1 from (%s) e where e.id = $4)', eligible_sql)
    into all_completed using owner_row.id, access_row.person_id, access_row.package_id, p_session_id;
  if not all_completed then return jsonb_build_object('status','unavailable'); end if;

  if session_row.status = 'in_progress' then
    control_result := public.control_assessment_session_lease_v2(p_scope,p_token,p_session_id,p_client_id,p_device_id,'heartbeat','{}');
    if control_result ->> 'status' <> 'active' then return control_result; end if;
    effective_deadline := (control_result ->> 'deadlineAt')::timestamptz;
    select settings_json into presentation from public.test_versions where id = session_row.test_version_id;
    -- Validate saved values inside the session lock. No answers/content leave SQL.
    -- One-question requires explicit finalized rows, including optional skip markers.
    -- Section mode permits absent optional answers, but not incomplete required drafts.
    for question_row in execute format('with sections as (
      select id, (row_number() over (order by order_index,id)-1)::integer position from public.test_sections where test_version_id = $1
    ) select q.id, q.settings_json, s.position, a.id as answer_id, a.answer_json, a.answer_text, a.selected_option_id,
      parent.id as parent_id from sections s join public.questions q on q.section_id = s.id
      left join public.questions parent on parent.section_id in (select id from sections) and parent.settings_json ->> ''remediationQuestionId'' = q.id::text
      left join public.%I pa on pa.session_id = $2 and pa.question_id = parent.id
      left join public.%I a on a.session_id = $2 and a.question_id = q.id
      where parent.id is null or pa.is_correct = false order by s.position,q.order_index,q.id', answers, answers)
      using session_row.test_version_id, p_session_id
    loop
      missing_section := question_row.position;
      if question_row.answer_id is null then
        if presentation ->> 'presentationMode' = 'one_question' or question_row.parent_id is not null
          or coalesce((question_row.settings_json ->> 'required')::boolean,true) then
          raise exception 'missing' using errcode = 'TVC01'; end if;
        continue;
      end if;
      draft := coalesce(question_row.answer_json,'{}'::jsonb) || jsonb_build_object(
        'answerText',question_row.answer_text,'selectedOptionId',question_row.selected_option_id,
        'scaleValue',question_row.answer_json -> 'value');
      begin
        normalized := public.normalize_assessment_answer_v2(question_row.id,draft,true);
      exception when sqlstate 'TVF01' or sqlstate 'TVM01' or sqlstate '22023' or raise_exception then
        raise exception 'invalid_answer' using errcode = 'TVC01';
      end;
      if (normalized is null or normalized -> 'answer_json' -> 'skipped' = 'true'::jsonb)
        and (question_row.parent_id is not null or coalesce((question_row.settings_json ->> 'required')::boolean,true)) then
        raise exception 'required' using errcode = 'TVC01'; end if;
    end loop;
    completed_time := clock_timestamp();
    execute format('update public.%I set status = ''completed'', completed_at = $1, submission_reason = $2,
      time_spent_seconds = case when started_at is null then null else greatest(0,round(extract(epoch from ($1-started_at))))::integer end,
      active_client_id_hash = null, active_device_id_hash = null, last_heartbeat_at = null, lease_expires_at = null where id = $3', sessions)
      using completed_time, case when p_scope = 'employee' then 'employee' else 'candidate' end, p_session_id;
  elsif session_row.status <> 'completed' then return jsonb_build_object('status','unavailable'); end if;

  -- Include ALL assigned sessions in readiness, as the existing scoring finalizer does.
  execute format('select bool_and(status = ''completed'') from public.%I where %I = $1', sessions, owner_column)
    into all_completed using owner_row.id;
  if not all_completed then
    execute format('select e.* from (%s) e where status in (''in_progress'',''not_started'')
      order by (status = ''in_progress'') desc, order_index, id limit 1', eligible_sql)
      into next_row using owner_row.id, access_row.person_id, access_row.package_id;
    if next_row.id is not null then
      -- Owner lock serializes new V2 successors; conditional update also preserves legacy starts.
      execute format('update public.%I s set status = ''in_progress'', started_at = clock_timestamp(),
        deadline_at = case when v.duration_minutes is null then null else clock_timestamp()+make_interval(mins => v.duration_minutes) end
        from public.test_versions v where s.id = $1 and s.test_version_id = v.id and s.status = ''not_started''', sessions) using next_row.id;
    end if;
  end if;
  -- Slow triggers may cross a deadline. Roll back completion AND successor AND heartbeat.
  if access_row.expires_at <= clock_timestamp() then raise exception 'unavailable' using errcode = 'TVC03'; end if;
  if effective_deadline <= clock_timestamp() then raise exception 'expired' using errcode = 'TVC02'; end if;
  if all_completed then
    return jsonb_build_object('status','ready','ownerId',owner_row.id,'invitationId',access_row.id);
  end if;
  return jsonb_build_object('status','next','nextSessionId',next_row.id);
exception
  when sqlstate 'TVC01' then return jsonb_build_object('status','incomplete','sectionIndex',missing_section);
  when sqlstate 'TVC02' then return jsonb_build_object('status','expired');
  when sqlstate 'TVC03' then return jsonb_build_object('status','unavailable');
end;
$$;
revoke all on function public.complete_assessment_session_v2(text,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.complete_assessment_session_v2(text,text,uuid,text,text) to service_role;
