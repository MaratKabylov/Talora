-- System test authoring: company users may only consume published platform content.
-- Platform admin pages use the server-only service client after application role checks.

create or replace function public.has_published_system_test_version(target_template_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.test_versions version
    join public.test_templates template on template.id = version.test_template_id
    where version.test_template_id = target_template_id
      and template.is_system = true
      and template.company_id is null
      and version.status = 'published'
  );
$$;

revoke all on function public.has_published_system_test_version(uuid) from public, anon;
grant execute on function public.has_published_system_test_version(uuid) to authenticated;

drop policy if exists "members can read accessible test templates" on public.test_templates;
create policy "members can read accessible test templates"
on public.test_templates for select to authenticated
using (
  (
    is_system = true
    and status = 'active'
    and public.has_published_system_test_version(id)
  )
  or (
    is_system = false
    and company_id is not null
    and public.is_company_member(company_id)
  )
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
        (template.is_system = true and test_versions.status = 'published')
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
        (template.is_system = true and version.status = 'published')
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
        (template.is_system = true and version.status = 'published')
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
        (template.is_system = true and version.status = 'published')
        or (
          template.is_system = false
          and template.company_id is not null
          and public.is_company_member(template.company_id)
        )
      )
  )
);
