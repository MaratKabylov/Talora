-- Persist talvia.test.v1 shuffle_options in the existing question settings JSON.
-- An absent setting remains false, so published legacy tests keep their order.

alter function public.insert_talvia_test_content_v1(uuid, jsonb)
  rename to insert_talvia_test_content_v1_pre_choice_option_shuffle;

revoke all on function public.insert_talvia_test_content_v1_pre_choice_option_shuffle(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.insert_talvia_test_content_v1_pre_choice_option_shuffle(uuid, jsonb)
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
  created_section_id uuid;
  created_question_id uuid;
  question_data jsonb;
begin
  if exists (
    select 1
    from jsonb_array_elements(test_data -> 'sections') section_item(value)
    cross join lateral jsonb_array_elements(section_item.value -> 'questions')
      question_item(value)
    where question_item.value ->> 'type' in ('single_choice', 'multiple_choice')
      and question_item.value ? 'shuffle_options'
      and jsonb_typeof(question_item.value -> 'shuffle_options') is distinct from 'boolean'
  ) then
    raise exception 'Invalid Talvia shuffle_options value';
  end if;

  perform public.insert_talvia_test_content_v1_pre_choice_option_shuffle(
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
      if question_data ->> 'type' not in ('single_choice', 'multiple_choice') then
        continue;
      end if;

      select question.id
      into strict created_question_id
      from public.questions question
      where question.section_id = created_section_id
        and question.order_index = question_entry.ordinality::integer;

      update public.questions
      set settings_json = settings_json || jsonb_build_object(
        'shuffleOptions', coalesce((question_data ->> 'shuffle_options')::boolean, false)
      )
      where id = created_question_id;
    end loop;
  end loop;
end;
$$;

revoke all on function public.insert_talvia_test_content_v1(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.insert_talvia_test_content_v1(uuid, jsonb)
  to service_role;
