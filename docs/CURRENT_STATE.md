# Текущее состояние Talvia

Обновлено: 2026-09-10. API smoke и 32 SQL-проверки текущего проекта подтверждены; полная RLS/performance-приёмка открыта.

## Текущий этап и следующий шаг

- **PERF-012: локальные замеры выполнены; API smoke 25/25, SQL-каталог 32/32; performance-приёмка открыта.**
- `npm run perf:indexes:isolate`: 11 пар (девять отдельных индексов и два no-index контроля), в каждой 47 SELECT shapes / четыре write proxies × 30 warm повторов до/после в двух свежих PGlite БД.
- Сохранены планы/BUFFERS, p50/p95, размеры, source hashes и одинаковые результаты: [разбор](32_QUERY_INDEX_BENCHMARK.md), [поиндексный архив](performance/PERF012_ISOLATED_2026-09-10.zip), [исходный общий JSON](performance/PERF012_LOCAL_2026-09-10.json), [baseline §26](17_PERFORMANCE_BASELINE.md).
- Questions/options — первые кандидаты на staging по планам чтения. Score-update proxies и no-index контроли показывают шум записи; критерий autosave/upsert ≤10% не доказан. Миграции индексов не созданы.
- Пользователь сообщил о применении миграции и разрешил текущий проект. API подтвердил пять PERF-010 views/столбцы, две PERF-011 функции, запреты anon/service role и три embedding-контракта: [remote JSON](performance/PERF012_REMOTE_2026-09-10.json), [baseline §27](17_PERFORMANCE_BASELINE.md).
- Все удалённые data/RPC запросы — GET/LIMIT 0; ключи и бизнес-строки не выводились. REST EXPLAIN без ANALYZE вернул 406/PGRST107. Данные, схема и настройки агентом не менялись.
- Пользователь предоставил результат SQL Editor от 09:19:59 UTC: PostgreSQL 17.6, PERF-010 19/19 и PERF-011 13/13; 34 индекса на 16 таблицах valid/ready. [SQL-свидетельство](performance/PERF012_SQL_VERIFICATION_2026-09-10.json), [baseline §28](17_PERFORMANCE_BASELINE.md).
- Следующий шаг: EXPLAIN реальных query shapes, representative dataset и полные autosave/completion/RLS проверки. SQL-подключение и authenticated JWT агенту не доступны; сведения о каталоге получены от пользователя, текущий проект не классифицирован как staging.

## Изменённые области и проверки этого шага

- Сохранён пользовательский JSON SQL-проверки; обновлены состояние, rollout, план и baseline. Нового кода/миграций в этом продолжении нет.
- Проверены JSON, 19+13 уникальных успешных checks, valid/ready всех 34 индексов, ссылки и diff. Тесты приложения не перезапускались для документации.
- Последние проверки кода в предыдущем продолжении: **498/498**, lint, typecheck и production build (после повтора вне sandbox из-за `spawn EPERM`). Browser E2E и authenticated/RLS matrix остаются открытыми.
- Найдены два перекрытия: обычные индексы token в invitations и employee_assessment_invitations повторяют ключи UNIQUE-индексов (по 16 KiB). Ничего не удалялось; idx_scan при неизвестном stats_reset не доказывает необходимость удаления.
- PostgreSQL 18.3 / PGlite 0.5.8; частичный fixture без полной истории миграций, RLS, triggers и PostgREST. Write proxies не доказывают критерий autosave/upsert ≤10%; первые выполнения не являются cold I/O.

## Готовая кодовая база PERF-010/011

- PERF-011: cursor `(created_at|updated_at, id)`, серверные фильтры и URL-навигация; 50 строк по умолчанию, максимум 100. Comparison — 50, `(fit_score, id)` и nulls last.
- Охват: dashboard candidates, job candidates, employee participants, jobs/tests/packages/employee assessments; admin companies/applications/users/audit.
- Tests/packages используют tenant-scoped invoker RPC вместо полного списка grant IDs. Две функции добавлены в `20260909160000_dashboard_list_pagination.sql`.
- PERF-010/011 SQL verification и локальные RLS stand-ins покрываются регрессией; реальный Supabase/PostgREST ими не заменяется.
- API и пользовательский SQL-результат подтверждают проверяемые свойства PERF-010/011: контракты views, security_invoker, RLS enabled, invoker/STABLE/SETOF, search_path и grants. Полные тела функций/история миграций и фактическая изоляция под JWT не проверены: [rollout PERF-011](31_DASHBOARD_CURSOR_PAGINATION_ROLLOUT.md).
- Вспомогательные справочники форм, detail/report routes и часть admin catalogs/monitoring/team не охвачены первой очередью пагинации.
- Cursor не обеспечивает snapshot при изменении даты/fit; route bytes/p50/p95 и RPC/view pushdown ещё не измерены.

## Остальные ограничения

- PERF-010: staging и уход от scoring JSON в employee comparison остаются открытыми; JSON читается только для текущих 50 участников: [rollout PERF-010](30_DASHBOARD_LIST_READ_MODELS_ROLLOUT.md).
- PERF-009: код/локальные проверки готовы, staging ожидается; remote-применение atomic clone migration не подтверждено: [rollout PERF-009](29_ATOMIC_TEST_VERSION_CLONE_ROLLOUT.md).
- PERF-008.1/008.2: локальные проверки готовы, staging ожидается. `BUILDER_SAVE_V2=false` в `.env.example`; fallback V2 draft в V1 запрещён: [rollout PERF-008](28_BUILDER_INCREMENTAL_AUTOSAVE_ROLLOUT.md).
- `tests/fixtures/*.sql` — локальные stand-ins, не Supabase migrations. Реальные RLS matrix, browser acceptance и staging performance остаются обязательными.
- Удалённые миграции, production-флаги и destructive/downgrade требуют соответствующего разрешения.

## Дальше по плану

- Завершить PERF-012 после production-like измерений и отбора минимального набора индексов.
- PERF-013/014: report summary/details и materialized employee dimension scores.
- PERF-015: completion/scoring только по результатам измерений; PERF-016/017 — инфраструктура, наблюдаемость и local development.
- Сохранять чужие изменения и разделять «код готов», «локально проверено», «миграции применены» и «staging/production принят».
