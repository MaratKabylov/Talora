# RLS and Security Notes

## Главная логика

HR-пользователи должны видеть только данные своей компании.

Кандидаты проходят тесты по invitation token. Для candidate flow лучше использовать server actions / route handlers:

- validate token;
- проверить срок действия;
- получить application;
- получить список test sessions;
- сохранить ответы.

Не открывать прямой anon-доступ ко всем таблицам.

## Server secret

Для нового server-side кода предпочитайте `SUPABASE_SECRET_KEY` (`sb_secret_...`).
Legacy `SUPABASE_SERVICE_ROLE_KEY` также можно использовать только на сервере, например для:

- генерации системных seed-тестов;
- защищенного scoring;
- обработки candidate token flow.

Никогда не передавать secret/service role key в browser.

## Published tests

Опубликованные версии тестов нельзя редактировать. Это можно enforced на уровне приложения, а позже добавить trigger:

- если `test_versions.status = 'published'`, запретить update связанных sections/questions/options.

Для системных тестов разрешена только узкая отмена ошибочной публикации `published → draft`:

- только для последней версии активного системного теста;
- только для `platform_owner` и `platform_admin`;
- только при отсутствии другого черновика;
- только при отсутствии ссылок из пакетов, кандидатских и employee assessment сессий и результатов;
- через server-only RPC, которая блокирует версию, повторно проверяет зависимости и пишет audit event в одной транзакции.

Создание пакетов и assessment-сессий должно брать `FOR KEY SHARE` lock на версию перед проверкой статуса, чтобы исключить гонку с отменой публикации. Любая уже использованная опубликованная версия остается неизменяемой; для нее создается новая версия-черновик.

## Atomic version clone (PERF-009)

`clone_published_test_version` вызывается только сервером с `service_role`; EXECUTE для
`public/anon/authenticated` отозван. Функция `SECURITY INVOKER`, `search_path=''`.
Actions передают actor/company из проверенного серверного контекста, RPC повторно
проверяет tenant, активность компании/членства, роль и ownership шаблона/версии.
Для company scope разрешены `owner/admin/recruiter/super_admin`, для system — только
`platform_owner/platform_admin`. Как и действующая RLS вставки версий, клонирование
существующего теста не требует entitlement создания нового test template.

Шаблон и опубликованный источник блокируются на время копирования. Полный draft,
переназначение внутренних ID и system audit создаются одной транзакцией. Временная
таблица mapping не переиспользует объекты вызывающего кода. Ответ не содержит
содержимое/ключи ответов; автоматического N+1 fallback нет. Новая версия сохраняет
совместимость с действующими publication/revision guards.
Проверки, ограничения и порядок выпуска: [rollout PERF-009](29_ATOMIC_TEST_VERSION_CLONE_ROLLOUT.md).

## List read models (PERF-010)

`test_template_list`, `assessment_package_list`, `employee_assessment_list`,
`job_comparison_summary`, `employee_comparison_filters` — SELECT-only views с
`security_invoker=true`. Агрегаты и latest-version lateral joins соблюдают RLS
вызывающего на исходных таблицах. Не заменять их обычными owner-executed views.
Доступ: authenticated/service_role SELECT, без anon/public и без DML grants.
Dashboard использует session client и явные tenant/parent/grant filters;
admin system lists — service client после `requirePlatformContext` с system scope.
Cursor comparison не даёт доступа: независимо проверяются tenant/parent и RLS.
Последнее invitation выбирается через order/limit внутри PostgREST embedding;
ограничение действует отдельно для каждого родителя. Token не логируется.
Миграция и реальная RLS-приёмка: [rollout PERF-010](30_DASHBOARD_LIST_READ_MODELS_ROLLOUT.md).

## Sensitive data

Не использовать для скоринга:

- возраст;
- пол;
- национальность;
- религию;
- здоровье;
- семейное положение;
- политические взгляды;
- любые другие чувствительные признаки.

## Candidate consent

На стартовой странице кандидата обязательно:

- кто собирает данные;
- для какой вакансии;
- что результаты используются для предварительной оценки;
- согласие на обработку персональных данных.
