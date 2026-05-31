-- Company-level test access controls.
-- By default, companies cannot see platform tests and cannot create custom tests.

create table if not exists public.company_test_permissions (
  company_id uuid primary key references public.companies(id) on delete cascade,
  can_create_custom_tests boolean not null default false,
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_system_test_access (
  company_id uuid not null references public.companies(id) on delete cascade,
  test_template_id uuid not null references public.test_templates(id) on delete cascade,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  primary key (company_id, test_template_id)
);

create index if not exists idx_company_system_test_access_template
  on public.company_system_test_access(test_template_id);

drop trigger if exists set_company_test_permissions_updated_at on public.company_test_permissions;
create trigger set_company_test_permissions_updated_at before update on public.company_test_permissions
for each row execute function public.set_updated_at();

alter table public.company_test_permissions enable row level security;
alter table public.company_system_test_access enable row level security;

drop policy if exists "members can read company test permissions" on public.company_test_permissions;
create policy "members can read company test permissions"
on public.company_test_permissions for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists "members can read company system test access" on public.company_system_test_access;
create policy "members can read company system test access"
on public.company_system_test_access for select to authenticated
using (public.is_company_member(company_id));

create or replace function public.validate_company_system_test_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.test_templates template
    where template.id = new.test_template_id
      and template.is_system = true
      and template.company_id is null
  ) then
    raise exception 'System test access can only be granted for platform-owned system tests';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_company_system_test_access on public.company_system_test_access;
create trigger validate_company_system_test_access
before insert or update of test_template_id on public.company_system_test_access
for each row execute function public.validate_company_system_test_access();

create or replace function public.company_can_create_custom_tests(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select permissions.can_create_custom_tests
      from public.company_test_permissions permissions
      where permissions.company_id = target_company_id
    ),
    false
  );
$$;

create or replace function public.company_can_access_system_test(
  target_company_id uuid,
  target_template_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_system_test_access access
    join public.test_templates template on template.id = access.test_template_id
    where access.company_id = target_company_id
      and access.test_template_id = target_template_id
      and template.is_system = true
      and template.company_id is null
      and template.status = 'active'
      and public.has_published_system_test_version(template.id)
  );
$$;

create or replace function public.current_user_can_access_system_test(target_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_users membership
    where membership.user_id = auth.uid()
      and membership.status = 'active'
      and public.company_can_access_system_test(membership.company_id, target_template_id)
  );
$$;

create or replace function public.company_can_access_system_package(
  target_company_id uuid,
  target_package_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assessment_packages package
    where package.id = target_package_id
      and package.is_system = true
      and package.company_id is null
      and exists (
        select 1
        from public.assessment_package_tests package_test
        where package_test.package_id = package.id
      )
      and not exists (
        select 1
        from public.assessment_package_tests package_test
        join public.test_versions version on version.id = package_test.test_version_id
        join public.test_templates template on template.id = version.test_template_id
        where package_test.package_id = package.id
          and (
            version.status <> 'published'
            or template.is_system is distinct from true
            or template.company_id is not null
            or not public.company_can_access_system_test(target_company_id, template.id)
          )
      )
  );
$$;

create or replace function public.current_user_can_access_system_package(target_package_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_users membership
    where membership.user_id = auth.uid()
      and membership.status = 'active'
      and public.company_can_access_system_package(membership.company_id, target_package_id)
  );
$$;

