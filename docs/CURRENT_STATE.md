# Текущее состояние Talvia

Обновлено: 2026-09-09. Снимок для продолжения работы, не журнал и не доказательство состояния удалённой БД.

## Текущая задача и следующий шаг

- **PERF-009 реализован и локально проверен**: атомарное клонирование published → draft для company/system. Исходные N+1 actions заменены одной server-only RPC с повторной проверкой роли/tenant/ownership.
- Копируются settings, remediation, matching targets и scoring V2, включая SJT/Forced Choice и criterion references. Повтор открывает существующий draft, system audit атомарен, ошибка не оставляет частичной версии.
- **Staging/performance-приёмка PERF-009 открыта**: миграция удалённо не применялась, p95 ≤ 2 с на 100 вопросах и реальные конкурентные подключения не проверены. Полный порядок: [rollout PERF-009](29_ATOMIC_TEST_VERSION_CLONE_ROLLOUT.md).
- Следующий шаг выпуска — разрешённое применение миграции на staging до deploy кода и приёмка. Следующая кодовая задача — **PERF-010: лёгкие list read models** в [плане](16_PERFORMANCE_OPTIMIZATION_PLAN.md).

## Изменённые области и проверки PERF-009

- Actions: `lib/tests/builder-actions.ts`, `lib/admin/test-actions.ts`; общий серверный путь: `lib/tests/clone-service.ts`.
- Миграция: `supabase/migrations/20260909120000_atomic_test_version_clone.sql`. Проверка после применения: `supabase/verification/atomic_test_version_clone.sql` (read-only, все `passed=true`).
- Тесты: `tests/test-version-clone-db.test.ts`, `tests/test-version-clone.test.ts`. PGlite исполняет реальную миграцию с production content DDL/guards и обеими миграциями PERF-008; auth/company окружение — локальные заглушки.
- Текущий прогон: **475/475 Node tests**, lint/typecheck/build успешно; **8 builder editor + 8 builder import browser scenarios** успешно. После lint-правки имени локальной переменной повторены профильные action-тесты и lint; build включает TypeScript.
- Windows sandbox заблокировал первый build/Chrome (`EPERM`/IPC); повтор с разрешением на запуск дочерних процессов прошёл. Настройки приложения не менялись.
- Последний полный Node-прогон: один локальный clone 5 секций / 100 вопросов / 400 вариантов — **156 мс**. Это не staging, не p95 и не подтверждённый SLA. Детали: §22 [baseline](17_PERFORMANCE_BASELINE.md).
- Обновлены план, baseline, security notes и rollout. Новых env нет; реальные env и удалённая история миграций не проверялись.

## Выпуск и ограничения

- PERF-009 требует обе миграции builder V2: `20260908120000_builder_save_v2.sql`, затем `20260908140000_builder_save_v2_integration.sql`; перед применением проверить реальную историю. Их staging/production-применение здесь не подтверждено.
- У PERF-009 нет нового feature flag или автоматического legacy fallback: сначала миграция, затем deploy приложения. При отсутствии RPC операция возвращает ошибку. Старый clone имеет известные риски потери данных и не является безопасным fallback.
- Новая копия не наследует `builder_revision`/receipt исходника и не регистрируется в `builder_save_state` при клонировании; действующие triggers формируют её собственную revision. Редактирование доступно через V1/V2 по существующим правилам.
- PERF-008.1/008.2: код локально проверен, staging/performance-приёмка открыта. Источник: [rollout PERF-008](28_BUILDER_INCREMENTAL_AUTOSAVE_ROLLOUT.md); в `.env.example` — `BUILDER_SAVE_V2=false`, фактическое значение неизвестно.
- Первая V2-запись регистрирует draft в `builder_save_state`. Выключение флага не возвращает зарегистрированный draft к V1; нельзя удалять регистрацию для обхода защиты. Recovery JSON — ручная резервная копия, не формат импорта; автоматического rebase нет.
- Клиент V2 отправляет delta, сервер читает весь документ для валидации. PGlite/React fixtures не заменяют full Supabase/Next E2E, RLS matrix, network/latency и конкурентность на отдельных соединениях.
- `tests/fixtures/*.sql` — локальные заглушки, не миграции Supabase. Удалённые миграции, production-флаги и downgrade/destructive действия требуют соответствующего разрешения.

## Что осталось по плану

- PERF-010–012: лёгкие списки, cursor pagination/фильтры, подтверждённые индексами и EXPLAIN оптимизации.
- PERF-013–014: summary/details отчёта и materialized dimension scores для сравнения.
- PERF-015: completion/scoring только по замерам; PERF-016–017: кэширование, размещение и local development.
- Итого 8 следующих кодовых пунктов, включая условный PERF-015; отдельно открыта staging-приёмка уже написанного кода.

## Как продолжать

- Новый запрос имеет приоритет. Перед изменениями сверить git status, профильный раздел плана и затронутый модуль; не повторять весь аудит проекта.
- Команды: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`; профильные browser scripts — по затронутому пути.
- После изменений обновить этот снимок и профильный rollout/план. Разделять «код готов», «локально проверено», «миграции применены» и «staging/production принят»; неизвестное отмечать явно.
