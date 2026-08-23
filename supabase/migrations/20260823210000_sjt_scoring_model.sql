alter table public.questions
  drop constraint if exists questions_scoring_model_check,
  add constraint questions_scoring_model_check
    check (scoring_model is null or scoring_model in ('criterion', 'scale', 'sjt', 'forced_choice'));

comment on column public.questions.scoring_model is
  'Trusted v2 item scorer: criterion, scale, sjt, forced_choice, or null for manual open text.';

-- Preserve the already deployed importer and wrap it so upgrades remain atomic.
-- SJT items are temporarily presented to the previous importer as criterion
-- items, then replaced with trusted SJT configs in the same transaction.
alter function public.apply_talvia_scoring_v2(uuid, jsonb)
  rename to apply_talvia_scoring_v2_pre_sjt;

create function public.apply_talvia_scoring_v2(
  target_version_id uuid,
  import_document jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  transformed_document jsonb;
  transformed_items jsonb;
  section_entry record;
  question_entry record;
  created_section_id uuid;
  created_question_id uuid;
  item_data jsonb;
  item_config jsonb;
begin
  select jsonb_agg(
    case
      when item.value ->> 'scoring_model' = 'sjt' then
        jsonb_build_object(
          'competency_bindings', '[]'::jsonb,
          'max_points', (item.value ->> 'max_points')::numeric,
          'min_points', (item.value ->> 'min_points')::numeric,
          'question_key', item.value ->> 'question_key',
          'scoring_model', 'criterion',
          'strategy', case
            when question.value ->> 'type' = 'multiple_choice' then 'multiple_choice_v1'
            else 'single_choice_points'
          end
        )
      else item.value
    end
    order by item.ordinality
  )
  into transformed_items
  from jsonb_array_elements(import_document -> 'scoring' -> 'items')
    with ordinality as item(value, ordinality)
  left join lateral (
    select candidate.value
    from jsonb_array_elements(import_document -> 'test' -> 'sections') as section(value)
    cross join lateral jsonb_array_elements(section.value -> 'questions') as candidate(value)
    where candidate.value ->> 'key' = item.value ->> 'question_key'
    limit 1
  ) question on true;

  transformed_document := jsonb_set(
    import_document,
    '{scoring,items}',
    coalesce(transformed_items, '[]'::jsonb)
  );
  perform public.apply_talvia_scoring_v2_pre_sjt(
    target_version_id,
    transformed_document
  );

  for section_entry in
    select entry.value, entry.ordinality
    from jsonb_array_elements(import_document -> 'test' -> 'sections')
      with ordinality as entry(value, ordinality)
  loop
    select section.id
    into strict created_section_id
    from public.test_sections section
    where section.test_version_id = target_version_id
      and section.order_index = section_entry.ordinality::integer;

    for question_entry in
      select entry.value, entry.ordinality
      from jsonb_array_elements(section_entry.value -> 'questions')
        with ordinality as entry(value, ordinality)
    loop
      select item.value
      into item_data
      from jsonb_array_elements(import_document -> 'scoring' -> 'items') as item(value)
      where item.value ->> 'question_key' = question_entry.value ->> 'key'
        and item.value ->> 'scoring_model' = 'sjt';
      if item_data is null then continue; end if;

      select question.id
      into strict created_question_id
      from public.questions question
      where question.section_id = created_section_id
        and question.order_index = question_entry.ordinality::integer;

      item_config := jsonb_build_object(
        'maxPoints', (item_data ->> 'max_points')::numeric,
        'minPoints', (item_data ->> 'min_points')::numeric,
        'options', (
          select jsonb_agg(jsonb_build_object(
            'dimensionEffects', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'effect', (effect.value ->> 'effect')::numeric,
                'scaleId', effect.value ->> 'dimension_key'
              ) order by effect.ordinality), '[]'::jsonb)
              from jsonb_array_elements(coalesce(option_config.value -> 'dimension_effects', '[]'::jsonb))
                with ordinality as effect(value, ordinality)
            ),
            'optionId', option_row.id::text,
            'points', (option_config.value ->> 'points')::numeric
          ) order by option_config.ordinality)
          from jsonb_array_elements(item_data -> 'options')
            with ordinality as option_config(value, ordinality)
          join lateral (
            select source_option.ordinality
            from jsonb_array_elements(question_entry.value -> 'options')
              with ordinality as source_option(value, ordinality)
            where source_option.value ->> 'key' = option_config.value ->> 'option_key'
          ) source_match on true
          join public.answer_options option_row
            on option_row.question_id = created_question_id
           and option_row.order_index = source_match.ordinality::integer
        )
      );

      update public.questions
      set scoring_model = 'sjt', scoring_config_json = item_config
      where id = created_question_id;
    end loop;
  end loop;
end;
$$;

revoke all on function public.apply_talvia_scoring_v2_pre_sjt(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.apply_talvia_scoring_v2(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_talvia_scoring_v2(uuid, jsonb)
  to service_role;