create or replace function public.get_accessible_system_package_ids(target_company_id uuid)
returns table (package_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select package.id
  from public.assessment_packages package
  where exists (
      select 1
      from public.company_users membership
      where membership.company_id = target_company_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
    )
    and public.company_can_access_system_package(target_company_id, package.id)
  order by package.title;
$$;

revoke all on function public.validate_company_system_test_access() from public, anon, authenticated;
revoke all on function public.company_can_create_custom_tests(uuid) from public, anon;
revoke all on function public.company_can_access_system_test(uuid, uuid) from public, anon;
revoke all on function public.current_user_can_access_system_test(uuid) from public, anon;
revoke all on function public.company_can_access_system_package(uuid, uuid) from public, anon;
revoke all on function public.current_user_can_access_system_package(uuid) from public, anon;
revoke all on function public.get_accessible_system_package_ids(uuid) from public, anon;

grant execute on function public.company_can_create_custom_tests(uuid) to authenticated;
grant execute on function public.company_can_access_system_test(uuid, uuid) to authenticated;
grant execute on function public.current_user_can_access_system_test(uuid) to authenticated;
grant execute on function public.company_can_access_system_package(uuid, uuid) to authenticated;
grant execute on function public.current_user_can_access_system_package(uuid) to authenticated;
grant execute on function public.get_accessible_system_package_ids(uuid) to authenticated;

drop policy if exists "members can read accessible packages" on public.assessment_packages;
drop policy if exists "members can read packages" on public.assessment_packages;
create policy "members can read accessible packages"
on public.assessment_packages for select to authenticated
using (
  (
    is_system = true
    and public.current_user_can_access_system_package(id)
  )
  or (
    is_system = false
    and company_id is not null
    and public.is_company_member(company_id)
  )
);

drop policy if exists "members can read accessible test templates" on public.test_templates;
drop policy if exists "members can read test templates" on public.test_templates;
create policy "members can read accessible test templates"
on public.test_templates for select to authenticated
using (
  (
    is_system = true
    and status = 'active'
    and public.current_user_can_access_system_test(id)
  )
  or (
    is_system = false
    and company_id is not null
    and public.is_company_member(company_id)
  )
);

drop policy if exists "recruiters can manage own test templates" on public.test_templates;
drop policy if exists "members can manage own test templates" on public.test_templates;
drop policy if exists "recruiters can insert own test templates" on public.test_templates;
drop policy if exists "recruiters can update own test templates" on public.test_templates;
drop policy if exists "recruiters can delete own test templates" on public.test_templates;

create policy "recruiters can insert own test templates"
on public.test_templates for insert to authenticated
with check (
  is_system = false
  and company_id is not null
  and public.can_manage_company_resources(company_id)
  and public.company_can_create_custom_tests(company_id)
);

create policy "recruiters can update own test templates"
on public.test_templates for update to authenticated
using (
  is_system = false
  and company_id is not null
  and public.can_manage_company_resources(company_id)
)
with check (
  is_system = false
  and company_id is not null
  and public.can_manage_company_resources(company_id)
);

create policy "recruiters can delete own test templates"
on public.test_templates for delete to authenticated
using (
  is_system = false
  and company_id is not null
  and public.can_manage_company_resources(company_id)
);

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
          and test_versions.status = 'published'
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
          and version.status = 'published'
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
          and version.status = 'published'
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
          and version.status = 'published'
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

create or replace function public.validate_job_assessment_package_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assessment_package_id is not null
     and not exists (
       select 1
       from public.assessment_packages package
       where package.id = new.assessment_package_id
         and (
           (
             package.is_system = false
             and package.company_id = new.company_id
           )
           or (
             package.is_system = true
             and public.company_can_access_system_package(new.company_id, package.id)
           )
         )
     ) then
    raise exception 'Assessment package is not available to the job company';
  end if;

  return new;
end;
$$;

create or replace function public.invite_candidate_to_job(
  target_company_id uuid,
  target_job_id uuid,
  candidate_full_name text,
  candidate_email text,
  candidate_phone text default null,
  candidate_city text default null,
  candidate_source text default null,
  invitation_expires_at timestamptz default null
)
returns table (
  created_candidate_id uuid,
  created_application_id uuid,
  created_invitation_id uuid,
  invitation_token text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(candidate_email));
  selected_candidate_id uuid;
  selected_application_id uuid;
  selected_application_status text;
  generated_token text;
  effective_expires_at timestamptz := coalesce(invitation_expires_at, now() + interval '7 days');
begin
  if not public.can_manage_company_resources(target_company_id) then
    raise exception 'User cannot invite candidates for this company';
  end if;

  if btrim(coalesce(candidate_full_name, '')) = '' or normalized_email = '' then
    raise exception 'Candidate name and email are required';
  end if;

  if effective_expires_at <= now() then
    raise exception 'Invitation expiration must be in the future';
  end if;

  if not exists (
    select 1
    from public.jobs job
    join public.assessment_packages package on package.id = job.assessment_package_id
    where job.id = target_job_id
      and job.company_id = target_company_id
      and job.assessment_package_id is not null
      and job.status not in ('closed', 'archived')
      and (
        (
          package.is_system = false
          and package.company_id = target_company_id
        )
        or (
          package.is_system = true
          and public.company_can_access_system_package(target_company_id, package.id)
        )
      )
  ) then
    raise exception 'Job is unavailable for invitations or has no assessment package';
  end if;

  select c.id
  into selected_candidate_id
  from public.candidates c
  where c.company_id = target_company_id
    and lower(c.email) = normalized_email
  limit 1
  for update;

  if selected_candidate_id is null then
    insert into public.candidates (
      company_id,
      full_name,
      email,
      phone,
      city,
      source
    )
    values (
      target_company_id,
      btrim(candidate_full_name),
      normalized_email,
      nullif(btrim(candidate_phone), ''),
      nullif(btrim(candidate_city), ''),
      nullif(btrim(candidate_source), '')
    )
    returning id into selected_candidate_id;
  else
    update public.candidates
    set
      full_name = btrim(candidate_full_name),
      phone = coalesce(nullif(btrim(candidate_phone), ''), phone),
      city = coalesce(nullif(btrim(candidate_city), ''), city),
      source = coalesce(nullif(btrim(candidate_source), ''), source)
    where id = selected_candidate_id;
  end if;

  select application.id, application.status
  into selected_application_id, selected_application_status
  from public.candidate_applications application
  where application.job_id = target_job_id
    and application.candidate_id = selected_candidate_id
  for update;

  if selected_application_id is null then
    insert into public.candidate_applications (
      company_id,
      job_id,
      candidate_id,
      status,
      current_stage
    )
    values (
      target_company_id,
      target_job_id,
      selected_candidate_id,
      'invited',
      'invitation'
    )
    returning id into selected_application_id;
  elsif selected_application_status in ('completed', 'hired', 'rejected', 'withdrawn') then
    raise exception 'This application cannot receive a new invitation';
  end if;

  if exists (
    select 1
    from public.invitations invitation
    where invitation.application_id = selected_application_id
      and invitation.status in ('started', 'completed')
  ) then
    raise exception 'Candidate has already started the assessment';
  end if;

  update public.invitations
  set status = 'cancelled'
  where application_id = selected_application_id
    and status in ('created', 'sent', 'opened');

  generated_token := encode(gen_random_bytes(32), 'hex');

  insert into public.invitations (
    company_id,
    job_id,
    candidate_id,
    application_id,
    token,
    status,
    expires_at,
    sent_at
  )
  values (
    target_company_id,
    target_job_id,
    selected_candidate_id,
    selected_application_id,
    generated_token,
    'sent',
    effective_expires_at,
    now()
  )
  returning id into created_invitation_id;

  created_candidate_id := selected_candidate_id;
  created_application_id := selected_application_id;
  invitation_token := generated_token;
  return next;
end;
$$;

revoke all on function public.invite_candidate_to_job(uuid, uuid, text, text, text, text, text, timestamptz)
  from public, anon;
grant execute on function public.invite_candidate_to_job(uuid, uuid, text, text, text, text, text, timestamptz)
  to authenticated;
