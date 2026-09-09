# Текущее состояние Talvia

Обновлено: 2026-09-09. Снимок для продолжения работы, не доказательство состояния удалённой БД.

## Текущая задача и следующий шаг

- **PERF-010: код основных лёгких списков и comparison pagination готов, локально проверен.** Полная приёмка открыта: staging/PostgREST, замеры и отказ от scoring JSON в employee comparison (зависимость PERF-014).
- Jobs используют отдельный list DTO; список кандидатов вакансии/импорт — краткий job context. Candidate и employee invitations ограничены последней строкой внутри PostgREST embedding.
- Tests/packages используют summary views с counts и latest versions; employee assessment list получает SQL counts/average без массива participants. Company/admin detail DTO сохранены отдельно.
- Оба comparison route фильтруют и сортируют в БД, читают страницы по 50 строк с keyset `(fit_score, id)`. Сводные карточки остаются общими по parent, employee department/role options агрегируются в SQL.
- Следующий шаг выпуска — разрешённое применение миграции на staging до deploy кода и приёмка по [rollout PERF-010](30_DASHBOARD_LIST_READ_MODELS_ROLLOUT.md). Следующая кодовая задача — **PERF-011**, pagination остальных списков.

## Изменённые области и проверки PERF-010

- `lib/lists/read-models.ts`, data loaders jobs/candidates/tests/packages/employee-assessments/comparison/admin; соответствующие dashboard/admin pages и `SystemTestGroups`.
- Миграция: `supabase/migrations/20260909140000_dashboard_list_read_models.sql`. Пять SELECT-only views с `security_invoker=true`; исходные table grants/RLS сохраняются. Новых env/флагов/индексов нет.
- Проверка после применения: `supabase/verification/dashboard_list_read_models.sql` — 19 read-only checks. Локально все `passed=true`; удалённо не запускалась.
- `tests/list-read-models-db.test.ts`: реальный SQL/production DDL/выбранные SELECT policies в PGlite; auth/membership/system access helpers — локальные stand-ins. `tests/list-read-models.test.ts`: реальный Supabase query builder с mock HTTP.
- Проверены DTO/select contracts, tenant/system visibility, counts/average/null/empty, anon/привилегии, embedded invitation order/limit, compare filters и bounded child reads, SQL keyset с ties/nulls, невалидные cursor, admin auth и ошибки.
- **489/489 Node tests**, lint/typecheck/production build прошли; детали в [baseline §23](17_PERFORMANCE_BASELINE.md). Browser import regression: **8/8**; sandbox блокировал Chrome IPC, разрешённый запуск прошёл.
- Обновлены PERF-план, security notes и rollout. Full Next/Supabase E2E, фактические remote grants/env, payload/latency/EXPLAIN не проверялись.

## Выпуск и ограничения

- Миграция PERF-010 удалённо **не применялась**. Требуется PostgreSQL 15+, сначала migration, затем deploy; автоматического тяжёлого fallback нет. Откат приложения допускает сохранение read-only views.
- Employee comparison ещё читает scoring JSON, но только для текущих максимум 50 участников. Столбцы dimensions строятся по странице; материализация/полный отказ от JSON — PERF-014. Общий критерий PERF-010 без scoring JSON пока не закрыт для этого route.
- Верхнеуровневые списки, кроме comparison, ещё без cursor pagination — PERF-011. При изменении fit между запросами cursor не гарантирует snapshot списка; порядок ties теперь по ID, не имени.
- Browser fixture не заменяет реальный PostgREST embedded limit/RLS и staging-приёмку. Удалённые миграции, production-флаги и destructive/downgrade требуют соответствующего разрешения.
- **PERF-009** реализован и ранее локально проверен, staging/performance-приёмка открыта: [rollout PERF-009](29_ATOMIC_TEST_VERSION_CLONE_ROLLOUT.md). Атомарный clone требует обе builder V2 migrations и `20260909120000_atomic_test_version_clone.sql`; их remote-применение не подтверждено.
- **PERF-008.1/008.2** локально проверены, staging-приёмка открыта: [rollout PERF-008](28_BUILDER_INCREMENTAL_AUTOSAVE_ROLLOUT.md). `.env.example`: `BUILDER_SAVE_V2=false`, фактическое значение неизвестно. Зарегистрированный V2 draft нельзя возвращать к V1 удалением регистрации; Recovery JSON не является форматом импорта.
- `tests/fixtures/*.sql` — локальные заглушки, не миграции Supabase. PGlite не заменяет Supabase/RLS matrix и конкурентность на отдельных соединениях.

## Что осталось по плану

- PERF-011–012: pagination остальных list routes, серверные фильтры и подтверждённые EXPLAIN индексы.
- PERF-013–014: summary/details отчёта и materialized employee dimension scores для comparison.
- PERF-015: completion/scoring по замерам; PERF-016–017: кэширование, размещение и local development.
- Семь следующих кодовых пунктов, включая условный PERF-015; отдельно открыта полная приёмка PERF-010 и staging-приёмка ранее написанного кода.

## Как продолжать

- Новый запрос имеет приоритет. Проверить git status, нужный PERF-раздел и затронутый модуль; не повторять весь аудит проекта.
- После изменений обновить снимок и профильный rollout/план. Разделять «код готов», «локально проверено», «миграции применены» и «staging/production принят».
