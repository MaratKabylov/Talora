# Текущее состояние Talvia

Обновлено: 2026-09-11. В текущем проекте выполнены разрешённые staging-проверки; PERF-012 evidence collected, deployment индексов не принят. Код PERF-013 готов локально, staging acceptance не выполнен.

## Текущий этап и следующий шаг

- **PERF-012: 226/226 staging checks; 501/501 full tests; evidence collected, индексы не приняты.**
- Пользователь разрешил использовать текущий Supabase-проект с synthetic companies/users/results. Это не отдельная копия production.
- Lists/RLS/grants: **122/122**, реальные JWT A/B/dual, tenant isolation, cursor ties/nulls, full traversal, requested-company grant/revoke, disabled membership.
- Candidate/employee RPC: **75/75**, private published fixture 100 вопросов/400 вариантов; answer/section upsert, атомарный отказ invalid batch, completion/retry, late-write отказ.
- Scoring route/finalizer: **29/29**, локальный Next `/api/assessment/complete` на текущий Supabase; candidate/employee записали completed, `overall_score=100`, `fit_score=100`, result/summary/report и retry без роста revision.
- [Отчёт и границы проверки](33_STAGING_LIST_ACCEPTANCE.md), [list JSON](performance/PERF012_STAGING_2026-09-10.json), [session JSON](performance/PERF012_SESSIONS_2026-09-10.json), [scoring JSON](performance/PERF012_SCORING_2026-09-10.json), [baseline §29](17_PERFORMANCE_BASELINE.md).
- Девять list API shapes ×30 warm: p95 308–532 ms. Answer upsert p95 313/330 ms, section 100 ответов 527/552 ms (candidate/employee), по 30 warm. Это сеть + PostgREST, не SQL/Next route SLA и не сравнение индексов.
- Две synthetic companies и fixture-строки оставлены. Три test users заблокированы, четыре memberships disabled, две session invitation-ссылки expired. Независимая финальная проверка **6/6**; IDs в JSON, секреты не сохранены.
- Следующий шаг: PERF-012 остаётся read-only/before evidence без изменения схемы; отдельно browser UI/server actions, остальные RLS paths и builder acceptance.
- SQL connection у агента отсутствует; REST EXPLAIN вернул 406/PGRST107. Планы сняты пользователем через SQL Editor; настройки, remote migrations, индексы и feature flags агентом не менялись.
- Подготовлен SQL Editor пакет [perf012_staging_query_plans.sql](../supabase/verification/perf012_staging_query_plans.sql): read-only context, EXPLAIN без ANALYZE для list/comparison/builder shapes и index inventory.
- Получены свежий index inventory и 10 EXPLAIN result sets после staging: [plans](performance/PERF012_QUERY_PLANS_2026-09-10.json), [summary](performance/PERF012_QUERY_PLAN_SUMMARY_2026-09-10.json). Черновой minimal set: applications date/job-date/job-fit, participants date/fit и builder parent/order sections/questions/options; jobs низкий приоритет. Это планы без ANALYZE, write gate не закрыт.
- Write-gate targets подобраны: job 554 applications, employee assessment 137 participants; builder high-cardinality version was published/non-draft, draft versions had 0 content.
- Read-only applications job/date index preflight: proposed name absent; пользователь согласился остановить PERF-012 без DDL. Кандидаты остаются backlog/evidence, не deployment.
- Before write gate через rollback EXPLAIN ANALYZE: applications UPDATE 100 ~43.1 ms/WAL 159734/39 dirtied; participants UPDATE 100 ~8.6 ms/WAL 69121/12 dirtied; builder options UPDATE 100 on temporary draft fixture ~50.0 ms/WAL 74772/4 dirtied.
- Builder guard correctly rejected published content (`Only draft test content can be edited`); temporary draft fixture was rollback-only. RLS prompt checked: 7/7 affected tables RLS enabled, force=false, policies>=2.

## Изменённые области и проверки

- Добавлены opt-in scripts `staging:lists`, `staging:grants`, `staging:sessions`, `staging:scoring`, отчёты JSON и [rollout](33_STAGING_LIST_ACCEPTANCE.md); обновлены план, baseline, rollout PERF-010/011/012.
- Scripts сохраняют fixture manifests и не перезаписывают существующие отчёты; ownership/fingerprint guard проверен до удалённых запросов. При аварийном прерывании до finally проверять shutdown отдельно.
- **506/506 tests**, lint, typecheck и production build прошли после PERF-013 report pagination. Targeted report tests 7/7 проверяют logical title lookup, summary/details split, нормализацию страниц, диапазоны и независимые ссылки.
- Browser fixture servers `test:browser:navigation`, `test:browser:builder-import`, `test:browser:builder-editor` собрались и поднялись, но CUA transport закрыт, а Chrome/Edge headless в окружении не возвращают DOM/stdout; PASS/FAIL не подтверждён.
- Builder/browser acceptance step: targeted Node regression 164/164; full `npm test` 501/501, lint, typecheck passed. Browser fixtures compiled/served on 4318/4319/4320, but DOM PASS/FAIL still unconfirmed because CUA transport is closed.
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
- Dashboard candidates/job candidates/participants/jobs/tests/packages/assessments и admin companies/applications/users/audit покрыты кодом; текущая staging-матрица не является полным browser-охватом приложения.
- Tests/packages используют tenant-scoped invoker RPC. [PERF-011 rollout](31_DASHBOARD_CURSOR_PAGINATION_ROLLOUT.md); cursor не даёт snapshot при изменении даты/fit.
- PERF-010: employee comparison ещё читает scoring JSON текущих 50 участников. [Rollout](30_DASHBOARD_LIST_READ_MODELS_ROLLOUT.md).
- PERF-009: код/локальные проверки готовы, remote atomic clone migration не подтверждена. [Rollout](29_ATOMIC_TEST_VERSION_CLONE_ROLLOUT.md).
- PERF-008.1/008.2: staging builder ожидается; `BUILDER_SAVE_V2=false` в `.env.example`, fallback V2 draft → V1 запрещён. [Rollout](28_BUILDER_INCREMENTAL_AUTOSAVE_ROLLOUT.md).
- Session/scoring suites устанавливают synthetic consent/started state; не покрывают UI consent/start, concurrent/successor completion и все типы ответов.
- `tests/fixtures/*.sql` — локальные stand-ins, не Supabase migrations. Полные browser, RLS/performance проверки остаются обязательными.

## Дальше по плану

- Builder/browser acceptance и server actions без изменения схемы; PERF-012 вернётся только на отдельной staging/preview DB или при готовности DDL gate.
- Код PERF-013 готов локально: candidate/employee summary loaders получают logical test title через nested `test_versions(... test_templates(title))`; answers и integrity events вынесены под Suspense и листаются независимо по 50/100 строк со стабильным порядком. Счётчики details относятся к текущей странице. До приёмки нужны staging timing и проверка RSC/HTML payload. PERF-014 отложен без schema changes.
- PERF-015: completion/scoring по результатам измерений; PERF-016/017 — инфраструктура, наблюдаемость, local development.
- Сохранять чужие изменения. Remote migrations, production-флаги и destructive/downgrade требуют соответствующего разрешения.
