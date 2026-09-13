-- Read-only verification after 20260912150000_perf012_confirmed_query_indexes.sql.
with expected(index_name, key_definition) as (
  values
    ('perf012_candidate_applications_company_created_id', '(company_id, created_at DESC, id)'),
    ('perf012_candidate_applications_company_job_created_id', '(company_id, job_id, created_at DESC, id)'),
    ('perf012_candidate_applications_company_job_fit_id', '(company_id, job_id, fit_score DESC NULLS LAST, id)'),
    ('perf012_employee_participants_assessment_created_id', '(employee_assessment_id, created_at DESC, id)'),
    ('perf012_employee_participants_company_assessment_fit_id', '(company_id, employee_assessment_id, fit_score DESC NULLS LAST, id)'),
    ('perf012_test_sections_version_order_id', '(test_version_id, order_index, id)'),
    ('perf012_questions_section_order_id', '(section_id, order_index, id)'),
    ('perf012_answer_options_question_order_id', '(question_id, order_index, id)')
), installed as (
  select index_class.relname as index_name, index_catalog.indisready,
         index_catalog.indisvalid, pg_get_indexdef(index_catalog.indexrelid) as definition
  from pg_index index_catalog
  join pg_class index_class on index_class.oid = index_catalog.indexrelid
  join pg_namespace schema_catalog on schema_catalog.oid = index_class.relnamespace
  where schema_catalog.nspname = 'public'
)
select jsonb_build_object(
  'perf012_confirmed_query_indexes', jsonb_build_object(
    'checked_at', clock_timestamp(),
    'server_version', current_setting('server_version'),
    'expected_count', (select count(*) from expected),
    'ready_valid_count', (
      select count(*) from expected
      join installed using (index_name)
      where installed.indisready and installed.indisvalid
        and installed.definition like '%' || expected.key_definition || '%'
    ),
    'missing_or_invalid', coalesce((
      select jsonb_agg(expected.index_name order by expected.index_name)
      from expected left join installed using (index_name)
      where installed.index_name is null or not installed.indisready or not installed.indisvalid
        or installed.definition not like '%' || expected.key_definition || '%'
    ), '[]'::jsonb),
    'definitions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'index_name', installed.index_name,
        'is_ready', installed.indisready,
        'is_valid', installed.indisvalid,
        'definition', installed.definition
      ) order by installed.index_name)
      from installed join expected using (index_name)
    ), '[]'::jsonb)
  )
) as result;
