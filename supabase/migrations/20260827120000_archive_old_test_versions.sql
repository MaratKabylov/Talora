-- Archive superseded published test versions without losing historical reports.
-- Published content stays immutable after archival. A version can be archived only
-- after a newer version is published and only when no package or active session
-- still depends on it.

alter table public.test_versions
  add column if not exists archived_at timestamptz;

update public.test_versions
set archived_at = coalesce(updated_at, created_at, now())
where status = 'archived'
  and archived_at is null;

alter table public.test_versions
  drop constraint if exists test_versions_published_at_consistency;
alter table public.test_versions
  add constraint test_versions_publication_archive_consistency
  check (
    (
      status = 'draft'
      and published_at is null
      and archived_at is null
    )
    or (
      status = 'published'
      and published_at is not null
      and archived_at is null
    )
    or (
      status = 'archived'
      and archived_at is not null
    )
  );

create or replace function public.protect_published_test_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_archive_version_id text;
  allowed_revert_version_id text;
begin
  if tg_op = 'DELETE' then
    if old.published_at is not null then
      raise exception 'Published test versions cannot be deleted';
    end if;

    return old;
  end if;

  if tg_op = 'UPDATE' and old.status = 'published' then
    allowed_archive_version_id := current_setting(
      'talora.archive_test_version_id',
      true
    );
    allowed_revert_version_id := current_setting(
      'talora.revert_system_test_version_id',
      true
    );

    if allowed_archive_version_id = old.id::text
      and new.status = 'archived'
      and new.published_at = old.published_at
      and new.archived_at is not null
      and (
        to_jsonb(new) - array['status', 'archived_at', 'updated_at']
        = to_jsonb(old) - array['status', 'archived_at', 'updated_at']
      )
    then
      return new;
    end if;

    if allowed_revert_version_id = old.id::text
      and new.status = 'draft'
      and new.published_at is null
      and new.archived_at is null
      and (
        to_jsonb(new) - array['status', 'published_at', 'updated_at']
        = to_jsonb(old) - array['status', 'published_at', 'updated_at']
      )
    then
      return new;
    end if;

    raise exception 'Published test versions cannot be edited';
  end if;

  if tg_op = 'UPDATE' and old.status = 'archived' then
    raise exception 'Archived test versions cannot be edited';
  end if;

  if new.status = 'published' then
    new.published_at = coalesce(new.published_at, now());
    new.archived_at = null;
  elsif new.status = 'draft' then
    new.published_at = null;
    new.archived_at = null;
  else
    new.archived_at = coalesce(new.archived_at, now());
  end if;

  return new;
end;
$$;

create or replace function public.protect_published_test_sections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    tg_op <> 'INSERT'
    and exists (
      select 1
      from public.test_versions version
      where version.id = old.test_version_id
        and version.published_at is not null
    )
  ) or (
    tg_op <> 'DELETE'
    and exists (
      select 1
      from public.test_versions version
      where version.id = new.test_version_id
        and version.published_at is not null
    )
  ) then
    raise exception 'Published test content cannot be edited';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.protect_published_questions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    tg_op <> 'INSERT'
    and exists (
      select 1
      from public.test_sections section
      join public.test_versions version on version.id = section.test_version_id
      where section.id = old.section_id
        and version.published_at is not null
    )
  ) or (
    tg_op <> 'DELETE'
    and exists (
      select 1
      from public.test_sections section
      join public.test_versions version on version.id = section.test_version_id
      where section.id = new.section_id
        and version.published_at is not null
    )
  ) then
    raise exception 'Published test content cannot be edited';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.protect_published_answer_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    tg_op <> 'INSERT'
    and exists (
      select 1
      from public.questions question
      join public.test_sections section on section.id = question.section_id
      join public.test_versions version on version.id = section.test_version_id
      where question.id = old.question_id
        and version.published_at is not null
    )
  ) or (
    tg_op <> 'DELETE'
    and exists (
      select 1
      from public.questions question
      join public.test_sections section on section.id = question.section_id
      join public.test_versions version on version.id = section.test_version_id
      where question.id = new.question_id
        and version.published_at is not null
    )
  ) then
    raise exception 'Published test content cannot be edited';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

