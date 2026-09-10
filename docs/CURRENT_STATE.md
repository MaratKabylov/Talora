# Текущее состояние Talvia

Обновлено: 2026-09-10. В текущем проекте выполнены разрешённые staging-проверки; полный PERF-012 открыт.

## Текущий этап и следующий шаг

- **PERF-012: 197/197 staging checks, 500/500 локальных тестов; performance-приёмка не завершена.**
- Пользователь разрешил использовать текущий Supabase-проект с synthetic companies/users/results. Это не отдельная копия production.
- Lists/RLS/grants: **122/122**, реальные JWT A/B/dual, tenant isolation, cursor ties/nulls, full traversal, requested-company grant/revoke, disabled membership.
- Candidate/employee RPC: **75/75**, private published fixture 100 вопросов/400 вариантов; answer/section upsert, атомарный отказ invalid batch, completion/retry, late-write отказ. Scoring finalizer не запускался.
- [Отчёт и границы проверки](33_STAGING_LIST_ACCEPTANCE.md), [list JSON](performance/PERF012_STAGING_2026-09-10.json), [session JSON](performance/PERF012_SESSIONS_2026-09-10.json), [baseline §29](17_PERFORMANCE_BASELINE.md).
- Девять list API shapes ×30 warm: p95 308–532 ms. Answer upsert p95 313/330 ms, section 100 ответов 527/552 ms (candidate/employee), по 30 warm. Это сеть + PostgREST, не SQL/Next route SLA и не сравнение индексов.
- Две synthetic companies и fixture-строки оставлены. Три test users заблокированы, четыре memberships disabled, две session invitation-ссылки expired. Независимая финальная проверка **6/6**; IDs в JSON, секреты не сохранены.
- Следующий шаг: SQL EXPLAIN реальных query shapes и before/after write gate ≤10%; отдельно scoring, browser/server actions, остальные RLS paths и builder acceptance.
- SQL connection отсутствует; REST EXPLAIN вернул 406/PGRST107. Доступ к SQL нужен для планов и индексов; настройки, remote migrations, индексы и feature flags агентом не менялись.

## Изменённые области и проверки

- Добавлены opt-in scripts `staging:lists`, `staging:grants`, `staging:sessions`, отчёты JSON и [rollout](33_STAGING_LIST_ACCEPTANCE.md); обновлены план, baseline, rollout PERF-010/011/012.
- Scripts сохраняют fixture manifests и не перезаписывают существующие отчёты; ownership/fingerprint guard проверен до удалённых запросов. При аварийном прерывании до finally проверять shutdown отдельно.
- **500/500 tests**, lint, typecheck, production build прошли. Build повторён вне sandbox после `spawn EPERM` на TypeScript worker. Browser E2E не выполнялся.
- Ранее подтверждены **25/25 API smoke** и **32/32 SQL checks** (19 PERF-010 + 13 PERF-011). [SQL-свидетельство пользователя](performance/PERF012_SQL_VERIFICATION_2026-09-10.json): 09:19:59 UTC, PostgreSQL 17.6, 34 индекса на 16 таблицах valid/ready.
- SQL-каталог получен от пользователя, полные тела функций/история миграций не сверены. Наличие RPC дополнено фактическими вызовами в указанной staging-матрице.

## Локальные индексы PERF-012

- `perf:indexes:isolate`: 11 пар (девять отдельных индексов + два no-index контроля), 47 SELECT shapes и четыре write proxies ×30 warm до/после в свежих PGlite БД.
- [Разбор](32_QUERY_INDEX_BENCHMARK.md), [поиндексный архив](performance/PERF012_ISOLATED_2026-09-10.zip), [общий JSON](performance/PERF012_LOCAL_2026-09-10.json). Questions/options — первые кандидаты по планам чтения.
- Write proxies и no-index контроли показывают шум; критерий ≤10% не доказан. Миграции экспериментальных индексов не созданы.
- Два обычных token-индекса перекрывают UNIQUE в candidate/employee invitations (по 16 KiB). Ничего не удалялось; неизвестный stats_reset не позволяет делать выводы по idx_scan.
- PGlite 0.5.8 / PostgreSQL 18.3: частичный fixture, не реальная история миграций/RLS/triggers/PostgREST. Первые выполнения не являются cold I/O.

## Готовая кодовая база и ограничения

- PERF-011: cursor `(created_at|updated_at, id)`, серверные фильтры/URL, страницы 50/100; comparison `(fit_score, id)`, nulls last, 50 строк.
- Dashboard candidates/job candidates/participants/jobs/tests/packages/assessments и admin companies/applications/users/audit покрыты кодом; текущая staging-матрица уже полного охвата приложения.
- Tests/packages используют tenant-scoped invoker RPC. [PERF-011 rollout](31_DASHBOARD_CURSOR_PAGINATION_ROLLOUT.md); cursor не даёт snapshot при изменении даты/fit.
- PERF-010: employee comparison ещё читает scoring JSON текущих 50 участников. [Rollout](30_DASHBOARD_LIST_READ_MODELS_ROLLOUT.md).
- PERF-009: код/локальные проверки готовы, remote atomic clone migration не подтверждена. [Rollout](29_ATOMIC_TEST_VERSION_CLONE_ROLLOUT.md).
- PERF-008.1/008.2: staging builder ожидается; `BUILDER_SAVE_V2=false` в `.env.example`, fallback V2 draft → V1 запрещён. [Rollout](28_BUILDER_INCREMENTAL_AUTOSAVE_ROLLOUT.md).
- Session suite устанавливает synthetic consent/started state; не покрывает UI consent/start, scoring finalizer, concurrent/successor completion и все типы ответов.
- `tests/fixtures/*.sql` — локальные stand-ins, не Supabase migrations. Полные browser, scoring, RLS/performance проверки остаются обязательными.

## Дальше по плану

- Завершить PERF-012 после production-like EXPLAIN и отбора минимального набора индексов с write gate.
- PERF-013/014: report summary/details и materialized employee dimension scores.
- PERF-015: completion/scoring по результатам измерений; PERF-016/017 — инфраструктура, наблюдаемость, local development.
- Сохранять чужие изменения. Remote migrations, production-флаги и destructive/downgrade требуют соответствующего разрешения.
