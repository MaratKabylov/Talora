-- Test builder: nested-content access, draft-only writes and starter system content.

alter table public.test_sections
  drop constraint if exists test_sections_order_nonnegative;
alter table public.test_sections
  add constraint test_sections_order_nonnegative
  check (order_index >= 0);

alter table public.test_sections
  drop constraint if exists test_sections_time_limit_positive;
alter table public.test_sections
  add constraint test_sections_time_limit_positive
  check (time_limit_minutes is null or time_limit_minutes > 0);

alter table public.questions
  drop constraint if exists questions_order_nonnegative;
alter table public.questions
  add constraint questions_order_nonnegative
  check (order_index >= 0);

alter table public.questions
  drop constraint if exists questions_competency_key_supported;
alter table public.questions
  add constraint questions_competency_key_supported
  check (
    competency_key is null
    or competency_key in (
      'learning_ability',
      'attention_to_detail',
      'logical_reasoning',
      'work_behavior',
      'communication',
      'responsibility',
      'motivation_income',
      'motivation_growth',
      'motivation_stability',
      'motivation_autonomy',
      'motivation_structure',
      'motivation_recognition'
    )
  );

alter table public.answer_options
  drop constraint if exists answer_options_order_nonnegative;
alter table public.answer_options
  add constraint answer_options_order_nonnegative
  check (order_index >= 0);

create or replace function public.has_supported_competency_effects(effects jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(effects) = 'object'
    and not exists (
      select 1
      from jsonb_object_keys(effects) as keys(effect_key)
      where keys.effect_key not in (
        'learning_ability',
        'attention_to_detail',
        'logical_reasoning',
        'work_behavior',
        'communication',
        'responsibility',
        'motivation_income',
        'motivation_growth',
        'motivation_stability',
        'motivation_autonomy',
        'motivation_structure',
        'motivation_recognition'
      )
    )
    and not exists (
      select 1
      from jsonb_each(effects) as effect
      where jsonb_typeof(effect.value) <> 'number'
    );
$$;

alter table public.answer_options
  drop constraint if exists answer_options_supported_competency_effects;
alter table public.answer_options
  add constraint answer_options_supported_competency_effects
  check (public.has_supported_competency_effects(competency_effect_json));

create policy "members can read accessible test sections"
on public.test_sections for select to authenticated
using (
  exists (
    select 1
    from public.test_versions version
    join public.test_templates template on template.id = version.test_template_id
    where version.id = test_sections.test_version_id
      and (
        template.is_system = true
        or (
          template.company_id is not null
          and public.is_company_member(template.company_id)
        )
      )
  )
);

create policy "recruiters can manage draft test sections"
on public.test_sections for all to authenticated
using (
  exists (
    select 1
    from public.test_versions version
    join public.test_templates template on template.id = version.test_template_id
    where version.id = test_sections.test_version_id
      and version.status = 'draft'
      and template.status = 'active'
      and template.is_system = false
      and template.company_id is not null
      and public.can_manage_company_resources(template.company_id)
  )
)
with check (
  exists (
    select 1
    from public.test_versions version
    join public.test_templates template on template.id = version.test_template_id
    where version.id = test_sections.test_version_id
      and version.status = 'draft'
      and template.status = 'active'
      and template.is_system = false
      and template.company_id is not null
      and public.can_manage_company_resources(template.company_id)
  )
);

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
        template.is_system = true
        or (
          template.company_id is not null
          and public.is_company_member(template.company_id)
        )
      )
  )
);

create policy "recruiters can manage draft questions"
on public.questions for all to authenticated
using (
  exists (
    select 1
    from public.test_sections section
    join public.test_versions version on version.id = section.test_version_id
    join public.test_templates template on template.id = version.test_template_id
    where section.id = questions.section_id
      and version.status = 'draft'
      and template.status = 'active'
      and template.is_system = false
      and template.company_id is not null
      and public.can_manage_company_resources(template.company_id)
  )
)
with check (
  exists (
    select 1
    from public.test_sections section
    join public.test_versions version on version.id = section.test_version_id
    join public.test_templates template on template.id = version.test_template_id
    where section.id = questions.section_id
      and version.status = 'draft'
      and template.status = 'active'
      and template.is_system = false
      and template.company_id is not null
      and public.can_manage_company_resources(template.company_id)
  )
);

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
        template.is_system = true
        or (
          template.company_id is not null
          and public.is_company_member(template.company_id)
        )
      )
  )
);

