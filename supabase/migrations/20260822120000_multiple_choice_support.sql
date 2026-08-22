-- Full multiple_choice answer contract and scoring persistence.
-- Published legacy questions remain review-only until settings_json contains
-- multipleChoiceScoringVersion = 1.

alter table public.candidate_answers
  add column if not exists raw_score numeric(12, 2);

alter table public.employee_assessment_answers
  add column if not exists raw_score numeric(12, 2);

create or replace function public.validate_multiple_choice_question_definition(
  target_question_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  question_record record;
  option_count integer;
  correct_count integer;
  incorrect_count integer;
  min_selections integer;
  max_selections integer;
  min_points numeric;
  correct_option_points numeric;
  incorrect_option_penalty numeric;
  correctness_threshold numeric;
  scoring_mode text;
  penalty_mode text;
  feasible_max numeric;
begin
  select question.question_type, question.points, question.competency_key,
         question.settings_json
  into question_record
  from public.questions question
  where question.id = target_question_id;

  if not found or question_record.question_type is distinct from 'multiple_choice' then
    return;
  end if;
  if question_record.settings_json ->> 'multipleChoiceScoringVersion' is distinct from '1' then
    return;
  end if;
  if jsonb_typeof(question_record.settings_json) is distinct from 'object' then
    raise exception 'Invalid multiple_choice settings';
  end if;

  scoring_mode := question_record.settings_json ->> 'scoringMode';
  penalty_mode := coalesce(question_record.settings_json ->> 'penaltyMode', 'none');
  if scoring_mode not in ('exact_match', 'partial_credit', 'option_points') then
    raise exception 'Invalid multiple_choice scoring mode';
  end if;
  if penalty_mode not in ('none', 'subtract') then
    raise exception 'Invalid multiple_choice penalty mode';
  end if;
  if question_record.points <= 0 then
    raise exception 'multiple_choice max points must be positive';
  end if;
  if jsonb_typeof(question_record.settings_json -> 'minSelections') is distinct from 'number'
     or jsonb_typeof(question_record.settings_json -> 'maxSelections') is distinct from 'number'
     or (question_record.settings_json ->> 'minSelections')::numeric
          <> trunc((question_record.settings_json ->> 'minSelections')::numeric)
     or (question_record.settings_json ->> 'maxSelections')::numeric
          <> trunc((question_record.settings_json ->> 'maxSelections')::numeric)
  then
    raise exception 'multiple_choice selection limits must be integers';
  end if;

  min_selections := (question_record.settings_json ->> 'minSelections')::integer;
  max_selections := (question_record.settings_json ->> 'maxSelections')::integer;
  min_points := coalesce((question_record.settings_json ->> 'minPoints')::numeric, 0);
  select count(*)::integer,
         count(*) filter (where option.is_correct is true)::integer,
         count(*) filter (where option.is_correct is false)::integer
  into option_count, correct_count, incorrect_count
  from public.answer_options option
  where option.question_id = target_question_id;

  if min_points > 0 or min_points >= question_record.points then
    raise exception 'Invalid multiple_choice minimum points';
  end if;
  if min_selections < 0 or max_selections < 1
     or min_selections > max_selections or max_selections > option_count
  then
    raise exception 'Invalid multiple_choice selection limits';
  end if;
  if coalesce((question_record.settings_json ->> 'required')::boolean, true)
     and min_selections < 1
  then
    raise exception 'Required multiple_choice must require a selection';
  end if;
  if not coalesce((question_record.settings_json ->> 'required')::boolean, true)
     and min_selections <> 0
  then
    raise exception 'Optional multiple_choice must allow an empty selection';
  end if;
  if question_record.competency_key is not null and exists (
    select 1 from public.answer_options option
    where option.question_id = target_question_id
      and option.competency_effect_json <> '{}'::jsonb
  ) then
    raise exception 'Question competency cannot be mixed with option competency effects';
  end if;

  if scoring_mode in ('exact_match', 'partial_credit') then
    if correct_count < 1 or incorrect_count < 1 then
      raise exception 'multiple_choice requires correct and incorrect options';
    end if;
    if exists (
      select 1 from public.answer_options option
      where option.question_id = target_question_id
        and (option.is_correct is null or option.points <> 0)
    ) then
      raise exception 'exact/partial multiple_choice options require boolean correctness and zero weight';
    end if;
    if correct_count < min_selections or correct_count > max_selections then
      raise exception 'The correct multiple_choice set is unreachable';
    end if;
  end if;

  if scoring_mode = 'partial_credit' then
    correct_option_points := (question_record.settings_json ->> 'correctOptionPoints')::numeric;
    incorrect_option_penalty :=
      (question_record.settings_json ->> 'incorrectOptionPenalty')::numeric;
    if correct_option_points is null or correct_option_points <= 0
       or incorrect_option_penalty is null or incorrect_option_penalty < 0
    then
      raise exception 'Invalid partial_credit configuration';
    end if;
    if penalty_mode = 'none' and incorrect_option_penalty <> 0 then
      raise exception 'partial_credit without penalty must store zero penalty';
    end if;
    if correct_count * correct_option_points < question_record.points then
      raise exception 'The full correct set cannot reach max points';
    end if;
  end if;

  if scoring_mode = 'option_points' then
    if exists (
      select 1 from public.answer_options option
      where option.question_id = target_question_id
        and (
          option.is_correct is not null
          or option.points < -10000
          or option.points > 10000
        )
    ) then
      raise exception 'Invalid option_points option';
    end if;
    correctness_threshold :=
      (question_record.settings_json ->> 'correctnessThreshold')::numeric;
    if correctness_threshold is null
       or correctness_threshold <= min_points
       or correctness_threshold > question_record.points
    then
      raise exception 'Invalid option_points correctness threshold';
    end if;

    select max(reachable.total)
    into feasible_max
    from generate_series(min_selections, max_selections) selection_count
    cross join lateral (
      select coalesce(sum(ranked.points), 0) as total
      from (
        select option.points
        from public.answer_options option
        where option.question_id = target_question_id
        order by option.points desc, option.id
        limit selection_count
      ) ranked
    ) reachable;

    if least(greatest(coalesce(feasible_max, 0), min_points), question_record.points)
       < correctness_threshold
    then
      raise exception 'The option_points correctness threshold is unreachable';
    end if;
  end if;
end;
$$;

revoke all on function public.validate_multiple_choice_question_definition(uuid)
  from public, anon, authenticated;

create or replace function public.validate_multiple_choice_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  question_record record;
begin
  if new.status = 'published' and old.status is distinct from 'published' then
    if exists (
      select 1
      from public.test_sections section
      join public.questions question on question.section_id = section.id
      where section.test_version_id = new.id
        and question.question_type = 'multiple_choice'
        and question.settings_json ->> 'multipleChoiceScoringVersion' is distinct from '1'
    ) then
      raise exception 'All new multiple_choice questions must configure scoring version 1';
    end if;

    for question_record in
      select question.id
      from public.test_sections section
      join public.questions question on question.section_id = section.id
      where section.test_version_id = new.id
        and question.question_type = 'multiple_choice'
        and question.settings_json ->> 'multipleChoiceScoringVersion' = '1'
    loop
      perform public.validate_multiple_choice_question_definition(question_record.id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_multiple_choice_publication on public.test_versions;
create trigger validate_multiple_choice_publication
before update of status on public.test_versions
for each row execute function public.validate_multiple_choice_publication();

revoke all on function public.validate_multiple_choice_publication()
  from public, anon, authenticated;

-- Keep the latest importer intact and add
-- multiple_choice materialization as an atomic post-step in the same transaction.
alter function public.insert_talvia_test_content_v1(uuid, jsonb)
  rename to insert_talvia_test_content_v1_pre_multiple_choice;

revoke all on function public.insert_talvia_test_content_v1_pre_multiple_choice(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.insert_talvia_test_content_v1_pre_multiple_choice(uuid, jsonb)
  to service_role;

create or replace function public.insert_talvia_test_content_v1(
  target_version_id uuid,
  test_data jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  section_entry record;
  question_entry record;
  option_entry record;
  question_data jsonb;
  scoring_data jsonb;
  created_section_id uuid;
  created_question_id uuid;
  remediation_target_id uuid;
  scoring_mode text;
  option_count integer;
begin
  select coalesce(sum(jsonb_array_length(
    case question_item.value ->> 'type'
      when 'ordering' then question_item.value -> 'items'
      when 'matching' then question_item.value -> 'pairs'
      when 'single_choice' then question_item.value -> 'options'
      when 'multiple_choice' then question_item.value -> 'options'
      when 'forced_choice' then question_item.value -> 'options'
      else '[]'::jsonb
    end
  )), 0)::integer
  into option_count
  from jsonb_array_elements(test_data -> 'sections') section_item(value)
  cross join lateral jsonb_array_elements(section_item.value -> 'questions')
    question_item(value);
  if option_count > 3000 then
    raise exception 'Invalid Talvia test import document: option count';
  end if;

  perform public.insert_talvia_test_content_v1_pre_multiple_choice(
    target_version_id,
    test_data
  );

  for section_entry in
    select item.value, item.ordinality
    from jsonb_array_elements(test_data -> 'sections') with ordinality
      as item(value, ordinality)
  loop
    select section.id
    into strict created_section_id
    from public.test_sections section
    where section.test_version_id = target_version_id
      and section.order_index = section_entry.ordinality::integer;

    for question_entry in
      select item.value, item.ordinality
      from jsonb_array_elements(section_entry.value -> 'questions') with ordinality
        as item(value, ordinality)
    loop
      question_data := question_entry.value;
      if question_data ->> 'type' is distinct from 'multiple_choice' then
        continue;
      end if;
      if jsonb_typeof(question_data -> 'selection') is distinct from 'object'
         or jsonb_typeof(question_data -> 'scoring') is distinct from 'object'
         or jsonb_typeof(question_data -> 'options') is distinct from 'array'
         or jsonb_array_length(question_data -> 'options') < 2
      then
        raise exception 'Invalid Talvia multiple_choice import structure';
      end if;

      scoring_data := question_data -> 'scoring';
      scoring_mode := scoring_data ->> 'mode';
      if scoring_mode not in ('exact_match', 'partial_credit', 'option_points') then
        raise exception 'Invalid Talvia multiple_choice scoring mode';
      end if;

      select question.id
      into strict created_question_id
      from public.questions question
      where question.section_id = created_section_id
        and question.order_index = question_entry.ordinality::integer;

      update public.questions
      set points = (scoring_data ->> 'max_points')::numeric(8, 2),
          settings_json = jsonb_strip_nulls(jsonb_build_object(
            'required', (question_data ->> 'required')::boolean,
            'multipleChoiceScoringVersion', 1,
            'scoringMode', scoring_mode,
            'minSelections', (question_data -> 'selection' ->> 'min')::integer,
            'maxSelections', (question_data -> 'selection' ->> 'max')::integer,
            'minPoints', (scoring_data ->> 'min_points')::numeric(8, 2),
            'correctOptionPoints', case when scoring_mode = 'partial_credit'
              then (scoring_data ->> 'correct_option_points')::numeric(8, 2)
              else 0
            end,
            'penaltyMode', case when scoring_mode = 'partial_credit'
              then scoring_data ->> 'penalty_mode'
              else 'none'
            end,
            'incorrectOptionPenalty', case when scoring_mode = 'partial_credit'
              then (scoring_data ->> 'incorrect_option_penalty')::numeric(8, 2)
              else 0
            end,
            'correctnessThreshold', case when scoring_mode = 'option_points'
              then (scoring_data ->> 'correctness_threshold')::numeric(8, 2)
              else null
            end,
            'correctFeedback', nullif(btrim(question_data ->> 'correct_feedback'), ''),
            'incorrectFeedback', nullif(btrim(question_data ->> 'incorrect_feedback'), '')
          ))
      where id = created_question_id;

      for option_entry in
        select item.value, item.ordinality
        from jsonb_array_elements(question_data -> 'options') with ordinality
          as item(value, ordinality)
      loop
        if jsonb_typeof(option_entry.value) is distinct from 'object' then
          raise exception 'Invalid Talvia multiple_choice option';
        end if;
        insert into public.answer_options (
          question_id, text, match_text, order_index, is_correct, points,
          competency_effect_json, explanation
        ) values (
          created_question_id,
          btrim(option_entry.value ->> 'text'),
          null,
          option_entry.ordinality::integer,
          case when scoring_mode = 'option_points'
            then null
            else (option_entry.value ->> 'is_correct')::boolean
          end,
          case when scoring_mode = 'option_points'
            then (option_entry.value ->> 'points')::numeric(8, 2)
            else 0
          end,
          coalesce(option_entry.value -> 'competency_effects', '{}'::jsonb),
          nullif(btrim(option_entry.value ->> 'explanation'), '')
        );
      end loop;

      if nullif(question_data ->> 'remediation_question_key', '') is not null then
        select target_question.id
        into remediation_target_id
        from jsonb_array_elements(section_entry.value -> 'questions') with ordinality
          target_data(value, ordinality)
        join public.questions target_question
          on target_question.section_id = created_section_id
         and target_question.order_index = target_data.ordinality::integer
        where target_data.value ->> 'key' = question_data ->> 'remediation_question_key';
        if remediation_target_id is null then
          raise exception 'Invalid Talvia multiple_choice remediation target';
        end if;
        update public.questions
        set settings_json = settings_json || jsonb_build_object(
          'remediationQuestionId', remediation_target_id
        )
        where id = created_question_id;
      end if;

      perform public.validate_multiple_choice_question_definition(created_question_id);
    end loop;
  end loop;
end;
$$;

revoke all on function public.insert_talvia_test_content_v1(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.insert_talvia_test_content_v1(uuid, jsonb)
  to service_role;

create or replace function public.validate_multiple_choice_answer_payload(
  target_question_id uuid,
  target_answer_json jsonb,
  target_selected_option_id uuid,
  target_answer_text text,
  target_is_correct boolean,
  target_raw_score numeric,
  target_points_awarded numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  question_record record;
  selected_ids uuid[];
  selection_count integer;
  distinct_selection_count integer;
begin
  select question.question_type, question.settings_json
  into question_record
  from public.questions question
  where question.id = target_question_id;

  if question_record.question_type is distinct from 'multiple_choice' then
    return;
  end if;
  if target_selected_option_id is not null
     or target_answer_text is not null
     or target_is_correct is not null
     or target_raw_score is not null
     or target_points_awarded is not null
  then
    raise exception 'multiple_choice answer writes must use answer_json only';
  end if;
  if jsonb_typeof(target_answer_json) is distinct from 'object' then
    raise exception 'multiple_choice answer_json must be an object';
  end if;
  if exists (
    select 1 from jsonb_object_keys(target_answer_json) key
    where key not in ('selectedOptionIds', 'skipped')
  ) then
    raise exception 'multiple_choice answer_json contains server-controlled fields';
  end if;

  if target_answer_json ? 'skipped' then
    if target_answer_json -> 'skipped' <> 'true'::jsonb
       or target_answer_json ? 'selectedOptionIds'
    then
      raise exception 'multiple_choice skipped payload cannot contain selections';
    end if;
    if coalesce((question_record.settings_json ->> 'required')::boolean, true) then
      raise exception 'A required multiple_choice answer cannot be skipped';
    end if;
    return;
  end if;

  if jsonb_typeof(target_answer_json -> 'selectedOptionIds') is distinct from 'array' then
    raise exception 'multiple_choice selectedOptionIds must be an array';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(target_answer_json -> 'selectedOptionIds') item(value)
    where jsonb_typeof(item.value) is distinct from 'string'
      or item.value #>> '{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    raise exception 'multiple_choice selections must contain UUID strings';
  end if;

  select array_agg(item.value::uuid), count(*)::integer,
         count(distinct item.value)::integer
  into selected_ids, selection_count, distinct_selection_count
  from jsonb_array_elements_text(target_answer_json -> 'selectedOptionIds') item(value);
  selection_count := coalesce(selection_count, 0);
  distinct_selection_count := coalesce(distinct_selection_count, 0);
  if selection_count <> distinct_selection_count then
    raise exception 'multiple_choice selections cannot contain duplicates';
  end if;
  if exists (
    select 1
    from unnest(coalesce(selected_ids, array[]::uuid[])) selected_id
    where not exists (
      select 1 from public.answer_options option
      where option.id = selected_id and option.question_id = target_question_id
    )
  ) then
    raise exception 'multiple_choice option must belong to the question';
  end if;

  if question_record.settings_json ->> 'multipleChoiceScoringVersion' = '1' then
    if selection_count < (question_record.settings_json ->> 'minSelections')::integer
       or selection_count > (question_record.settings_json ->> 'maxSelections')::integer
    then
      raise exception 'multiple_choice selection count is outside configured limits';
    end if;
  end if;
end;
$$;

revoke all on function public.validate_multiple_choice_answer_payload(
  uuid, jsonb, uuid, text, boolean, numeric, numeric
) from public, anon, authenticated;

create or replace function public.validate_candidate_answer_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.test_sessions session
    join public.test_sections section on section.test_version_id = session.test_version_id
    join public.questions question on question.section_id = section.id
    where session.id = new.session_id
      and session.status = 'in_progress'
      and (session.deadline_at is null or session.deadline_at > now())
      and question.id = new.question_id
  ) then
    raise exception 'Answers can be saved only for an active session question before its deadline';
  end if;
  if new.selected_option_id is not null and not exists (
    select 1 from public.answer_options option
    where option.id = new.selected_option_id and option.question_id = new.question_id
  ) then
    raise exception 'Selected option must belong to the question';
  end if;
  perform public.validate_forced_choice_answer_payload(
    new.question_id, new.answer_json, new.selected_option_id, new.answer_text,
    new.is_correct, new.points_awarded
  );
  perform public.validate_multiple_choice_answer_payload(
    new.question_id, new.answer_json, new.selected_option_id, new.answer_text,
    new.is_correct, new.raw_score, new.points_awarded
  );
  return new;
end;
$$;

create or replace function public.validate_employee_assessment_answer_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.employee_assessment_sessions session
    join public.test_sections section on section.test_version_id = session.test_version_id
    join public.questions question on question.section_id = section.id
    where session.id = new.session_id
      and session.status = 'in_progress'
      and question.id = new.question_id
  ) then
    raise exception 'Employee answers can be saved only for an active session question';
  end if;
  if new.selected_option_id is not null and not exists (
    select 1 from public.answer_options option
    where option.id = new.selected_option_id and option.question_id = new.question_id
  ) then
    raise exception 'Selected option must belong to the question';
  end if;
  perform public.validate_forced_choice_answer_payload(
    new.question_id, new.answer_json, new.selected_option_id, new.answer_text,
    new.is_correct, new.points_awarded
  );
  perform public.validate_multiple_choice_answer_payload(
    new.question_id, new.answer_json, new.selected_option_id, new.answer_text,
    new.is_correct, new.raw_score, new.points_awarded
  );
  return new;
end;
$$;

drop trigger if exists validate_candidate_answer_assignment on public.candidate_answers;
create trigger validate_candidate_answer_assignment
before insert or update of session_id, question_id, selected_option_id, answer_text, answer_json
on public.candidate_answers
for each row execute function public.validate_candidate_answer_assignment();

drop trigger if exists validate_employee_assessment_answer_assignment
on public.employee_assessment_answers;
create trigger validate_employee_assessment_answer_assignment
before insert or update of session_id, question_id, selected_option_id, answer_text, answer_json
on public.employee_assessment_answers
for each row execute function public.validate_employee_assessment_answer_assignment();

revoke all on function public.validate_candidate_answer_assignment()
  from public, anon, authenticated;
revoke all on function public.validate_employee_assessment_answer_assignment()
  from public, anon, authenticated;
