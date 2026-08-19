-- Atomic service-role import of one validated talvia.test.v1 document as a
-- platform-owned system test. Publication and company access remain separate.

create or replace function public.import_system_test_v1(
  target_created_by uuid,
  import_document jsonb
)
returns table (
  created_template_id uuid,
  created_version_id uuid
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  test_data jsonb;
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
  importer_role text;
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
  if jsonb_typeof(test_data -> 'sections') <> 'array' then
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

  insert into public.test_templates (
    company_id,
    title,
    description,
    category,
    is_system,
    created_by,
    status
  )
  values (
    null,
    btrim(test_data ->> 'title'),
    nullif(btrim(test_data ->> 'description'), ''),
    btrim(test_data ->> 'category'),
    true,
    target_created_by,
    'active'
  )
  returning id into created_template_id;

  insert into public.test_versions (
    test_template_id,
    version_number,
    title,
    description,
    instructions,
    duration_minutes,
    scoring_type,
    status,
    settings_json,
    published_at
  )
  values (
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
  )
  returning id into created_version_id;

  for section_entry in
    select item.value, item.ordinality
    from jsonb_array_elements(test_data -> 'sections') with ordinality as item(value, ordinality)
  loop
    insert into public.test_sections (
      test_version_id,
      title,
      description,
      order_index,
      time_limit_minutes,
      settings_json
    )
    values (
      created_version_id,
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
        section_id,
        question_type,
        text,
        description,
        media_url,
        order_index,
        points,
        competency_key,
        difficulty,
        settings_json
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
          else jsonb_build_object('required', (question_data ->> 'required')::boolean)
        end
      )
      returning id into created_question_id;

      if question_data ->> 'type' = 'single_choice' then
        for option_entry in
          select item.value, item.ordinality
          from jsonb_array_elements(question_data -> 'options') with ordinality
            as item(value, ordinality)
        loop
          insert into public.answer_options (
            question_id,
            text,
            order_index,
            is_correct,
            points,
            competency_effect_json,
            explanation
          )
          values (
            created_question_id,
            btrim(option_entry.value ->> 'text'),
            option_entry.ordinality::integer,
            (option_entry.value ->> 'is_correct')::boolean,
            (option_entry.value ->> 'points')::numeric(8, 2),
            coalesce(option_entry.value -> 'competency_effects', '{}'::jsonb),
            nullif(btrim(option_entry.value ->> 'explanation'), '')
          );
        end loop;
      end if;
    end loop;
  end loop;

  insert into public.platform_audit_logs (
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    company_id,
    reason,
    metadata_json
  )
  values
    (
      target_created_by,
      importer_role,
      'import_system_test',
      'test_template',
      created_template_id,
      null,
      null,
      jsonb_build_object(
        'schemaVersion', 'talvia.test.v1',
        'versionId', created_version_id
      )
    ),
    (
      target_created_by,
      importer_role,
      'import_system_test_version',
      'test_version',
      created_version_id,
      null,
      null,
      jsonb_build_object('testTemplateId', created_template_id)
    );

  return next;
end;
$$;

revoke all on function public.import_system_test_v1(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_system_test_v1(uuid, jsonb)
  to service_role;