create policy "recruiters can manage draft answer options"
on public.answer_options for all to authenticated
using (
  exists (
    select 1
    from public.questions question
    join public.test_sections section on section.id = question.section_id
    join public.test_versions version on version.id = section.test_version_id
    join public.test_templates template on template.id = version.test_template_id
    where question.id = answer_options.question_id
      and version.status = 'draft'
      and template.status = 'active'
      and template.is_system = false
      and template.company_id is not null
      and public.can_manage_company_resources(template.company_id)
  )
)
with check (
  exists (
    select 1
    from public.questions question
    join public.test_sections section on section.id = question.section_id
    join public.test_versions version on version.id = section.test_version_id
    join public.test_templates template on template.id = version.test_template_id
    where question.id = answer_options.question_id
      and version.status = 'draft'
      and template.status = 'active'
      and template.is_system = false
      and template.company_id is not null
      and public.can_manage_company_resources(template.company_id)
  )
);

-- System content is installed centrally; application users cannot change it after publication.
alter table public.test_sections disable trigger protect_published_test_sections;
alter table public.questions disable trigger protect_published_questions;
alter table public.answer_options disable trigger protect_published_answer_options;

insert into public.test_sections (
  id,
  test_version_id,
  title,
  description,
  order_index
)
values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000201', 'Обучаемость', null, 1),
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000201', 'Внимательность', null, 2),
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000201', 'Логика', null, 3),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000201', 'Рабочее поведение', null, 4),
  ('00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000201', 'Коммуникация', null, 5),
  (
    '00000000-0000-4000-8000-000000000411',
    '00000000-0000-4000-8000-000000000202',
    'Применение инструкции',
    'Прочитайте правило и выберите подходящую категорию.',
    1
  ),
  (
    '00000000-0000-4000-8000-000000000421',
    '00000000-0000-4000-8000-000000000203',
    'Сверка данных',
    'Найдите расхождения в рабочей информации.',
    1
  ),
  (
    '00000000-0000-4000-8000-000000000431',
    '00000000-0000-4000-8000-000000000204',
    'Рабочие ситуации',
    'Выберите действие, наиболее подходящее ситуации.',
    1
  ),
  (
    '00000000-0000-4000-8000-000000000441',
    '00000000-0000-4000-8000-000000000205',
    'Мотиваторы',
    'Оцените, насколько утверждение важно для вас.',
    1
  )
on conflict (id) do nothing;

insert into public.questions (
  id,
  section_id,
  question_type,
  text,
  order_index,
  points,
  competency_key,
  settings_json
)
values
  (
    '00000000-0000-4000-8000-000000000501',
    '00000000-0000-4000-8000-000000000411',
    'single_choice',
    'Клиент пишет: «Я оплатил вчера, но сегодня никто не приехал. Что происходит?»',
    1,
    1,
    'learning_ability',
    '{}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000502',
    '00000000-0000-4000-8000-000000000411',
    'single_choice',
    'Клиент пишет: «Сколько стоит установка?»',
    2,
    1,
    'learning_ability',
    '{}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000511',
    '00000000-0000-4000-8000-000000000421',
    'single_choice',
    'В заявке телефон: +7 701 245 18 90. В CRM телефон: +7 701 245 18 09. Есть ли ошибка?',
    1,
    1,
    'attention_to_detail',
    '{}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000521',
    '00000000-0000-4000-8000-000000000431',
    'single_choice',
    'Руководитель дал задачу, но вы не до конца поняли, что нужно сделать. Ваши действия?',
    1,
    1,
    'work_behavior',
    '{}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000531',
    '00000000-0000-4000-8000-000000000441',
    'scale',
    'Мне важно быстро расти в доходе',
    1,
    0,
    'motivation_income',
    '{"min": 1, "max": 5}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000532',
    '00000000-0000-4000-8000-000000000441',
    'scale',
    'Мне комфортнее работать по понятной инструкции',
    2,
    0,
    'motivation_structure',
    '{"min": 1, "max": 5}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000533',
    '00000000-0000-4000-8000-000000000441',
    'scale',
    'Мне важно иметь стабильный график и правила',
    3,
    0,
    'motivation_stability',
    '{"min": 1, "max": 5}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000534',
    '00000000-0000-4000-8000-000000000441',
    'scale',
    'Мне нравится общаться с новыми людьми',
    4,
    0,
    'communication',
    '{"min": 1, "max": 5}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000535',
    '00000000-0000-4000-8000-000000000441',
    'scale',
    'Мне важно иметь свободу в способах выполнения задачи',
    5,
    0,
    'motivation_autonomy',
    '{"min": 1, "max": 5}'::jsonb
  )
