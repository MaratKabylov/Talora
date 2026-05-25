-- Tests library: tenant-scoped templates, version publishing and immutable published content.

drop policy if exists "members can read test templates" on public.test_templates;
create policy "members can read accessible test templates"
on public.test_templates for select to authenticated
using (
  is_system = true
  or (company_id is not null and public.is_company_member(company_id))
);

drop policy if exists "members can manage own test templates" on public.test_templates;
create policy "recruiters can manage own test templates"
on public.test_templates for all to authenticated
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

drop policy if exists "members can read packages" on public.assessment_packages;
create policy "members can read accessible packages"
on public.assessment_packages for select to authenticated
using (
  is_system = true
  or (company_id is not null and public.is_company_member(company_id))
);

create policy "members can read accessible test versions"
on public.test_versions for select to authenticated
using (
  exists (
    select 1
    from public.test_templates template
    where template.id = test_versions.test_template_id
      and (
        template.is_system = true
        or (
          template.company_id is not null
          and public.is_company_member(template.company_id)
        )
      )
  )
);

create policy "recruiters can manage own test versions"
on public.test_versions for all to authenticated
using (
  exists (
    select 1
    from public.test_templates template
    where template.id = test_versions.test_template_id
      and template.is_system = false
      and template.company_id is not null
      and public.can_manage_company_resources(template.company_id)
  )
)
with check (
  exists (
    select 1
    from public.test_templates template
    where template.id = test_versions.test_template_id
      and template.is_system = false
      and template.company_id is not null
      and public.can_manage_company_resources(template.company_id)
  )
);

alter table public.test_versions
  drop constraint if exists test_versions_duration_positive;
alter table public.test_versions
  add constraint test_versions_duration_positive
  check (duration_minutes is null or duration_minutes > 0);

alter table public.test_versions
  drop constraint if exists test_versions_published_at_consistency;
alter table public.test_versions
  add constraint test_versions_published_at_consistency
  check (
    (status = 'published' and published_at is not null)
    or (status <> 'published' and published_at is null)
  );

create or replace function public.protect_published_test_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'published' then
      raise exception 'Published test versions cannot be deleted';
    end if;

    return old;
  end if;

  if tg_op = 'UPDATE' and old.status = 'published' then
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

drop trigger if exists protect_published_test_version on public.test_versions;
create trigger protect_published_test_version
before insert or update or delete on public.test_versions
for each row execute function public.protect_published_test_version();

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
        and version.status = 'published'
    )
  ) or (
    tg_op <> 'DELETE'
    and exists (
      select 1
      from public.test_versions version
      where version.id = new.test_version_id
        and version.status = 'published'
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

drop trigger if exists protect_published_test_sections on public.test_sections;
create trigger protect_published_test_sections
before insert or update or delete on public.test_sections
for each row execute function public.protect_published_test_sections();

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
        and version.status = 'published'
    )
  ) or (
    tg_op <> 'DELETE'
    and exists (
      select 1
      from public.test_sections section
      join public.test_versions version on version.id = section.test_version_id
      where section.id = new.section_id
        and version.status = 'published'
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

drop trigger if exists protect_published_questions on public.questions;
create trigger protect_published_questions
before insert or update or delete on public.questions
for each row execute function public.protect_published_questions();

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
        and version.status = 'published'
    )
  ) or (
    tg_op <> 'DELETE'
    and exists (
      select 1
      from public.questions question
      join public.test_sections section on section.id = question.section_id
      join public.test_versions version on version.id = section.test_version_id
      where question.id = new.question_id
        and version.status = 'published'
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

drop trigger if exists protect_published_answer_options on public.answer_options;
create trigger protect_published_answer_options
before insert or update or delete on public.answer_options
for each row execute function public.protect_published_answer_options();

insert into public.test_templates (
  id,
  company_id,
  title,
  description,
  category,
  is_system,
  status
)
values
  (
    '00000000-0000-4000-8000-000000000101',
    null,
    'Универсальная карта потенциала',
    'Базовая оценка обучаемости, внимательности, логики, рабочего поведения и коммуникации.',
    'general_potential',
    true,
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000000102',
    null,
    'Обучаемость',
    'Кандидат читает новую инструкцию и применяет ее к рабочим ситуациям.',
    'learning_ability',
    true,
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000000103',
    null,
    'Внимательность',
    'Проверка аккуратности при сравнении данных, номеров, сумм и заявок.',
    'attention_to_detail',
    true,
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000000104',
    null,
    'Рабочее поведение',
    'Ситуационные кейсы про ответственность, самостоятельность, ошибки, дедлайны и конфликты.',
    'work_behavior',
    true,
    'active'
  ),
  (
    '00000000-0000-4000-8000-000000000105',
    null,
    'Мотивационный профиль',
    'Профиль мотивации без правильных и неправильных ответов.',
    'motivation',
    true,
    'active'
  )
on conflict (id) do nothing;

insert into public.test_versions (
  id,
  test_template_id,
  version_number,
  title,
  description,
  duration_minutes,
  scoring_type,
  status,
  published_at
)
values
  (
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000101',
    1,
    'Универсальная карта потенциала',
    'Базовая оценка общего трудового потенциала.',
    30,
    'mixed',
    'published',
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000202',
    '00000000-0000-4000-8000-000000000102',
    1,
    'Обучаемость',
    'Оценка освоения и применения новых правил.',
    12,
    'points',
    'published',
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000203',
    '00000000-0000-4000-8000-000000000103',
    1,
    'Внимательность',
    'Оценка аккуратности при работе с данными.',
    10,
    'points',
    'published',
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000204',
    '00000000-0000-4000-8000-000000000104',
    1,
    'Рабочее поведение',
    'Оценка решений в типичных рабочих ситуациях.',
    12,
    'points',
    'published',
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000205',
    '00000000-0000-4000-8000-000000000105',
    1,
    'Мотивационный профиль',
    'Профиль мотиваторов без правильных и неправильных ответов.',
    8,
    'competency_profile',
    'published',
    now()
  )
on conflict (id) do nothing;

insert into public.assessment_packages (
  id,
  company_id,
  title,
  description,
  is_system
)
values (
  '00000000-0000-4000-8000-000000000301',
  null,
  'Стартовая позиция / общий потенциал',
  'Пакет для кандидатов без выраженной профессии.',
  true
)
on conflict (id) do nothing;

insert into public.assessment_package_tests (
  package_id,
  test_version_id,
  order_index,
  weight,
  is_required
)
values
  (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000202',
    1,
    0.3000,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000203',
    2,
    0.2000,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000204',
    3,
    0.2500,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000205',
    4,
    0.0500,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000201',
    5,
    0.2000,
    true
  )
on conflict (package_id, test_version_id) do nothing;
