-- Forced Choice (MOST / LEAST): question type, competency keys, atomic imports
-- and database-level answer integrity for candidate and employee flows.

alter table public.questions
  drop constraint if exists questions_question_type_check;
alter table public.questions
  add constraint questions_question_type_check
  check (question_type in (
    'single_choice', 'multiple_choice', 'scale', 'open_text', 'ordering', 'matching',
    'forced_choice'
  ));

alter table public.questions
  drop constraint if exists questions_competency_key_supported;
alter table public.questions
  add constraint questions_competency_key_supported
  check (
    competency_key is null
    or competency_key in (
      'learning_ability', 'attention_to_detail', 'logical_reasoning', 'work_behavior',
      'communication', 'responsibility', 'work_organization', 'work_initiative',
      'work_result_orientation', 'work_collaboration', 'work_adaptability',
      'motivation_income', 'motivation_growth', 'motivation_stability',
      'motivation_autonomy', 'motivation_structure', 'motivation_recognition'
    )
  );

create or replace function public.has_supported_competency_effects(effects jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(effects) = 'object'
    and not exists (
      select 1
      from jsonb_object_keys(effects) as keys(effect_key)
      where keys.effect_key not in (
        'learning_ability', 'attention_to_detail', 'logical_reasoning', 'work_behavior',
        'communication', 'responsibility', 'work_organization', 'work_initiative',
        'work_result_orientation', 'work_collaboration', 'work_adaptability',
        'motivation_income', 'motivation_growth', 'motivation_stability',
        'motivation_autonomy', 'motivation_structure', 'motivation_recognition'
      )
    )
    and not exists (
      select 1
      from jsonb_each(effects) as effect
      where jsonb_typeof(effect.value) <> 'number'
    );
$$;

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
  created_section_id uuid;
  created_question_id uuid;
  question_data jsonb;
  question_points numeric(8, 2);
  section_count integer;
  question_count integer;
  option_count integer;
begin
  if jsonb_typeof(test_data) <> 'object'
     or jsonb_typeof(test_data -> 'sections') <> 'array'
  then
    raise exception 'Invalid Talvia test import document: sections must be an array';
  end if;

  section_count := jsonb_array_length(test_data -> 'sections');
  if section_count < 1 or section_count > 100 then
    raise exception 'Invalid Talvia test import document: section count';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(test_data -> 'sections') as section_item(value)
    where jsonb_typeof(section_item.value) <> 'object'
      or jsonb_typeof(section_item.value -> 'questions') <> 'array'
      or jsonb_array_length(section_item.value -> 'questions') < 1
  ) then
    raise exception 'Invalid Talvia test import document: section questions';
  end if;

  select count(*)::integer
  into question_count
  from jsonb_array_elements(test_data -> 'sections') as section_item(value)
  cross join lateral jsonb_array_elements(section_item.value -> 'questions') as question_item(value);
  if question_count < 1 or question_count > 300 then
    raise exception 'Invalid Talvia test import document: question count';
  end if;

  select count(*)::integer
  into option_count
  from jsonb_array_elements(test_data -> 'sections') as section_item(value)
  cross join lateral jsonb_array_elements(section_item.value -> 'questions') as question_item(value)
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(question_item.value -> 'options') = 'array'
        then question_item.value -> 'options'
      else '[]'::jsonb
    end
  ) as option_item(value);
  if option_count > 3000 then
    raise exception 'Invalid Talvia test import document: option count';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(test_data -> 'sections') as section_item(value)
    cross join lateral jsonb_array_elements(section_item.value -> 'questions') as question_item(value)
    where question_item.value ->> 'type' = 'forced_choice'
      and (
        jsonb_typeof(question_item.value -> 'forced_choice') is distinct from 'object'
        or question_item.value -> 'forced_choice' ->> 'mode' is distinct from 'most_least'
        or case
          when jsonb_typeof(question_item.value -> 'options') = 'array'
            then jsonb_array_length(question_item.value -> 'options') < 3
          else true
        end
        or exists (
          select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(question_item.value -> 'options') = 'array'
                then question_item.value -> 'options'
              else '[]'::jsonb
            end
          ) as forced_option(value)
          where jsonb_typeof(forced_option.value -> 'competency_effects') is distinct from 'object'
            or forced_option.value -> 'competency_effects' = '{}'::jsonb
            or exists (
              select 1
              from jsonb_each(
                case
                  when jsonb_typeof(forced_option.value -> 'competency_effects') = 'object'
                    then forced_option.value -> 'competency_effects'
                  else '{}'::jsonb
                end
              ) as effect
              where case
                when jsonb_typeof(effect.value) = 'number'
                  then (effect.value #>> '{}')::numeric <= 0
                else true
              end
            )
        )
      )
  ) then
    raise exception 'Invalid Talvia test import document: forced_choice';
  end if;

  for section_entry in
    select item.value, item.ordinality
    from jsonb_array_elements(test_data -> 'sections') with ordinality as item(value, ordinality)
  loop
    insert into public.test_sections (
      test_version_id, title, description, order_index, time_limit_minutes, settings_json
    )
    values (
      target_version_id,
      btrim(section_entry.value ->> 'title'),
      nullif(btrim(section_entry.value ->> 'description'), ''),
      section_entry.ordinality::integer,
      null,
      '{}'::jsonb
    )
    returning id into created_section_id;

    for question_entry in
      select item.value, item.ordinality
      from jsonb_array_elements(section_entry.value -> 'questions') with ordinality
        as item(value, ordinality)
    loop
      question_data := question_entry.value;
      if question_data ->> 'type' = 'single_choice' then
        select max((item.value ->> 'points')::numeric(8, 2))
        into question_points
        from jsonb_array_elements(question_data -> 'options') as item(value);
      elsif question_data ->> 'type' = 'scale' then
        question_points := (question_data -> 'scale' ->> 'max')::numeric(8, 2);
      else
        question_points := 0;
      end if;

      insert into public.questions (
        section_id, question_type, text, description, media_url, order_index,
        points, competency_key, difficulty, settings_json
      )
      values (
        created_section_id,
        question_data ->> 'type',
        btrim(question_data ->> 'text'),
        nullif(btrim(question_data ->> 'description'), ''),
        null,
        question_entry.ordinality::integer,
        question_points,
        nullif(question_data ->> 'competency_key', ''),
        nullif(question_data ->> 'difficulty', ''),
        case
          when question_data ->> 'type' = 'scale' then
            jsonb_build_object(
              'required', (question_data ->> 'required')::boolean,
              'min', (question_data -> 'scale' ->> 'min')::integer,
              'max', (question_data -> 'scale' ->> 'max')::integer
            )
          when question_data ->> 'type' = 'forced_choice' then
            jsonb_build_object(
              'required', (question_data ->> 'required')::boolean,
              'mode', question_data -> 'forced_choice' ->> 'mode'
            )
          else jsonb_build_object('required', (question_data ->> 'required')::boolean)
        end
      )
      returning id into created_question_id;

      if question_data ->> 'type' in ('single_choice', 'forced_choice') then
        for option_entry in
          select item.value, item.ordinality
          from jsonb_array_elements(question_data -> 'options') with ordinality
            as item(value, ordinality)
        loop
          insert into public.answer_options (
            question_id, text, order_index, is_correct, points,
            competency_effect_json, explanation
          )
          values (
            created_question_id,
            btrim(option_entry.value ->> 'text'),
            option_entry.ordinality::integer,
            case
              when question_data ->> 'type' = 'forced_choice' then null
              else (option_entry.value ->> 'is_correct')::boolean
            end,
            case
              when question_data ->> 'type' = 'forced_choice' then 0
              else (option_entry.value ->> 'points')::numeric(8, 2)
            end,
            coalesce(option_entry.value -> 'competency_effects', '{}'::jsonb),
            nullif(btrim(option_entry.value ->> 'explanation'), '')
          );
        end loop;
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public.insert_talvia_test_content_v1(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.insert_talvia_test_content_v1(uuid, jsonb)
  to service_role;

create or replace function public.import_company_test_v1(
  target_company_id uuid,
  target_created_by uuid,
  import_document jsonb
)
returns table (created_template_id uuid, created_version_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  test_data jsonb;
begin
  if not exists (
    select 1
    from public.company_users membership
    join public.companies company on company.id = membership.company_id
    where membership.company_id = target_company_id
      and membership.user_id = target_created_by
      and membership.status = 'active'
      and membership.role in ('owner', 'admin', 'recruiter', 'super_admin')
      and company.status = 'active'
  ) then
    raise exception 'Importer cannot manage this company';
  end if;
  if not exists (
    select 1 from public.company_test_permissions permissions
    where permissions.company_id = target_company_id
      and permissions.can_create_custom_tests = true
  ) then
    raise exception 'Company cannot create custom tests';
  end if;
  if import_document is null
     or jsonb_typeof(import_document) <> 'object'
     or import_document ->> 'schema_version' <> 'talvia.test.v1'
     or jsonb_typeof(import_document -> 'test') <> 'object'
  then
    raise exception 'Invalid Talvia test import document';
  end if;

  test_data := import_document -> 'test';
  insert into public.test_templates (
    company_id, title, description, category, is_system, created_by, status
  ) values (
    target_company_id,
    btrim(test_data ->> 'title'),
    nullif(btrim(test_data ->> 'description'), ''),
    btrim(test_data ->> 'category'),
    false,
    target_created_by,
    'active'
  ) returning id into created_template_id;

  insert into public.test_versions (
    test_template_id, version_number, title, description, instructions,
    duration_minutes, scoring_type, status, settings_json, published_at
  ) values (
    created_template_id,
    1,
    'v.1 от ' || to_char(current_date, 'DD-MM-YYYY'),
    nullif(btrim(test_data ->> 'description'), ''),
    nullif(btrim(test_data ->> 'instructions'), ''),
    (test_data ->> 'duration_minutes')::integer,
    test_data ->> 'scoring_type',
    'draft',
    jsonb_build_object(
      'presentationMode', test_data -> 'presentation' ->> 'mode',
      'allowBack', (test_data -> 'presentation' ->> 'allow_back')::boolean,
      'captureQuestionTime', (test_data -> 'presentation' ->> 'capture_question_time')::boolean
    ),
    null
  ) returning id into created_version_id;

  perform public.insert_talvia_test_content_v1(created_version_id, test_data);
  return next;
end;
$$;

revoke all on function public.import_company_test_v1(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_company_test_v1(uuid, uuid, jsonb)
  to service_role;

create or replace function public.import_system_test_v1(
  target_template_id uuid,
  target_created_by uuid,
  import_document jsonb
)
returns table (created_template_id uuid, created_version_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  test_data jsonb;
  importer_role text;
  target_category text;
  next_version_number integer;
begin
  select platform_user.role
  into importer_role
  from public.platform_users platform_user
  where platform_user.user_id = target_created_by
    and platform_user.status = 'active'
    and platform_user.role in ('platform_owner', 'platform_admin');
  if importer_role is null then
    raise exception 'Importer cannot manage system tests';
  end if;
  if import_document is null
     or jsonb_typeof(import_document) <> 'object'
     or import_document ->> 'schema_version' <> 'talvia.test.v1'
     or jsonb_typeof(import_document -> 'test') <> 'object'
  then
    raise exception 'Invalid Talvia test import document';
  end if;

  test_data := import_document -> 'test';
  select template.id, template.category
  into created_template_id, target_category
  from public.test_templates template
  where template.id = target_template_id
    and template.is_system = true
    and template.company_id is null
    and template.status = 'active'
  for update;
  if created_template_id is null then
    raise exception 'System test target is unavailable';
  end if;
  if target_category is distinct from (test_data ->> 'category') then
    raise exception 'Import category does not match system test';
  end if;
  if exists (
    select 1 from public.test_versions version
    where version.test_template_id = created_template_id and version.status = 'draft'
  ) then
    raise exception 'System test already has a draft';
  end if;

  select coalesce(max(version.version_number), 0) + 1
  into next_version_number
  from public.test_versions version
  where version.test_template_id = created_template_id;

  insert into public.test_versions (
    test_template_id, version_number, title, description, instructions,
    duration_minutes, scoring_type, status, settings_json, published_at
  ) values (
    created_template_id,
    next_version_number,
    'v.' || next_version_number || ' от ' || to_char(current_date, 'DD-MM-YYYY'),
    nullif(btrim(test_data ->> 'description'), ''),
    nullif(btrim(test_data ->> 'instructions'), ''),
    (test_data ->> 'duration_minutes')::integer,
    test_data ->> 'scoring_type',
    'draft',
    jsonb_build_object(
      'presentationMode', test_data -> 'presentation' ->> 'mode',
      'allowBack', (test_data -> 'presentation' ->> 'allow_back')::boolean,
      'captureQuestionTime', (test_data -> 'presentation' ->> 'capture_question_time')::boolean
    ),
    null
  ) returning id into created_version_id;

  perform public.insert_talvia_test_content_v1(created_version_id, test_data);

  insert into public.platform_audit_logs (
    actor_user_id, actor_role, action, target_type, target_id,
    company_id, reason, metadata_json
  ) values (
    target_created_by,
    importer_role,
    'import_system_test_version',
    'test_version',
    created_version_id,
    null,
    null,
    jsonb_build_object(
      'schemaVersion', 'talvia.test.v1',
      'testTemplateId', created_template_id,
      'versionNumber', next_version_number
    )
  );
  return next;
end;
$$;

revoke all on function public.import_system_test_v1(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_system_test_v1(uuid, uuid, jsonb)
  to service_role;

create or replace function public.validate_forced_choice_answer_payload(
  target_question_id uuid,
  target_answer_json jsonb,
  target_selected_option_id uuid,
  target_answer_text text,
  target_is_correct boolean,
  target_points_awarded numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  question_record record;
  most_option_id text;
  least_option_id text;
begin
  select question.question_type, question.settings_json
  into question_record
  from public.questions question
  where question.id = target_question_id;

  if question_record.question_type is distinct from 'forced_choice' then
    return;
  end if;
  if question_record.settings_json ->> 'mode' is distinct from 'most_least' then
    raise exception 'Unsupported forced_choice mode';
  end if;
  if target_selected_option_id is not null
     or target_answer_text is not null
     or target_is_correct is not null
     or target_points_awarded is not null
  then
    raise exception 'Forced Choice must use answer_json only';
  end if;

  if target_answer_json ->> 'skipped' = 'true' then
    if coalesce((question_record.settings_json ->> 'required')::boolean, true) then
      raise exception 'A required Forced Choice answer cannot be skipped';
    end if;
    return;
  end if;

  most_option_id := target_answer_json ->> 'mostOptionId';
  least_option_id := target_answer_json ->> 'leastOptionId';
  if most_option_id is null or least_option_id is null then
    raise exception 'Forced Choice requires MOST and LEAST options';
  end if;
  if most_option_id = least_option_id then
    raise exception 'Forced Choice MOST and LEAST options must differ';
  end if;
  if not exists (
    select 1 from public.answer_options option
    where option.question_id = target_question_id and option.id::text = most_option_id
  ) or not exists (
    select 1 from public.answer_options option
    where option.question_id = target_question_id and option.id::text = least_option_id
  ) then
    raise exception 'Forced Choice option must belong to the question';
  end if;
end;
$$;

revoke all on function public.validate_forced_choice_answer_payload(uuid, jsonb, uuid, text, boolean, numeric)
  from public, anon, authenticated;

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
  return new;
end;
$$;
