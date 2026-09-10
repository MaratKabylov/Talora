# Текущее состояние Talvia

Обновлено: 2026-09-10. Снимок кода и локальных проверок; remote-состояние не подтверждено.

## Текущий этап и следующий шаг

- **PERF-012: локальный диагностический этап выполнен, весь этап не принят.**
- `npm run perf:indexes`: 47 SELECT shapes × 30 warm EXPLAIN до/после, девять экспериментальных индексов, четыре write proxies; две отдельные in-memory PGlite БД.
- Сохранены планы/BUFFERS, p50/p95, размеры, source hashes и одинаковые результаты: [методика и результаты](32_QUERY_INDEX_BENCHMARK.md), [JSON](performance/PERF012_LOCAL_2026-09-10.json), [baseline §25](17_PERFORMANCE_BASELINE.md).
- Чтение ускоряется, но score-update proxies ухудшились. Набор не перенесён в миграцию; индексы в Supabase не добавлялись.
- Следующий шаг PERF-012: на staging сверить каталог, снять реальные RLS/PostgREST plans, проверить каждый индекс отдельно и полный autosave/upsert. Удалённые изменения требуют отдельного разрешения.

## Изменённые области и проверки этого шага

- `scripts/perf-index-benchmark.mjs`, npm script `perf:indexes`, игнорируемый каталог `artifacts/performance/`, сохранённый JSON и документация PERF-012.
- `supabase/verification/performance_index_inventory.sql`: read-only каталог без пользовательских строк; выполнен в fixture, 19 существующих индексов valid/ready.
- Fixture: 8 компаний, 8 000 jobs, по 32 000 applications/participants, 100 templates/draft versions, 10 000 questions / 40 000 options.
- Локальные проверки сравнивают результаты до/после, tenant/лимит и точные дубликаты кандидатов. Существующие индексы сохранены.
- **496/496 Node tests, lint, typecheck и production build прошли в этом шаге.** Browser E2E и remote acceptance не выполнялись.
- PostgreSQL 18.3 / PGlite 0.5.8; частичный fixture без полной истории миграций, RLS, triggers и PostgREST. Write proxies не доказывают критерий autosave/upsert ≤10%; первые выполнения не являются cold I/O.

## Готовая кодовая база PERF-010/011

- PERF-011: cursor `(created_at|updated_at, id)`, серверные фильтры и URL-навигация; 50 строк по умолчанию, максимум 100. Comparison — 50, `(fit_score, id)` и nulls last.
- Охват: dashboard candidates, job candidates, employee participants, jobs/tests/packages/employee assessments; admin companies/applications/users/audit.
- Tests/packages используют tenant-scoped invoker RPC вместо полного списка grant IDs. Две функции добавлены в `20260909160000_dashboard_list_pagination.sql`.
- PERF-010/011 SQL verification и локальные RLS stand-ins покрываются регрессией; реальный Supabase/PostgREST ими не заменяется.
- Миграция PERF-011 удалённо не применялась в предыдущем шаге; remote-состояние PERF-010 не подтверждено. Нужны PostgreSQL 15+, сначала migrations, затем deploy: [rollout PERF-011](31_DASHBOARD_CURSOR_PAGINATION_ROLLOUT.md).
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