on conflict (id) do nothing;

insert into public.answer_options (
  id,
  question_id,
  text,
  order_index,
  is_correct,
  points,
  competency_effect_json
)
values
  ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000501', 'A — срочно', 1, false, 0, '{}'::jsonb),
  ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000501', 'B — консультация', 2, false, 0, '{}'::jsonb),
  (
    '00000000-0000-4000-8000-000000000603',
    '00000000-0000-4000-8000-000000000501',
    'C — жалоба',
    3,
    true,
    1,
    '{"learning_ability": 2}'::jsonb
  ),
  ('00000000-0000-4000-8000-000000000604', '00000000-0000-4000-8000-000000000501', 'D — нецелевое', 4, false, 0, '{}'::jsonb),
  ('00000000-0000-4000-8000-000000000611', '00000000-0000-4000-8000-000000000502', 'A — срочно', 1, false, 0, '{}'::jsonb),
  (
    '00000000-0000-4000-8000-000000000612',
    '00000000-0000-4000-8000-000000000502',
    'B — консультация',
    2,
    true,
    1,
    '{"learning_ability": 1}'::jsonb
  ),
  ('00000000-0000-4000-8000-000000000613', '00000000-0000-4000-8000-000000000502', 'C — жалоба', 3, false, 0, '{}'::jsonb),
  ('00000000-0000-4000-8000-000000000614', '00000000-0000-4000-8000-000000000502', 'D — нецелевое', 4, false, 0, '{}'::jsonb),
  ('00000000-0000-4000-8000-000000000621', '00000000-0000-4000-8000-000000000511', 'Ошибки нет', 1, false, 0, '{}'::jsonb),
  (
    '00000000-0000-4000-8000-000000000622',
    '00000000-0000-4000-8000-000000000511',
    'Да, перепутаны последние цифры',
    2,
    true,
    1,
    '{"attention_to_detail": 2}'::jsonb
  ),
  ('00000000-0000-4000-8000-000000000623', '00000000-0000-4000-8000-000000000511', 'Да, ошибка в коде оператора', 3, false, 0, '{}'::jsonb),
  ('00000000-0000-4000-8000-000000000624', '00000000-0000-4000-8000-000000000511', 'Недостаточно данных', 4, false, 0, '{}'::jsonb),
  (
    '00000000-0000-4000-8000-000000000631',
    '00000000-0000-4000-8000-000000000521',
    'Начну делать как понял, потом покажу',
    1,
    false,
    0.3,
    '{"work_behavior": 0.5}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000632',
    '00000000-0000-4000-8000-000000000521',
    'Уточню цель, срок, формат результата и критерии успеха',
    2,
    true,
    1,
    '{"work_behavior": 2, "responsibility": 1}'::jsonb
  ),
  ('00000000-0000-4000-8000-000000000633', '00000000-0000-4000-8000-000000000521', 'Подожду, пока руководитель сам объяснит подробнее', 3, false, 0, '{}'::jsonb),
  ('00000000-0000-4000-8000-000000000634', '00000000-0000-4000-8000-000000000521', 'Передам задачу коллеге', 4, false, 0, '{}'::jsonb)
on conflict (id) do nothing;

alter table public.test_sections enable trigger protect_published_test_sections;
alter table public.questions enable trigger protect_published_questions;
alter table public.answer_options enable trigger protect_published_answer_options;
