-- Allow platform administrators to undo an accidental system test publication only
-- while the latest version is still unused. Published content remains immutable in
-- every other case.

create unique index if not exists idx_test_versions_one_draft_per_template
  on public.test_versions(test_template_id)
  where status = 'draft';

create or replace function public.protect_published_test_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_revert_version_id text;
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'Published test versions cannot be deleted';
    end if;

    return old;
  end if;

  if tg_op = 'UPDATE' and old.status = 'published' then
    allowed_revert_version_id := current_setting(
      'talora.revert_system_test_version_id',
      true
    );

    if allowed_revert_version_id = old.id::text
      and new.status = 'draft'
      and new.published_at is null
      and (
        to_jsonb(new) - array['status', 'published_at', 'updated_at']
        = to_jsonb(old) - array['status', 'published_at', 'updated_at']
      )
    then
      return new;
    end if;

    raise exception 'Published test versions cannot be edited';
  end if;

  if new.status = 'published' then
    new.published_at = coalesce(new.published_at, now());
  else
    new.published_at = null;
  end if;

  return new;
end;
$$;

-- Lock a version before assigning it to a package. This makes the eligibility
-- check serialize with an attempted publication rollback.
create or replace function public.validate_assessment_package_test_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_version_status text;
begin
  select version.status
  into selected_version_status
  from public.test_versions version
  where version.id = new.test_version_id
  for key share;

  if selected_version_status is distinct from 'published'
    or not public.package_can_use_test_version(new.package_id, new.test_version_id)
  then
    raise exception 'Test version is not available to this assessment package';
  end if;

  return new;
end;
$$;

-- Apply the same serialization to candidate session creation.
create or replace function public.validate_test_session_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_version_status text;
begin
  select version.status
  into selected_version_status
  from public.test_versions version
  where version.id = new.test_version_id
  for key share;

  if selected_version_status is distinct from 'published'
    or not exists (
      select 1
      from public.candidate_applications application
      join public.jobs job on job.id = application.job_id
      join public.assessment_package_tests package_test
        on package_test.package_id = job.assessment_package_id
       and package_test.test_version_id = new.test_version_id
      where application.id = new.application_id
        and application.candidate_id = new.candidate_id
    )
  then
    raise exception 'Test session must use a published test assigned to the application job';
  end if;

  return new;
end;
$$;

-- Apply the same serialization to employee assessment session creation.
create or replace function public.validate_employee_assessment_session_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_version_status text;
begin
  select version.status
  into selected_version_status
  from public.test_versions version
  where version.id = new.test_version_id
  for key share;

  if selected_version_status is distinct from 'published'
    or not exists (
      select 1
      from public.employee_assessment_participants participant
      join public.employee_assessments assessment
        on assessment.id = participant.employee_assessment_id
      join public.assessment_package_tests package_test
        on package_test.package_id = assessment.assessment_package_id
       and package_test.test_version_id = new.test_version_id
      where participant.id = new.participant_id
        and participant.employee_id = new.employee_id
    )
  then
    raise exception 'Employee assessment session must use a published test assigned to the assessment package';
  end if;

  return new;
end;
$$;

create or replace function public.revert_unused_system_test_version_to_draft(
  target_template_id uuid,
  target_version_id uuid,
  acting_user_id uuid,
  acting_user_role text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_published_at timestamptz;
  selected_template_status text;
  selected_version_id uuid;
  selected_version_number integer;
  selected_version_status text;
begin
  if acting_user_role not in ('platform_owner', 'platform_admin')
    or not exists (
      select 1
      from public.platform_users platform_user
      where platform_user.user_id = acting_user_id
        and platform_user.role = acting_user_role
        and platform_user.status = 'active'
    )
  then
    raise exception 'SYSTEM_TEST_REVERT_ACTOR_FORBIDDEN';
  end if;

  select
    version.id,
    version.version_number,
    version.published_at,
    version.status,
    template.status
  into
    selected_version_id,
    selected_version_number,
    selected_published_at,
    selected_version_status,
    selected_template_status
  from public.test_versions version
  join public.test_templates template on template.id = version.test_template_id
  where version.id = target_version_id
    and version.test_template_id = target_template_id
    and template.is_system = true
    and template.company_id is null
  for update of version, template;

  if selected_version_id is null then
    raise exception 'SYSTEM_TEST_REVERT_NOT_FOUND';
  end if;

  if selected_template_status <> 'active' then
    raise exception 'SYSTEM_TEST_REVERT_TEMPLATE_INACTIVE';
  end if;

  if selected_version_status <> 'published' then
    raise exception 'SYSTEM_TEST_REVERT_NOT_PUBLISHED';
  end if;

  if exists (
    select 1
    from public.test_versions newer_version
    where newer_version.test_template_id = target_template_id
      and newer_version.version_number > selected_version_number
  )
  then
    raise exception 'SYSTEM_TEST_REVERT_NOT_LATEST';
  end if;

  if exists (
    select 1
    from public.test_versions draft_version
    where draft_version.test_template_id = target_template_id
      and draft_version.id <> target_version_id
      and draft_version.status = 'draft'
  )
  then
    raise exception 'SYSTEM_TEST_REVERT_DRAFT_EXISTS';
  end if;

  if exists (
    select 1
    from public.assessment_package_tests package_test
    where package_test.test_version_id = target_version_id
  )
  then
    raise exception 'SYSTEM_TEST_REVERT_PACKAGE_REFERENCES';
  end if;

  if exists (
    select 1
    from public.test_sessions session
    where session.test_version_id = target_version_id
  ) or exists (
    select 1
    from public.test_results result
    where result.test_version_id = target_version_id
  )
  then
    raise exception 'SYSTEM_TEST_REVERT_CANDIDATE_USAGE';
  end if;

  if exists (
    select 1
    from public.employee_assessment_sessions session
    where session.test_version_id = target_version_id
  ) or exists (
    select 1
    from public.employee_assessment_test_results result
    where result.test_version_id = target_version_id
  )
  then
    raise exception 'SYSTEM_TEST_REVERT_EMPLOYEE_USAGE';
  end if;

  perform set_config(
    'talora.revert_system_test_version_id',
    target_version_id::text,
    true
  );

  begin
    update public.test_versions
    set
      published_at = null,
      status = 'draft'
    where id = target_version_id;
  exception
    when unique_violation then
      raise exception 'SYSTEM_TEST_REVERT_DRAFT_EXISTS';
  end;

  insert into public.platform_audit_logs (
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    reason,
    metadata_json
  )
  values (
    acting_user_id,
    acting_user_role,
    'revert_unused_system_test_version_to_draft',
    'test_version',
    target_version_id,
    'Отмена ошибочной публикации',
    jsonb_build_object(
      'newStatus', 'draft',
      'previousPublishedAt', selected_published_at,
      'previousStatus', 'published',
      'testTemplateId', target_template_id,
      'versionNumber', selected_version_number
    )
  );

  return jsonb_build_object(
    'status', 'draft',
    'testTemplateId', target_template_id,
    'versionId', target_version_id,
    'versionNumber', selected_version_number
  );
end;
$$;

revoke all on function public.revert_unused_system_test_version_to_draft(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.revert_unused_system_test_version_to_draft(uuid, uuid, uuid, text)
  to service_role;