alter table public.company_audit_logs
  drop constraint if exists company_audit_logs_action_check;
alter table public.company_audit_logs
  add constraint company_audit_logs_action_check
  check (
    action in (
      'invite_member',
      'grant_existing_member_access',
      'accept_member_invitation',
      'disable_member',
      'revoke_member_invitation',
      'update_member_role',
      'archive_test_version'
    )
  );

create or replace function public.archive_old_test_version(
  target_template_id uuid,
  target_version_id uuid,
  acting_user_id uuid,
  acting_platform_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_company_id uuid;
  selected_is_system boolean;
  selected_published_at timestamptz;
  selected_template_status text;
  selected_version_id uuid;
  selected_version_number integer;
  selected_version_status text;
begin
  select
    template.company_id,
    template.is_system,
    template.status,
    version.id,
    version.version_number,
    version.status,
    version.published_at
  into
    selected_company_id,
    selected_is_system,
    selected_template_status,
    selected_version_id,
    selected_version_number,
    selected_version_status,
    selected_published_at
  from public.test_versions version
  join public.test_templates template on template.id = version.test_template_id
  where version.id = target_version_id
    and version.test_template_id = target_template_id
  for update of version, template;

  if selected_version_id is null then
    raise exception 'TEST_VERSION_ARCHIVE_NOT_FOUND';
  end if;

  if selected_template_status <> 'active' then
    raise exception 'TEST_VERSION_ARCHIVE_TEMPLATE_INACTIVE';
  end if;

  if selected_is_system then
    if selected_company_id is not null
      or acting_platform_role not in ('platform_owner', 'platform_admin')
      or not exists (
        select 1
        from public.platform_users platform_user
        where platform_user.user_id = acting_user_id
          and platform_user.role = acting_platform_role
          and platform_user.status = 'active'
      )
    then
      raise exception 'TEST_VERSION_ARCHIVE_FORBIDDEN';
    end if;
  elsif selected_company_id is null
    or acting_user_id is distinct from auth.uid()
    or not exists (
      select 1
      from public.company_users membership
      where membership.company_id = selected_company_id
        and membership.user_id = acting_user_id
        and membership.status = 'active'
        and membership.role in ('owner', 'admin', 'recruiter', 'super_admin')
    )
  then
    raise exception 'TEST_VERSION_ARCHIVE_FORBIDDEN';
  end if;

  if selected_version_status <> 'published' then
    raise exception 'TEST_VERSION_ARCHIVE_NOT_PUBLISHED';
  end if;

  if not exists (
    select 1
    from public.test_versions newer_version
    where newer_version.test_template_id = target_template_id
      and newer_version.status = 'published'
      and newer_version.version_number > selected_version_number
  ) then
    raise exception 'TEST_VERSION_ARCHIVE_NOT_SUPERSEDED';
  end if;

  if exists (
    select 1
    from public.assessment_package_tests package_test
    where package_test.test_version_id = target_version_id
  ) then
    raise exception 'TEST_VERSION_ARCHIVE_PACKAGE_REFERENCES';
  end if;

  if exists (
    select 1
    from public.test_sessions session
    where session.test_version_id = target_version_id
      and session.status in ('not_started', 'in_progress')
  ) or exists (
    select 1
    from public.employee_assessment_sessions session
    where session.test_version_id = target_version_id
      and session.status in ('not_started', 'in_progress')
  ) then
    raise exception 'TEST_VERSION_ARCHIVE_ACTIVE_SESSIONS';
  end if;

  perform set_config(
    'talora.archive_test_version_id',
    target_version_id::text,
    true
  );

  update public.test_versions
  set
    archived_at = now(),
    status = 'archived'
  where id = target_version_id;

  if selected_is_system then
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
      acting_platform_role,
      'archive_old_system_test_version',
      'test_version',
      target_version_id,
      'Архивация устаревшей опубликованной версии',
      jsonb_build_object(
        'previousPublishedAt', selected_published_at,
        'previousStatus', selected_version_status,
        'testTemplateId', target_template_id,
        'versionNumber', selected_version_number
      )
    );
  else
    insert into public.company_audit_logs (
      company_id,
      actor_user_id,
      action,
      metadata_json
    )
    values (
      selected_company_id,
      acting_user_id,
      'archive_test_version',
      jsonb_build_object(
        'previousPublishedAt', selected_published_at,
        'testTemplateId', target_template_id,
        'testVersionId', target_version_id,
        'versionNumber', selected_version_number
      )
    );
  end if;

  return jsonb_build_object(
    'status', 'archived',
    'testTemplateId', target_template_id,
    'versionId', target_version_id,
    'versionNumber', selected_version_number
  );
