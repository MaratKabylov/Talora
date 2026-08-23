-- Atomic talvia.test.v2 import wrappers. The established v1 content importer is
-- reused in the same transaction, then the trusted v2 scoring definition is
-- attached to the new draft version and its questions.

create or replace function public.apply_talvia_scoring_v2(
  target_version_id uuid,
  import_document jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  scoring_data jsonb;
  section_entry record;
  question_entry record;
  created_section_id uuid;
  created_question_id uuid;
  item_data jsonb;
  item_config jsonb;
  dimensions_json jsonb;
  composites_json jsonb;
  norms_json jsonb;
  overall_json jsonb;
  thresholds_json jsonb;
  learning_json jsonb;
begin
  if import_document is null
     or jsonb_typeof(import_document) <> 'object'
     or import_document ->> 'schema_version' <> 'talvia.test.v2'
     or jsonb_typeof(import_document -> 'test') <> 'object'
     or jsonb_typeof(import_document -> 'scoring') <> 'object'
     or import_document -> 'scoring' ->> 'scoring_version' <> '2.0'
  then
    raise exception 'Invalid Talvia v2 scoring document';
  end if;

  scoring_data := import_document -> 'scoring';

  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'aggregation', dimension.value ->> 'aggregation',
        'code', dimension.value ->> 'key',
        'description', dimension.value -> 'description',
        'displayOrder', (dimension.value ->> 'order')::integer,
        'id', dimension.value ->> 'key',
        'interpretationKey', dimension.value -> 'interpretation_key',
        'minAnsweredItems', dimension.value -> 'min_answered_items',
        'minAnsweredRatio', dimension.value -> 'min_answered_ratio',
        'missingPolicy', dimension.value ->> 'missing_policy',
        'theoreticalMax', (dimension.value ->> 'theoretical_max')::numeric,
        'theoreticalMin', (dimension.value ->> 'theoretical_min')::numeric,
        'title', dimension.value ->> 'title'
      )) order by dimension.ordinality
    ),
    '[]'::jsonb
  )
  into dimensions_json
  from jsonb_array_elements(coalesce(scoring_data -> 'dimensions', '[]'::jsonb))
    with ordinality as dimension(value, ordinality);

  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(jsonb_build_object(
        'aggregation', composite.value ->> 'aggregation',
        'code', composite.value ->> 'key',
        'id', composite.value ->> 'key',
        'inputs', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'scoreId', input.value ->> 'score_key',
            'source', input.value ->> 'source',
            'value', input.value ->> 'value',
            'weight', (input.value ->> 'weight')::numeric
          ) order by input.ordinality), '[]'::jsonb)
          from jsonb_array_elements(composite.value -> 'inputs')
            with ordinality as input(value, ordinality)
        ),
        'interpretationKey', composite.value -> 'interpretation_key',
        'minRequiredInputs', composite.value -> 'min_required_inputs',
        'missingPolicy', composite.value ->> 'missing_policy',
        'outputRange', case
          when composite.value -> 'output_range' is null
            or composite.value -> 'output_range' = 'null'::jsonb then null
          else jsonb_build_object(
            'max', (composite.value -> 'output_range' ->> 'max')::numeric,
            'min', (composite.value -> 'output_range' ->> 'min')::numeric
          )
        end,
        'title', composite.value ->> 'title'
      )) order by composite.ordinality
    ),
    '[]'::jsonb
  )
  into composites_json
  from jsonb_array_elements(coalesce(scoring_data -> 'composites', '[]'::jsonb))
    with ordinality as composite(value, ordinality);

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'normScaleCode', assignment.value ->> 'norm_scale_code',
      'normSetId', assignment.value ->> 'norm_set_id',
      'normSetVersion', (assignment.value ->> 'norm_set_version')::integer,
      'primaryMetric', assignment.value ->> 'primary_metric',
      'scaleId', assignment.value ->> 'dimension_key'
    ) order by assignment.ordinality),
    '[]'::jsonb
  )
  into norms_json
  from jsonb_array_elements(coalesce(scoring_data -> 'norm_assignments', '[]'::jsonb))
    with ordinality as assignment(value, ordinality);

  overall_json := case
    when scoring_data -> 'overall_score' is null
      or scoring_data -> 'overall_score' = 'null'::jsonb then null
    else jsonb_build_object(
      'sourceId', scoring_data -> 'overall_score' ->> 'source_key',
      'sourceType', scoring_data -> 'overall_score' ->> 'source_type'
    )
  end;

  learning_json := case
    when scoring_data -> 'learning_scoring' is null
      or scoring_data -> 'learning_scoring' = 'null'::jsonb then null
    else jsonb_build_object(
      'initialWeight', (scoring_data -> 'learning_scoring' ->> 'initial_weight')::numeric,
      'recoveryWeight', (scoring_data -> 'learning_scoring' ->> 'recovery_weight')::numeric
    )
  end;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'code', threshold.value ->> 'code',
      'label', threshold.value ->> 'label',
      'max', (threshold.value ->> 'max')::numeric,
      'min', (threshold.value ->> 'min')::numeric
    ) order by threshold.ordinality),
    '[]'::jsonb
  )
  into thresholds_json
  from jsonb_array_elements(coalesce(scoring_data -> 'thresholds', '[]'::jsonb))
    with ordinality as threshold(value, ordinality);

  update public.test_versions
  set scoring_schema_version = '2.0',
      assessment_domain = scoring_data ->> 'assessment_domain',
      result_shape = scoring_data ->> 'result_shape',
      scoring_config_json = jsonb_build_object(
        'assessmentDomain', scoring_data ->> 'assessment_domain',
        'composites', composites_json,
        'learningScoring', learning_json,
        'normAssignments', norms_json,
        'overallScore', overall_json,
        'resultShape', scoring_data ->> 'result_shape',
        'scales', dimensions_json,
        'schemaVersion', '2.0',
        'thresholds', thresholds_json
      )
  where id = target_version_id and status = 'draft';

  if not found then
    raise exception 'Imported v2 test version is unavailable';
  end if;

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
      select question.id
      into strict created_question_id
      from public.questions question
      where question.section_id = created_section_id
        and question.order_index = question_entry.ordinality::integer;

      select item.value
      into item_data
      from jsonb_array_elements(scoring_data -> 'items') as item(value)
      where item.value ->> 'question_key' = question_entry.value ->> 'key';

      if question_entry.value ->> 'type' = 'open_text' then
        if item_data is not null then
          raise exception 'Open-text questions cannot have automatic scoring';
        end if;
        continue;
      end if;
      if item_data is null then
        raise exception 'Missing v2 scoring item for question %', question_entry.value ->> 'key';
      end if;

      if item_data ->> 'scoring_model' = 'criterion' then
        item_config := jsonb_build_object(
          'competencyBindings', (
            select coalesce(jsonb_agg(jsonb_build_object(
              'competencyId', binding.value ->> 'competency_key',
              'weight', (binding.value ->> 'weight')::numeric
            ) order by binding.ordinality), '[]'::jsonb)
            from jsonb_array_elements(coalesce(item_data -> 'competency_bindings', '[]'::jsonb))
              with ordinality as binding(value, ordinality)
          ),
          'maxPoints', (item_data ->> 'max_points')::numeric,
          'minPoints', (item_data ->> 'min_points')::numeric,
          'strategy', item_data ->> 'strategy'
        );
      elsif item_data ->> 'scoring_model' = 'scale' then
        item_config := jsonb_build_object(
          'bindings', (
            select jsonb_agg(jsonb_build_object(
              'direction', case
                when (effect.value ->> 'reverse_scored')::boolean then -1 else 1
              end,
              'scaleId', effect.value ->> 'dimension_key',
              'weight', (effect.value ->> 'item_weight')::numeric
            ) order by effect.ordinality)
            from jsonb_array_elements(item_data -> 'dimension_effects')
              with ordinality as effect(value, ordinality)
          ),
          'responseMax', (item_data ->> 'response_max')::numeric,
          'responseMin', (item_data ->> 'response_min')::numeric
        );
      elsif item_data ->> 'scoring_model' = 'forced_choice' then
        item_config := jsonb_build_object(
          'centering', item_data ->> 'centering',
          'method', item_data ->> 'method',
          'roleWeights', jsonb_build_object(
            'least', (item_data -> 'role_weights' ->> 'least')::numeric,
            'most', (item_data -> 'role_weights' ->> 'most')::numeric
          ),
          'statements', (
            select jsonb_agg(jsonb_build_object(
              'keyedDirection', (statement.value ->> 'keyed_direction')::integer,
              'scaleId', statement.value ->> 'dimension_key',
              'statementId', option_row.id::text
            ) order by statement.ordinality)
            from jsonb_array_elements(item_data -> 'statements')
              with ordinality as statement(value, ordinality)
            join lateral (
              select source_option.ordinality
              from jsonb_array_elements(question_entry.value -> 'options')
                with ordinality as source_option(value, ordinality)
              where source_option.value ->> 'key' = statement.value ->> 'option_key'
            ) source_match on true
            join public.answer_options option_row
              on option_row.question_id = created_question_id
             and option_row.order_index = source_match.ordinality::integer
          )
        );
      else
        raise exception 'Unsupported v2 scoring model';
      end if;

      update public.questions
      set scoring_model = item_data ->> 'scoring_model',
          scoring_config_json = item_config
      where id = created_question_id;
    end loop;
  end loop;
end;
$$;

revoke all on function public.apply_talvia_scoring_v2(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_talvia_scoring_v2(uuid, jsonb)
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
