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

## Cursor lists (PERF-011)

`list_company_test_templates(uuid)` и `list_company_assessment_packages(uuid)` —
STABLE SECURITY INVOKER SQL-функции с пустым search_path и EXECUTE только для
authenticated. Они читают PERF-010 invoker views, проверяют членство в переданной
компании и её ownership/system grants. System grant другого tenant не заменяет
grant выбранной компании. Dashboard передаёт company из серверного контекста;
прочие списки имеют явные company/parent filters независимо от cursor.
Admin сохраняет platform role gate перед service client и ограничения PII;
межкомпанейский обзор разрешён platform-контекстом, выбранный company фильтруется SQL.
Cursor не является секретом или разрешением: валидируются timestamp/UUID, размер
и scope route/company/parent/filters/sort/pageSize. Неподходящий cursor сбрасывается.
Новые функции не предоставляют anon/service_role EXECUTE и не меняют исходные RLS.
Проверки и выпуск: [rollout PERF-011](31_DASHBOARD_CURSOR_PAGINATION_ROLLOUT.md).

## Materialized employee dimensions (PERF-014)

`employee_assessment_dimension_scores` доступна authenticated-пользователю только на SELECT и только при
`is_company_member(company_id)`; anon и browser DML закрыты. `company_id`, assessment и participant выводятся
из заблокированной строки participant внутри security-definer writer, а session/test version дополнительно
проверяются на принадлежность этому participant. Normal scoring и recalculation заменяют dimension rows внутри
того же вызова `try_persist_scoring_snapshot`, поэтому ошибка вставки откатывает весь scoring snapshot.
Прямой EXECUTE внутреннего `persist_scoring_snapshot` и dimension writer отозван у `service_role`; наружу оставлены
только атомарный wrapper и идемпотентный backfill текущей revision. Подробности: [rollout PERF-014](34_PERF014_EMPLOYEE_DIMENSIONS_ROLLOUT.md).

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
