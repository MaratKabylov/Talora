-- Make V2 remediation materialization independent from the historical chain of
-- V1 importer wrappers. Some remote databases may expose import_system_test_v2
-- while still having an older V1 content helper that drops remediation fields.

create or replace function public.apply_talvia_import_remediation_v2(
  target_version_id uuid,
  import_document jsonb
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
  source_question_id uuid;
  target_question_id uuid;
  remediation_key text;
begin
  for section_entry in
    select item.value, item.ordinality
    from jsonb_array_elements(import_document -> 'test' -> 'sections')
      with ordinality as item(value, ordinality)
  loop
    select section.id
    into strict created_section_id
    from public.test_sections section
    where section.test_version_id = target_version_id
      and section.order_index = section_entry.ordinality::integer;

    for question_entry in
      select item.value, item.ordinality
      from jsonb_array_elements(section_entry.value -> 'questions')
        with ordinality as item(value, ordinality)
    loop
      remediation_key := nullif(
        btrim(question_entry.value ->> 'remediation_question_key'),
        ''
      );
      if remediation_key is null then
        continue;
      end if;
      if question_entry.value ->> 'type' not in ('single_choice', 'multiple_choice')
         or nullif(btrim(question_entry.value ->> 'incorrect_feedback'), '') is null
      then
        raise exception 'Invalid Talvia v2 remediation source';
      end if;

      select question.id
      into strict source_question_id
      from public.questions question
      where question.section_id = created_section_id
        and question.order_index = question_entry.ordinality::integer;

      select target_question.id
      into target_question_id
      from jsonb_array_elements(section_entry.value -> 'questions')
        with ordinality as target_entry(value, ordinality)
      join public.questions target_question
        on target_question.section_id = created_section_id
       and target_question.order_index = target_entry.ordinality::integer
      where target_entry.value ->> 'key' = remediation_key
        and target_entry.ordinality > question_entry.ordinality;

      if target_question_id is null then
        raise exception 'Invalid Talvia v2 remediation target';
      end if;

      update public.questions
      set settings_json = settings_json || jsonb_build_object(
        'incorrectFeedback', nullif(btrim(question_entry.value ->> 'incorrect_feedback'), ''),
        'remediationQuestionId', target_question_id
      )
      where id = source_question_id;
    end loop;
  end loop;
end;
$$;

revoke all on function public.apply_talvia_import_remediation_v2(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_talvia_import_remediation_v2(uuid, jsonb)
  to service_role;

alter function public.apply_talvia_import_content_blocks_v2(uuid, jsonb)
  rename to apply_talvia_import_content_blocks_v2_pre_remediation;

revoke all on function public.apply_talvia_import_content_blocks_v2_pre_remediation(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_talvia_import_content_blocks_v2_pre_remediation(uuid, jsonb)
  to service_role;

create or replace function public.apply_talvia_import_content_blocks_v2(
  target_version_id uuid,
  import_document jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform public.apply_talvia_import_content_blocks_v2_pre_remediation(
    target_version_id,
    import_document
  );
  perform public.apply_talvia_import_remediation_v2(
    target_version_id,
    import_document
  );
end;
$$;

revoke all on function public.apply_talvia_import_content_blocks_v2(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_talvia_import_content_blocks_v2(uuid, jsonb)
  to service_role;
