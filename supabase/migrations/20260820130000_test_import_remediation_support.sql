-- Allow talvia.test.v1 imports to link a single-choice question to a
-- remediation question by local key. The local key is resolved to the
-- generated question UUID inside the same atomic import operation.

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
  source_question_id uuid;
  target_question_id uuid;
  question_data jsonb;
  question_ids_by_key jsonb := '{}'::jsonb;
  remediation_key text;
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
    where nullif(btrim(question_item.value ->> 'key'), '') is null
  ) or exists (
    select btrim(question_item.value ->> 'key')
    from jsonb_array_elements(test_data -> 'sections') as section_item(value)
    cross join lateral jsonb_array_elements(section_item.value -> 'questions') as question_item(value)
    group by btrim(question_item.value ->> 'key')
    having count(*) > 1
  ) then
    raise exception 'Invalid Talvia test import document: question keys';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(test_data -> 'sections') with ordinality
      as section_item(value, ordinality)
    cross join lateral jsonb_array_elements(section_item.value -> 'questions') with ordinality
      as source_question(value, ordinality)
    where (
      nullif(btrim(source_question.value ->> 'remediation_question_key'), '') is null
      and nullif(btrim(source_question.value ->> 'incorrect_feedback'), '') is not null
    ) or (
      nullif(btrim(source_question.value ->> 'remediation_question_key'), '') is not null
      and (
        source_question.value ->> 'type' <> 'single_choice'
        or nullif(btrim(source_question.value ->> 'incorrect_feedback'), '') is null
        or not exists (
          select 1
          from jsonb_array_elements(section_item.value -> 'questions') with ordinality
            as target_question(value, ordinality)
          where btrim(target_question.value ->> 'key') =
              btrim(source_question.value ->> 'remediation_question_key')
            and target_question.ordinality > source_question.ordinality
        )
      )
    )
  ) then
    raise exception 'Invalid Talvia test import document: remediation link';
  end if;

  if exists (
    select btrim(question_item.value ->> 'remediation_question_key')
    from jsonb_array_elements(test_data -> 'sections') as section_item(value)
    cross join lateral jsonb_array_elements(section_item.value -> 'questions') as question_item(value)
    where nullif(btrim(question_item.value ->> 'remediation_question_key'), '') is not null
    group by btrim(question_item.value ->> 'remediation_question_key')
    having count(*) > 1
  ) then
    raise exception 'Invalid Talvia test import document: remediation target reused';
  end if;

  if exists (
    with remediation_links as (
      select
        btrim(question_item.value ->> 'key') as source_key,
        nullif(btrim(question_item.value ->> 'remediation_question_key'), '') as target_key
      from jsonb_array_elements(test_data -> 'sections') as section_item(value)
      cross join lateral jsonb_array_elements(section_item.value -> 'questions') as question_item(value)
    )
    select 1
    from remediation_links link
    where link.target_key is not null
      and exists (
        select 1
        from remediation_links target
        where target.source_key = link.target_key
          and target.target_key is not null
      )
  ) then
    raise exception 'Invalid Talvia test import document: remediation chain';
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

      question_ids_by_key := question_ids_by_key || jsonb_build_object(
        question_data ->> 'key',
        created_question_id::text
      );

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

  for section_entry in
    select item.value
    from jsonb_array_elements(test_data -> 'sections') as item(value)
  loop
    for question_entry in
      select item.value
      from jsonb_array_elements(section_entry.value -> 'questions') as item(value)
    loop
      remediation_key := nullif(
        btrim(question_entry.value ->> 'remediation_question_key'),
        ''
      );
      if remediation_key is not null then
        source_question_id := (question_ids_by_key ->> (question_entry.value ->> 'key'))::uuid;
        target_question_id := (question_ids_by_key ->> remediation_key)::uuid;
        if source_question_id is null or target_question_id is null then
          raise exception 'Invalid Talvia test import document: unresolved remediation link';
        end if;

        update public.questions
        set settings_json = settings_json || jsonb_build_object(
          'incorrectFeedback', nullif(btrim(question_entry.value ->> 'incorrect_feedback'), ''),
          'remediationQuestionId', target_question_id
        )
        where id = source_question_id;
      end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public.insert_talvia_test_content_v1(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.insert_talvia_test_content_v1(uuid, jsonb)
  to service_role;
