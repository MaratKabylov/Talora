-- PERF-009. Deploy before the application; no browser grants or legacy fallback.
create function public.clone_published_test_version(
  target_template_id uuid, source_version_id uuid, acting_user_id uuid, target_company_id uuid
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  template public.test_templates%rowtype;
  source public.test_versions%rowtype;
  draft_id uuid;
  next_number integer;
  platform_role text;
  version_scoring jsonb;
begin
  if target_template_id is null or source_version_id is null or acting_user_id is null then
    raise exception 'TEST_CLONE_INVALID_IDENTITY' using errcode = '22023';
  end if;
  -- Serialize clones/number allocation and block template archival during the copy.
  select * into template from public.test_templates where id = target_template_id for update;
  if not found or template.status <> 'active' then
    raise exception 'TEST_CLONE_UNAVAILABLE' using errcode = '42501';
  end if;
  if target_company_id is null then
    if not template.is_system or template.company_id is not null then
      raise exception 'TEST_CLONE_FORBIDDEN' using errcode = '42501';
    end if;
    select role into platform_role from public.platform_users
      where user_id = acting_user_id and status = 'active'
      and role in ('platform_owner', 'platform_admin') for share;
    if not found then raise exception 'TEST_CLONE_FORBIDDEN' using errcode = '42501'; end if;
  else
    if template.is_system or template.company_id is distinct from target_company_id then
      raise exception 'TEST_CLONE_FORBIDDEN' using errcode = '42501';
    end if;
    perform 1 from public.companies where id = target_company_id and status = 'active' for share;
    if not found then raise exception 'TEST_CLONE_FORBIDDEN' using errcode = '42501'; end if;
    perform 1 from public.company_users where company_id = target_company_id
      and user_id = acting_user_id and status = 'active'
      and role in ('owner', 'admin', 'recruiter', 'super_admin') for share;
    if not found then raise exception 'TEST_CLONE_FORBIDDEN' using errcode = '42501'; end if;
  end if;
  -- Publication/revert/archive and all content writers lock this row as well.
  select * into source from public.test_versions where id = source_version_id
    and test_template_id = target_template_id for update;
  if not found or source.status <> 'published' then
    raise exception 'TEST_CLONE_SOURCE_NOT_PUBLISHED' using errcode = '55000';
  end if;
  select id into draft_id from public.test_versions
    where test_template_id = target_template_id and status = 'draft'
    order by version_number desc limit 1 for update;
  if found then return jsonb_build_object('versionId', draft_id, 'created', false); end if;

  -- Private transaction-local mapping relation. Never reuse a caller-created table.
  create temporary table builder_clone_ids (
    kind text not null, old_id uuid not null, new_id uuid not null,
    parent_id uuid, new_target_id uuid, primary key(kind, old_id)
  ) on commit drop;
  insert into pg_temp.builder_clone_ids(kind, old_id, new_id, parent_id, new_target_id)
    select 'section', s.id, gen_random_uuid(), s.test_version_id, null::uuid
      from public.test_sections s where s.test_version_id = source.id
    union all
    select 'question', q.id, gen_random_uuid(), q.section_id, null::uuid
      from public.questions q join public.test_sections s on s.id = q.section_id
      where s.test_version_id = source.id
    union all
    select 'option', o.id, gen_random_uuid(), o.question_id, gen_random_uuid()
      from public.answer_options o join public.questions q on q.id = o.question_id
      join public.test_sections s on s.id = q.section_id where s.test_version_id = source.id;

  -- Broken/external references must fail, never retain a link to another version.
  if exists (
    select 1 from public.questions q join pg_temp.builder_clone_ids m
      on m.kind = 'question' and m.old_id = q.id
    left join pg_temp.builder_clone_ids target on target.kind = 'question'
      and target.old_id::text = q.settings_json ->> 'remediationQuestionId'
      and target.parent_id = q.section_id
    where q.settings_json ->> 'remediationQuestionId' is not null and target.old_id is null
  ) then raise exception 'TEST_CLONE_INVALID_REFERENCE' using errcode = '22023'; end if;
  if exists (
    select 1 from public.questions q join pg_temp.builder_clone_ids m
      on m.kind = 'question' and m.old_id = q.id
    cross join lateral jsonb_array_elements(case q.scoring_model
      when 'sjt' then q.scoring_config_json -> 'options'
      when 'forced_choice' then q.scoring_config_json -> 'statements'
      else '[]'::jsonb end) entry
    left join pg_temp.builder_clone_ids target on target.kind = 'option' and target.parent_id = q.id
      and target.old_id::text = entry ->> case q.scoring_model when 'sjt' then 'optionId' else 'statementId' end
    where target.old_id is null
  ) then raise exception 'TEST_CLONE_INVALID_REFERENCE' using errcode = '22023'; end if;

  -- Item criterion IDs may appear in composite/overall mappings. Stable scale,
  -- composite, derived criterion and external norm-set identifiers remain unchanged.
  version_scoring := source.scoring_config_json;
  if jsonb_typeof(version_scoring -> 'composites') = 'array' then
    version_scoring := jsonb_set(version_scoring, '{composites}', (
      select coalesce(jsonb_agg(jsonb_set(c.value, '{inputs}', (
        select coalesce(jsonb_agg(case when m.new_id is not null
          then jsonb_set(i.value, '{scoreId}', to_jsonb(m.new_id)) else i.value end order by i.ordinality), '[]'::jsonb)
        from jsonb_array_elements(c.value -> 'inputs') with ordinality i(value, ordinality)
        left join pg_temp.builder_clone_ids m on m.kind = 'question'
          and m.old_id::text = i.value ->> 'scoreId' and i.value ->> 'source' = 'criterion'
      )) order by c.ordinality), '[]'::jsonb)
      from jsonb_array_elements(version_scoring -> 'composites') with ordinality c(value, ordinality)
    ));
  end if;
  select coalesce((select jsonb_set(version_scoring, '{overallScore,sourceId}', to_jsonb(m.new_id))
    from pg_temp.builder_clone_ids m where m.kind = 'question'
      and m.old_id::text = version_scoring #>> '{overallScore,sourceId}'
      and version_scoring #>> '{overallScore,sourceType}' = 'criterion'), version_scoring) into version_scoring;

  select coalesce(max(version_number), 0) + 1 into next_number
    from public.test_versions where test_template_id = target_template_id;
  insert into public.test_versions(test_template_id, version_number, title, description, instructions,
    duration_minutes, scoring_type, settings_json, scoring_schema_version, assessment_domain,
    result_shape, scoring_config_json, status)
    select target_template_id, next_number, 'v.' || next_number || ' от ' || to_char(current_date, 'DD-MM-YYYY'),
      source.description, source.instructions, source.duration_minutes, source.scoring_type, source.settings_json,
      source.scoring_schema_version, source.assessment_domain, source.result_shape, version_scoring, 'draft'
    returning id into draft_id;
  insert into public.test_sections(id, test_version_id, title, description, order_index, time_limit_minutes, settings_json)
    select m.new_id, draft_id, s.title, s.description, s.order_index, s.time_limit_minutes, s.settings_json
    from public.test_sections s join pg_temp.builder_clone_ids m on m.kind = 'section' and m.old_id = s.id;
  insert into public.questions(id, section_id, question_type, text, description, media_url, order_index,
    points, competency_key, difficulty, settings_json, scoring_model, scoring_config_json)
    select m.new_id, parent.new_id, q.question_type, q.text, q.description, q.media_url, q.order_index,
      q.points, q.competency_key, q.difficulty,
      case when target.new_id is null then q.settings_json
        else jsonb_set(q.settings_json, '{remediationQuestionId}', to_jsonb(target.new_id)) end,
      q.scoring_model,
      case when q.scoring_model in ('sjt', 'forced_choice') then jsonb_set(q.scoring_config_json,
        array[case q.scoring_model when 'sjt' then 'options' else 'statements' end], (
          select coalesce(jsonb_agg(jsonb_set(entry.value,
            array[case q.scoring_model when 'sjt' then 'optionId' else 'statementId' end],
            to_jsonb(o.new_id)) order by entry.ordinality), '[]'::jsonb)
          from jsonb_array_elements(q.scoring_config_json -> case q.scoring_model when 'sjt' then 'options' else 'statements' end)
            with ordinality entry(value, ordinality)
          join pg_temp.builder_clone_ids o on o.kind = 'option' and o.parent_id = q.id
            and o.old_id::text = entry.value ->> case q.scoring_model when 'sjt' then 'optionId' else 'statementId' end
        )) else q.scoring_config_json end
    from public.questions q join pg_temp.builder_clone_ids m on m.kind = 'question' and m.old_id = q.id
    join pg_temp.builder_clone_ids parent on parent.kind = 'section' and parent.old_id = q.section_id
    left join pg_temp.builder_clone_ids target on target.kind = 'question'
      and target.old_id::text = q.settings_json ->> 'remediationQuestionId';
  insert into public.answer_options(id, question_id, text, order_index, is_correct, points,
    competency_effect_json, explanation, match_text, match_target_id)
    select m.new_id, parent.new_id, o.text, o.order_index, o.is_correct, o.points,
      o.competency_effect_json, o.explanation, o.match_text, m.new_target_id
    from public.answer_options o join pg_temp.builder_clone_ids m on m.kind = 'option' and m.old_id = o.id
    join pg_temp.builder_clone_ids parent on parent.kind = 'question' and parent.old_id = o.question_id;

  if target_company_id is null then
    insert into public.platform_audit_logs(actor_user_id, actor_role, action, target_type, target_id, metadata_json)
      values (acting_user_id, platform_role, 'create_system_test_draft_from_published', 'test_version', draft_id,
        jsonb_build_object('testTemplateId', target_template_id, 'sourceVersionId', source.id));
  end if;
  drop table pg_temp.builder_clone_ids;
  return jsonb_build_object('versionId', draft_id, 'created', true);
end;
$$;
revoke all on function public.clone_published_test_version(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.clone_published_test_version(uuid,uuid,uuid,uuid) to service_role;
