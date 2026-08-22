-- Structured ordering and one-to-one matching questions.
-- Existing published ordering/matching questions remain legacy until their
-- settings_json contains structuredResponseVersion = 1.

alter table public.answer_options
  add column if not exists match_text text,
  add column if not exists match_target_id uuid not null default gen_random_uuid();

alter table public.answer_options
  drop constraint if exists answer_options_match_text_length;

alter table public.answer_options
  add constraint answer_options_match_text_length
  check (
    match_text is null
    or char_length(btrim(match_text)) between 1 and 1000
  );

create unique index if not exists answer_options_match_target_id_key
  on public.answer_options(match_target_id);

-- Extend the trusted talvia.test.v1 import helper. Parent import functions keep
-- ownership and tenant checks; this helper only materializes validated content.
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
  question_type text;
  option_data jsonb;
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

  select coalesce(sum(jsonb_array_length(
    case question_item.value ->> 'type'
      when 'ordering' then question_item.value -> 'items'
      when 'matching' then question_item.value -> 'pairs'
      when 'single_choice' then question_item.value -> 'options'
      when 'forced_choice' then question_item.value -> 'options'
      else '[]'::jsonb
    end
  )), 0)::integer
  into option_count
  from jsonb_array_elements(test_data -> 'sections') as section_item(value)
  cross join lateral jsonb_array_elements(section_item.value -> 'questions') as question_item(value);
  if option_count > 3000 then
    raise exception 'Invalid Talvia test import document: option count';
  end if;

  for section_entry in
    select item.value, item.ordinality
    from jsonb_array_elements(test_data -> 'sections') with ordinality as item(value, ordinality)
  loop
    insert into public.test_sections (
      test_version_id, title, description, order_index, time_limit_minutes, settings_json
    ) values (
      target_version_id,
      btrim(section_entry.value ->> 'title'),
      nullif(btrim(section_entry.value ->> 'description'), ''),
      section_entry.ordinality::integer,
      null,
      '{}'::jsonb
    ) returning id into created_section_id;

    for question_entry in
      select item.value, item.ordinality
      from jsonb_array_elements(section_entry.value -> 'questions') with ordinality
        as item(value, ordinality)
    loop
      question_data := question_entry.value;
      question_type := question_data ->> 'type';

      if question_type = 'single_choice' then
        select max((item.value ->> 'points')::numeric(8, 2))
        into question_points
        from jsonb_array_elements(question_data -> 'options') as item(value);
      elsif question_type = 'scale' then
        question_points := (question_data -> 'scale' ->> 'max')::numeric(8, 2);
      elsif question_type in ('ordering', 'matching') then
        question_points := (question_data ->> 'points')::numeric(8, 2);
        if question_points <= 0 then
          raise exception 'Invalid Talvia test import document: structured question points';
        end if;
      else
        question_points := 0;
      end if;

      if question_type = 'forced_choice'
         and (question_data -> 'forced_choice' ->> 'mode') is distinct from 'most_least'
      then
        raise exception 'Invalid Talvia test import document: forced_choice';
      end if;
      if question_type = 'ordering'
         and (
           jsonb_typeof(question_data -> 'items') is distinct from 'array'
           or jsonb_array_length(question_data -> 'items') < 2
           or question_data -> 'ordering' ->> 'scoring_mode' not in ('pairwise', 'exact')
         )
      then
        raise exception 'Invalid Talvia test import document: ordering';
      end if;
      if question_type = 'matching'
         and (
           jsonb_typeof(question_data -> 'pairs') is distinct from 'array'
           or jsonb_array_length(question_data -> 'pairs') < 2
           or question_data -> 'matching' ->> 'scoring_mode' not in ('per_pair', 'exact')
         )
      then
        raise exception 'Invalid Talvia test import document: matching';
      end if;

      insert into public.questions (
        section_id, question_type, text, description, media_url, order_index,
        points, competency_key, difficulty, settings_json
      ) values (
        created_section_id,
        question_type,
        btrim(question_data ->> 'text'),
        nullif(btrim(question_data ->> 'description'), ''),
        null,
        question_entry.ordinality::integer,
        question_points,
        nullif(question_data ->> 'competency_key', ''),
        nullif(question_data ->> 'difficulty', ''),
        case question_type
          when 'scale' then jsonb_build_object(
            'required', (question_data ->> 'required')::boolean,
            'min', (question_data -> 'scale' ->> 'min')::integer,
            'max', (question_data -> 'scale' ->> 'max')::integer
          )
          when 'forced_choice' then jsonb_build_object(
            'required', (question_data ->> 'required')::boolean,
            'mode', question_data -> 'forced_choice' ->> 'mode'
          )
          when 'ordering' then jsonb_build_object(
            'required', (question_data ->> 'required')::boolean,
            'structuredResponseVersion', 1,
            'orderingScoringMode', question_data -> 'ordering' ->> 'scoring_mode'
          )
          when 'matching' then jsonb_build_object(
            'required', (question_data ->> 'required')::boolean,
            'structuredResponseVersion', 1,
            'matchingScoringMode', question_data -> 'matching' ->> 'scoring_mode'
          )
          else jsonb_build_object('required', (question_data ->> 'required')::boolean)
        end
      ) returning id into created_question_id;

      option_data := case question_type
        when 'ordering' then question_data -> 'items'
        when 'matching' then question_data -> 'pairs'
        when 'single_choice' then question_data -> 'options'
        when 'forced_choice' then question_data -> 'options'
        else null
      end;

      if option_data is not null then
        for option_entry in
          select item.value, item.ordinality
          from jsonb_array_elements(option_data) with ordinality as item(value, ordinality)
        loop
          insert into public.answer_options (
            question_id, text, match_text, order_index, is_correct, points,
            competency_effect_json, explanation
          ) values (
            created_question_id,
            btrim(case when question_type = 'matching'
              then option_entry.value ->> 'left'
              else option_entry.value ->> 'text'
            end),
            case when question_type = 'matching'
              then btrim(option_entry.value ->> 'right')
              else null
            end,
            option_entry.ordinality::integer,
            case
              when question_type in ('forced_choice', 'ordering', 'matching') then null
              else (option_entry.value ->> 'is_correct')::boolean
            end,
            case
              when question_type in ('forced_choice', 'ordering', 'matching') then 0
              else (option_entry.value ->> 'points')::numeric(8, 2)
            end,
            case
              when question_type in ('ordering', 'matching') then '{}'::jsonb
              else coalesce(option_entry.value -> 'competency_effects', '{}'::jsonb)
            end,
            case
              when question_type in ('ordering', 'matching') then null
              else nullif(btrim(option_entry.value ->> 'explanation'), '')
            end
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