end;
$$;

revoke all on function public.archive_old_test_version(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.archive_old_test_version(uuid, uuid, uuid, text)
  to authenticated, service_role;

-- Granted companies must retain read access to archived published system
-- versions so historical candidate and employee reports keep their test title
-- and immutable content.
drop policy if exists "members can read accessible test versions" on public.test_versions;
create policy "members can read accessible test versions"
on public.test_versions for select to authenticated
using (
  exists (
    select 1
    from public.test_templates template
    where template.id = test_versions.test_template_id
      and (
        (
          template.is_system = true
          and test_versions.published_at is not null
          and test_versions.status in ('published', 'archived')
          and public.current_user_can_access_system_test(template.id)
        )
        or (
          template.is_system = false
          and template.company_id is not null
          and public.is_company_member(template.company_id)
        )
      )
  )
);

drop policy if exists "members can read accessible test sections" on public.test_sections;
create policy "members can read accessible test sections"
on public.test_sections for select to authenticated
using (
  exists (
    select 1
    from public.test_versions version
    join public.test_templates template on template.id = version.test_template_id
    where version.id = test_sections.test_version_id
      and (
        (
          template.is_system = true
          and version.published_at is not null
          and version.status in ('published', 'archived')
          and public.current_user_can_access_system_test(template.id)
        )
        or (
          template.is_system = false
          and template.company_id is not null
          and public.is_company_member(template.company_id)
        )
      )
  )
);

drop policy if exists "members can read accessible questions" on public.questions;
create policy "members can read accessible questions"
on public.questions for select to authenticated
using (
  exists (
    select 1
    from public.test_sections section
    join public.test_versions version on version.id = section.test_version_id
    join public.test_templates template on template.id = version.test_template_id
    where section.id = questions.section_id
      and (
        (
          template.is_system = true
          and version.published_at is not null
          and version.status in ('published', 'archived')
          and public.current_user_can_access_system_test(template.id)
        )
        or (
          template.is_system = false
          and template.company_id is not null
          and public.is_company_member(template.company_id)
        )
      )
  )
);

drop policy if exists "members can read accessible answer options" on public.answer_options;
create policy "members can read accessible answer options"
on public.answer_options for select to authenticated
using (
  exists (
    select 1
    from public.questions question
    join public.test_sections section on section.id = question.section_id
    join public.test_versions version on version.id = section.test_version_id
    join public.test_templates template on template.id = version.test_template_id
    where question.id = answer_options.question_id
      and (
        (
          template.is_system = true
          and version.published_at is not null
          and version.status in ('published', 'archived')
          and public.current_user_can_access_system_test(template.id)
        )
        or (
          template.is_system = false
          and template.company_id is not null
          and public.is_company_member(template.company_id)
        )
      )
  )
);
