-- Preserve ordered section content blocks in talvia.test.v2 imports. The v1
-- content importer creates the sections; this helper attaches the presentation
-- blocks after those rows have their database UUIDs.

create or replace function public.apply_talvia_import_content_blocks_v2(
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
  created_section_id uuid;
  blocks jsonb;
begin
  for section_entry in
    select item.value, item.ordinality
    from jsonb_array_elements(import_document -> 'test' -> 'sections')
      with ordinality as item(value, ordinality)
  loop
    if jsonb_typeof(coalesce(section_entry.value -> 'content_blocks', '[]'::jsonb)) <> 'array' then
      raise exception 'Invalid Talvia v2 content_blocks';
    end if;

    select section.id
    into strict created_section_id
    from public.test_sections section
    where section.test_version_id = target_version_id
      and section.order_index = section_entry.ordinality::integer;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'description', block.value -> 'description',
          'id', gen_random_uuid(),
          'orderIndex', block.ordinality::integer - 1,
          'positionIndex', (block.value ->> 'position_index')::integer,
          'title', block.value ->> 'title'
        ) order by block.ordinality
      ),
      '[]'::jsonb
    )
    into blocks
    from jsonb_array_elements(coalesce(section_entry.value -> 'content_blocks', '[]'::jsonb))
      with ordinality as block(value, ordinality);

    update public.test_sections
    set settings_json = settings_json || jsonb_build_object('contentBlocks', blocks)
    where id = created_section_id;
  end loop;
end;
$$;

revoke all on function public.apply_talvia_import_content_blocks_v2(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_talvia_import_content_blocks_v2(uuid, jsonb)
  to service_role;

create or replace function public.import_company_test_v2(
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
  legacy_document jsonb;
begin
  if import_document ->> 'schema_version' <> 'talvia.test.v2' then
    raise exception 'Invalid Talvia test import document';
  end if;
  legacy_document := (import_document - 'scoring') ||
    jsonb_build_object('schema_version', 'talvia.test.v1');

  select imported.created_template_id, imported.created_version_id
  into created_template_id, created_version_id
  from public.import_company_test_v1(
    target_company_id,
    target_created_by,
    legacy_document
  ) imported;

  perform public.apply_talvia_scoring_v2(created_version_id, import_document);
  perform public.apply_talvia_import_content_blocks_v2(created_version_id, import_document);
  return next;
end;
$$;

revoke all on function public.import_company_test_v2(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_company_test_v2(uuid, uuid, jsonb)
  to service_role;

create or replace function public.import_system_test_v2(
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
  legacy_document jsonb;
begin
  if import_document ->> 'schema_version' <> 'talvia.test.v2' then
    raise exception 'Invalid Talvia test import document';
  end if;
  legacy_document := (import_document - 'scoring') ||
    jsonb_build_object('schema_version', 'talvia.test.v1');

  select imported.created_template_id, imported.created_version_id
  into created_template_id, created_version_id
  from public.import_system_test_v1(
    target_template_id,
    target_created_by,
    legacy_document
  ) imported;

  perform public.apply_talvia_scoring_v2(created_version_id, import_document);
  perform public.apply_talvia_import_content_blocks_v2(created_version_id, import_document);

  update public.platform_audit_logs
  set metadata_json = metadata_json || jsonb_build_object(
    'schemaVersion', 'talvia.test.v2',
    'scoringVersion', '2.0'
  )
  where target_id = created_version_id
    and action = 'import_system_test_version';
  return next;
end;
$$;

revoke all on function public.import_system_test_v2(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.import_system_test_v2(uuid, uuid, jsonb)
  to service_role;
