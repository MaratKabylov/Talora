# Текущее состояние Talvia

Обновлено: 2026-09-12. Локальная часть PERF-017 и candidate browser E2E готовы; optimized section-save browser path обнаружил блокирующий retry error. Deployment runtime и Supabase regions ещё не подтверждены. PERF-014 принята на текущем Supabase. Первый безопасный срез PERF-016 готов локально; app deployment не выполнялся.

## Текущий этап и следующий шаг

- **PERF-017 local gate:** `next start` first/warm p50/p95 116.24/6.70/11.30 ms; `next dev` — 484.24/15.31/21.50 ms на одном no-DB endpoint, 20 warm samples. Это local comparison, не SLA. [Evidence/gate](36_PERF017_RUNTIME_PLACEMENT.md).
- Hosting/Next runtime region и Supabase Postgres region неизвестны. После диагностики optimized section-save следующий infrastructure gate — получить точный DB region и hosting provider/region, затем настроить ближайший runtime на preview без изменения схемы.
- PERF-017 checks: localhost-only guard, два HTTP-прогона по 21 успешному запросу, `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` 516/516, `git diff --check`.
- **PERF-016 first slice: 516/516 tests, lint, typecheck, production build и HTTP smoke прошли.**
- Shared cache содержит только глобальные поля городов, profile проверяет company context заранее, admin mutations сбрасывают tag, write validation читает БД напрямую. Import schema v1/v2 кэшируется по отдельным URL. [Rollout](35_PERF016_REFERENCE_CACHE_ROLLOUT.md).
- **PERF-014: код и migration готовы локально; 513/513 tests, lint, typecheck и production build прошли.**
- Новая таблица `employee_assessment_dimension_scores` хранит текущие comparison dimensions по `scoring_revision`; normal completion и recalculation заменяют их атомарно вместе со scoring snapshot.
- Employee comparison читает одну tenant-scoped выборку materialized rows на страницу до 50 участников. Для старых scored participants без строк текущей revision JSON fallback ограничен только их IDs.
- PERF-014 catalog verification: все 12 проверок table/RLS/grants/RPC прошли; tenant/session/stale mismatches — 0. До staging было 5 исторических scored participants без materialized rows.
- PERF-014 staging scoring acceptance: **30/30**, candidate/employee completion и idempotent retry; employee dimension row записана с revision 1. Shutdown **2/2**, обе synthetic invitation-ссылки погашены. [Артефакт](performance/PERF014_STAGING_2026-09-12.json).
- Финальная PERF-014 verification: `row_count=1`, materialized staging dimension valid, tenant/session/stale mismatches — 0, historical fallback coverage — 5. [SQL evidence](performance/PERF014_FINAL_VERIFICATION_2026-09-12.json).
- **PERF-012: 226/226 staging checks; 501/501 full tests; evidence collected, индексы не приняты.**
- Пользователь разрешил использовать текущий Supabase-проект с synthetic companies/users/results. Это не отдельная копия production.
- Lists/RLS/grants: **122/122**, реальные JWT A/B/dual, tenant isolation, cursor ties/nulls, full traversal, requested-company grant/revoke, disabled membership.
- Candidate/employee RPC: **75/75**, private published fixture 100 вопросов/400 вариантов; answer/section upsert, атомарный отказ invalid batch, completion/retry, late-write отказ.
- Scoring route/finalizer: **29/29**, локальный Next `/api/assessment/complete` на текущий Supabase; candidate/employee записали completed, `overall_score=100`, `fit_score=100`, result/summary/report и retry без роста revision.
- [Отчёт и границы проверки](33_STAGING_LIST_ACCEPTANCE.md), [list JSON](performance/PERF012_STAGING_2026-09-10.json), [session JSON](performance/PERF012_SESSIONS_2026-09-10.json), [scoring JSON](performance/PERF012_SCORING_2026-09-10.json), [baseline §29](17_PERFORMANCE_BASELINE.md).
- Девять list API shapes ×30 warm: p95 308–532 ms. Answer upsert p95 313/330 ms, section 100 ответов 527/552 ms (candidate/employee), по 30 warm. Это сеть + PostgREST, не SQL/Next route SLA и не сравнение индексов.
- Две synthetic companies и fixture-строки оставлены. Три test users заблокированы, четыре memberships disabled, две session invitation-ссылки expired. Независимая финальная проверка **6/6**; IDs в JSON, секреты не сохранены.
- PERF-012 остаётся read-only/before evidence без изменения схемы; candidate browser UI/server actions теперь приняты через fallback, остальные RLS paths остаются отдельным охватом.
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
- **507/507 tests**, lint, typecheck и production build прошли после PERF-013 report pagination/acceptance. Targeted report tests 7/7 проверяют logical title lookup, summary/details split, нормализацию страниц, диапазоны и независимые ссылки; staging safety test запрещает перезапись evidence до remote access.
- PERF-013 staging report acceptance: **75/75**, четыре candidate/employee first/second-page shapes × 1 first + 5 warm, HTTP 200 и 11–13 stream chunks. First chunk 7,182 bytes; полный first-page HTML/RSC 77,373/76,426 bytes. [Артефакт](performance/PERF013_STAGING_2026-09-11.json).
- PERF-015 first iteration: V2 ready-path не повторяет invitation/session preflight; frozen session config не вызывает лишний package-test read, legacy fallback сохранён. Staging **29/29**; first completion 3 490/3 097 ms, retry 326/293 ms, calculation 1.30/0.19 ms, persistence 631/320 ms. Это единичные samples, не p95. [Артефакт](performance/PERF015_STAGING_2026-09-11.json).
- PERF-014 targeted regression **46/46** проверяет эквивалентность dimension DTO, быстрый/mixed-rollout comparison path, атомарную замену, stale conflict, idempotent backfill, rollback чужой session/version и read-only catalog verification.
- Staging harness создаёт только временного report-reader; финальный shutdown 3/3. Read-only audit подтвердил: все три пользователя повторных прогонов заблокированы, все три memberships disabled. Схема, flags и business rows не менялись.
- Browser/UI acceptance 12.09 пройдена в подключённом Chrome: navigation **30/30**, builder import **8/8**, builder editor profile и 7 editor scenarios получили `data-status=passed`. Editor mount 122.7 ms, edit p50/p95 11.3/20.6 ms; synthetic development fixture, не INP/staging p95. Все servers остановлены. [Evidence](performance/PERF017_BROWSER_UI_RETRY_2026-09-12.json).
- Native Chrome mouse drag дополнительно подтверждён: вопрос 101 перемещён в конец секции и сохранён как `102,103,101`; автоматический editor suite после manual check снова прошёл. Native touch и cross-section autoscroll остаются за границами проверки.
- Candidate Chrome E2E на локальном `next start` и текущем Supabase пройден через fallback: consent/profile/test/complete и persistence **14/14**, invitation expired. Optimized section-save endpoint был включён, но browser submit получил generic retry error; rollout этого пути заблокирован до диагностики. [Evidence](performance/PERF017_AUTH_BROWSER_E2E_2026-09-12.json).
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
- PERF-010/014: remote migration применена, но app deployment не выполнялся, поэтому развёрнутое приложение пока использует прежний код. После deploy исторические строки без materialization обслуживаются bounded fallback. [PERF-010 rollout](30_DASHBOARD_LIST_READ_MODELS_ROLLOUT.md), [PERF-014 rollout](34_PERF014_EMPLOYEE_DIMENSIONS_ROLLOUT.md).
- PERF-009: код/локальные проверки готовы, remote atomic clone migration не подтверждена. [Rollout](29_ATOMIC_TEST_VERSION_CLONE_ROLLOUT.md).
- PERF-008.1/008.2: staging builder ожидается; `BUILDER_SAVE_V2=false` в `.env.example`, fallback V2 draft → V1 запрещён. [Rollout](28_BUILDER_INCREMENTAL_AUTOSAVE_ROLLOUT.md).
- Session/scoring suites устанавливают synthetic consent/started state; не покрывают UI consent/start, concurrent/successor completion и все типы ответов.
- `tests/fixtures/*.sql` — локальные stand-ins, не Supabase migrations. Полные browser, RLS/performance проверки остаются обязательными.

## Дальше по плану

- Browser synthetic acceptance закрыта; PERF-012 вернётся только на отдельной staging/preview DB или при готовности DDL gate.
- Следующий кодовый шаг — воспроизвести optimized section-save с безопасным server-side error code, исправить причину и повторить полный candidate browser E2E без fallback.
- PERF-013 принят на локальном production server с текущим Supabase: summary/details streaming и page-2 URL/control path подтверждены. Fixture содержит 20 answers, поэтому traversal заполненной границы 50/100 и удалённый app deployment не подтверждены.
- PERF-014 migration и staging scoring path приняты в текущем Supabase; финальная integrity verification пройдена. Пять исторических missing rows обслуживаются bounded fallback и не требуют немедленного backfill.
- PERF-015: первая итерация готова; durable `scoring_jobs`/worker требует изменения схемы и отложен по решению пользователя.
- PERF-017 закрывает local requirements; deployment gate ожидает точную пару Supabase Postgres region + hosting runtime region. PERF-016 можно продолжать только после безопасного разделения immutable assessment content и live token/session state.
- Сохранять чужие изменения. Remote migrations, production-флаги и destructive/downgrade требуют соответствующего разрешения.
