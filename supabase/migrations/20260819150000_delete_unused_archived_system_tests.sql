-- Permanently delete an archived system test only when none of its versions is
-- assigned to a package and no candidate or employee assessment session exists.
-- The checks, audit entry and deletion are intentionally kept in one transaction.

create or replace function public.protect_published_test_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_revert_version_id text;
  allowed_delete_template_id text;
  request_role text;
begin
  if tg_op = 'DELETE' then
    allowed_delete_template_id := current_setting(
      'talvia.delete_system_test_template_id',
      true
    );
    request_role := auth.role();

    if old.status = 'published'
      and not (
        coalesce(request_role, '') = 'service_role'
        and coalesce(allowed_delete_template_id, '') = old.test_template_id::text
      )
    then
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

create or replace function public.require_archived_test_template_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_delete_template_id text;
  request_role text;
begin
  if old.status <> 'archived' then
    raise exception 'Only archived test templates can be deleted';
  end if;

  if old.is_system then
    allowed_delete_template_id := current_setting(
      'talvia.delete_system_test_template_id',
      true
    );
    request_role := auth.role();

    if old.company_id is not null
      or coalesce(request_role, '') <> 'service_role'
      or coalesce(allowed_delete_template_id, '') <> old.id::text
    then
      raise exception 'System test templates cannot be deleted';
    end if;
  end if;

  return old;
end;
$$;

revoke all on function public.require_archived_test_template_before_delete()
  from public, anon, authenticated;

create or replace function public.delete_unused_archived_system_test(
  target_template_id uuid,
  acting_user_id uuid,
  acting_user_role text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  selected_template_id uuid;
  selected_template_status text;
  selected_template_title text;
  selected_version_count integer;
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
    raise exception 'SYSTEM_TEST_DELETE_ACTOR_FORBIDDEN';
  end if;

  select
    template.id,
    template.status,
    template.title
  into
    selected_template_id,
    selected_template_status,
    selected_template_title
  from public.test_templates template
  where template.id = target_template_id
    and template.is_system = true
    and template.company_id is null
  for update;

  if selected_template_id is null then
    raise exception 'SYSTEM_TEST_DELETE_NOT_FOUND';
  end if;

  if selected_template_status <> 'archived' then
    raise exception 'SYSTEM_TEST_DELETE_NOT_ARCHIVED';
  end if;

  select count(*)::integer
  into selected_version_count
  from public.test_versions version
  where version.test_template_id = target_template_id;

  if exists (
    select 1
    from public.assessment_package_tests package_test
    join public.test_versions version on version.id = package_test.test_version_id
    where version.test_template_id = target_template_id
  )
  then
    raise exception 'SYSTEM_TEST_DELETE_PACKAGE_REFERENCES';
  end if;

  if exists (
    select 1
    from public.test_sessions session
    join public.test_versions version on version.id = session.test_version_id
    where version.test_template_id = target_template_id
  ) or exists (
    select 1
    from public.test_results result
    join public.test_versions version on version.id = result.test_version_id
    where version.test_template_id = target_template_id
  )
  then
    raise exception 'SYSTEM_TEST_DELETE_CANDIDATE_USAGE';
  end if;

  if exists (
    select 1
    from public.employee_assessment_sessions session
    join public.test_versions version on version.id = session.test_version_id
    where version.test_template_id = target_template_id
  ) or exists (
    select 1
    from public.employee_assessment_test_results result
    join public.test_versions version on version.id = result.test_version_id
    where version.test_template_id = target_template_id
  )
  then
    raise exception 'SYSTEM_TEST_DELETE_EMPLOYEE_USAGE';
  end if;

  perform set_config(
    'talvia.delete_system_test_template_id',
    target_template_id::text,
    true
  );

  begin
    delete from public.test_templates
    where id = target_template_id
      and is_system = true
      and company_id is null
      and status = 'archived';
  exception
    when foreign_key_violation then
      raise exception 'SYSTEM_TEST_DELETE_REFERENCED';
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
    'delete_unused_archived_system_test',
    'test_template',
    target_template_id,
    'Удаление неиспользуемого архивного системного теста',
    jsonb_build_object(
      'previousStatus', selected_template_status,
      'testTitle', selected_template_title,
      'versionCount', selected_version_count
    )
  );

  return jsonb_build_object(
    'deletedTemplateId', target_template_id,
    'versionCount', selected_version_count
  );
end;
$$;

revoke all on function public.delete_unused_archived_system_test(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.delete_unused_archived_system_test(uuid, uuid, text)
  to service_role;
