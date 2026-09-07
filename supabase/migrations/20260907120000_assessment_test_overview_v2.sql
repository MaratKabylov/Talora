-- PERF-004b: minimal test-page overview. Deploy this file, NOT tests/fixtures/*.sql.
create or replace function public.read_assessment_test_overview_v2(
  p_scope text, p_token text, p_session_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  invitation_table text;
  owner_table text;
  owner_column text;
  person_table text;
  person_column text;
  context_table text;
  context_column text;
  access_row record;
  eligible_sql text;
  result jsonb;
begin
  if p_scope is null or p_scope not in ('candidate', 'employee')
     or p_token is null or p_token !~* '^[a-f0-9]{64}$' or p_session_id is null then
    return jsonb_build_object('availability', 'invalid');
  end if;
  if p_scope = 'employee' then
    invitation_table := 'employee_assessment_invitations';
    owner_table := 'employee_assessment_participants'; owner_column := 'participant_id';
    person_table := 'employees'; person_column := 'employee_id';
    context_table := 'employee_assessments'; context_column := 'employee_assessment_id';
  else
    invitation_table := 'invitations';
    owner_table := 'candidate_applications'; owner_column := 'application_id';
    person_table := 'candidates'; person_column := 'candidate_id';
    context_table := 'jobs'; context_column := 'job_id';
  end if;

  -- Only allowlisted identifiers enter format(). All request values use USING.
  -- Validate the complete tenant/owner/person/context chain without reading a profile.
  execute format(
    'select invitation.status, invitation.expires_at, invitation.consent_given_at,
       owner.id as owner_id, person.id as person_id, company.id as company_id,
       company.name as company_name, context.title as context_title,
       package.id as package_id
     from public.%I invitation
     join public.%I owner on owner.id = invitation.%I and owner.company_id = invitation.company_id
     join public.%I person on person.id = invitation.%I and person.id = owner.%I
       and person.company_id = invitation.company_id
     join public.%I context on context.id = invitation.%I and context.id = owner.%I
       and context.company_id = invitation.company_id
     join public.companies company on company.id = invitation.company_id
     left join public.assessment_packages package on package.id = context.assessment_package_id
       and (package.company_id is null or package.company_id = invitation.company_id)
     where invitation.token = $1',
    invitation_table, owner_table, owner_column, person_table, person_column, person_column,
    context_table, context_column, context_column
  ) into access_row using p_token;
  if access_row.owner_id is null then return jsonb_build_object('availability', 'invalid'); end if;
  if access_row.status = 'cancelled' then return jsonb_build_object('availability', 'cancelled'); end if;
  if access_row.status = 'expired' or (access_row.status <> 'completed'
      and access_row.expires_at <= statement_timestamp()) then
    return jsonb_build_object('availability', 'expired');
  end if;
  -- Completed invitations still route to the receipt after expires_at, as in V1.
  if access_row.status = 'completed' then return jsonb_build_object('availability', 'completed'); end if;
  if access_row.consent_given_at is null then return jsonb_build_object('availability', 'needs_consent'); end if;

  if p_scope = 'candidate' then
    if access_row.package_id is null then return jsonb_build_object('availability', 'invalid'); end if;
    -- Preserve candidate V1 eligibility: only published tests in the current job package.
    eligible_sql := 'select session.id, session.status, session.deadline_at, session.test_version_id,
        package_test.order_index::bigint as order_index
      from public.test_sessions session
      join public.assessment_package_tests package_test
        on package_test.package_id = $3 and package_test.test_version_id = session.test_version_id
      join public.test_versions version on version.id = session.test_version_id and version.status = ''published''
      where session.application_id = $1 and session.candidate_id = $2';
  else
    if access_row.package_id is null and not exists (
      select 1 from public.employee_assessment_sessions session
      join public.assessment_packages package on package.id = session.package_id
        and (package.company_id is null or package.company_id = access_row.company_id)
      where session.participant_id = access_row.owner_id and session.employee_id = access_row.person_id
    ) then return jsonb_build_object('availability', 'invalid'); end if;
    -- Employee V1 also restores assigned versions outside the current package (even archived).
    -- Legacy rows without an order get a deterministic created_at/id fallback.
    eligible_sql := 'select session.id, session.status, session.deadline_at, session.test_version_id,
        coalesce(case when version.status = ''published'' then package_test.order_index end,
          session.package_order_index, row_number() over (order by session.created_at, session.id) - 1) as order_index
      from public.employee_assessment_sessions session
      join public.test_versions version on version.id = session.test_version_id
      left join public.assessment_package_tests package_test
        on package_test.package_id = $3 and package_test.test_version_id = session.test_version_id
      where session.participant_id = $1 and session.employee_id = $2';
  end if;

  -- The materialized set contains only session identity/status/order, never other test content.
  execute format(
    'with eligible as materialized (%s)
     select jsonb_build_object(
       ''availability'', ''active'', ''companyName'', $5, ''contextTitle'', $6,
       ''sessionCount'', (select count(*) from eligible),
       ''completedSessionCount'', (select count(*) from eligible where status = ''completed''),
       ''nextSessionId'', (select id from eligible where status = ''in_progress'' order by order_index, id limit 1),
       ''session'', (select jsonb_build_object(
         ''id'', session.id, ''status'', session.status, ''deadlineAt'', session.deadline_at,
         ''test'', jsonb_build_object(
           ''title'', coalesce(template.title, version.title),
           ''description'', version.description, ''instructions'', version.instructions,
           ''presentationSettings'', jsonb_strip_nulls(jsonb_build_object(
             ''allowBack'', version.settings_json -> ''allowBack'',
             ''captureQuestionTime'', version.settings_json -> ''captureQuestionTime'',
             ''presentationMode'', version.settings_json -> ''presentationMode''))))
         from eligible session join public.test_versions version on version.id = session.test_version_id
         left join public.test_templates template on template.id = version.test_template_id
         where session.id = $4))', eligible_sql
  ) into result using access_row.owner_id, access_row.person_id, access_row.package_id,
    p_session_id, access_row.company_name, access_row.context_title;
  if result -> 'session' = 'null'::jsonb then return jsonb_build_object('availability', 'invalid'); end if;
  return result;
end;
$$;
revoke all on function public.read_assessment_test_overview_v2(text, text, uuid) from public, anon, authenticated;
grant execute on function public.read_assessment_test_overview_v2(text, text, uuid) to service_role;
