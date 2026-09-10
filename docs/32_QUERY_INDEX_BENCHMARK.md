# PERF-012 — измерение запросов и отбор индексов

Обновлено: 2026-09-10. **Локальные общий и поиндексный прогоны выполнены; PERF-012
целиком не принят.** Миграции индексов не созданы; действия агента в текущем удалённом
проекте ограничены чтением (25/25 API smoke, ниже).

## Воспроизведение

```bash
npm run perf:indexes
# Необязательный путь для JSON:
npm run perf:indexes -- artifacts/performance/another-run.json
```

Скрипт `scripts/perf-index-benchmark.mjs` создаёт две независимые in-memory PGlite БД:
с существующими индексами и с добавленным экспериментальным набором. Он не читает
env, не принимает database URL и не подключается к Supabase. Артефакт по умолчанию
лежит в игнорируемом Git каталоге `artifacts/performance/`.

Сохранённый [полный результат 10.09.2026](performance/PERF012_LOCAL_2026-09-10.json)
содержит SQL на синтетических параметрах, DDL кандидатов, каталог индексов с размерами,
планы `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT JSON)`, все времена и p50/p95,
число/хеш результатов, версии движка/Node и SHA-256 исходных файлов. Для сравнения
использовать именно этот файл, а не предполагаемый повторяемый процент ускорения.

## Область и достоверность

- 8 компаний, 8 000 jobs, 32 000 applications (4 000 на tenant, 1 000 на вакансию),
  32 000 employee participants (4 000 на оценку).
- 100 templates/100 draft versions, по 10 sections/100 questions/400 options на тест.
  Весь fixture: 1 000 sections, 10 000 questions и 40 000 options.
- 47 базовых SELECT shapes: jobs, общие/job applications, participants, оба comparison
  и чтение дочернего контента. Списки проверяют asc/desc, первую/среднюю/последнюю
  страницу, статус, одинаковые даты с микросекундами; comparison — также null-tail.
  Основной лимит — 51 строка, включая next-page lookahead.
- Каждый SELECT: отдельное первое выполнение и 30 warm EXPLAIN. Первый запуск
  **не является cold I/O**. До/после проверяется идентичность порядка и содержимого
  результатов; проверяются лимит, непустая выборка и tenant у бизнес-строк.
- Четыре write proxies: upsert 100 questions, reorder 400 options, изменение scores
  100 applications и 100 participants. После каждого EXPLAIN — ROLLBACK; 30 замеров
  после одного разогрева. Это не настоящие autosave/scoring RPC.
- Fixture читает точные CREATE TABLE с FK/PK/UNIQUE из initial/employee migrations,
  существующие явные индексы измеряемых таблиц оттуда и расширение matching options.
  **Это не полная актуальная схема:** нет RLS/auth helpers, publication/revision
  triggers, последующих широких scoring columns, полной истории миграций и PostgREST.
- Движок результата — PostgreSQL 18.3 / PGlite 0.5.8, Node 24.14.0, timezone UTC.
  Последовательный before/after, WASM/JIT, кеши и мёртвые версии строк после rollback
  влияют на время. Замеры не доказывают production latency или write amplification/WAL.
- Измеряется весь набор индексов вместе: взаимное влияние не изолировано. Отсутствие
  точных дубликатов проверяется по каталогу fixture (ключи, порядок, opclass, collation,
  predicate/expression); реальные staging indexes проверяются отдельно.

## Локальные результаты

Время — миллисекунды SQL execution внутри PGlite; в ячейках **p50 / p95**.
Для списков ниже показана первая страница DESC; остальные планы сохранены в JSON.

| Query shape | До | С экспериментальными индексами |
| --- | ---: | ---: |
| jobs | 0.788 / 1.737 | 0.084 / 0.140 |
| applications | 4.145 / 8.570 | 0.063 / 0.090 |
| job applications | 0.598 / 0.899 | 0.061 / 0.072 |
| employee participants | 0.098 / 0.176 | 0.075 / 0.144 |
| candidate comparison | 0.714 / 1.922 | 0.060 / 0.155 |
| employee comparison | 2.986 / 5.349 | 0.057 / 0.092 |
| sections | 0.084 / 0.283 | 0.027 / 0.058 |
| questions | 0.698 / 1.273 | 0.017 / 0.023 |
| options | 2.636 / 6.595 | 0.015 / 0.023 |
| question upsert proxy | 4.316 / 9.066 | 1.444 / 3.026 |
| option reorder proxy | 7.188 / 13.552 | 5.818 / 9.949 |
| application score update proxy | 1.557 / 3.113 | 2.540 / 5.252 |
| participant score update proxy | 1.206 / 2.833 | 1.983 / 3.895 |

Девять дополнительных индексов занимают **14 565 376 bytes** до write-прогонов.
Старые индексы сохранены. Это добавленная стоимость хранения данного fixture,
без оценки WAL, production cardinality, bloat или concurrent build overhead.

## Решения по кандидатам

| Кандидат | Наблюдение и дальнейшая проверка |
| --- | --- |
| sections `(test_version_id, order_index)` | Вместо полного сканирования выбран Bitmap Index Scan + Sort; прямого устранения Sort нет. Проверить выигрыш под реальными RLS и полным embedding. |
| questions `(section_id, order_index)` | Выбран Index Scan; подтвердить на active-section и builder save RPC. |
| options `(question_id, order_index)` | Выбран Index Scan; existing unique `match_target_id` решает другую задачу. Подтвердить на embedding и reorder/upsert. |
| jobs `(company_id, updated_at DESC, id ASC)` | Первая DESC-страница использует упорядоченный Index Scan. ASC и cursor-tail могут сохранять Sort/фильтрацию. |
| applications date, job/date | Индексы обслуживают два разных tenant/parent порядка; рассмотреть отдельно их стоимость на INSERT/completion и необходимость обоих. |
| applications fit, participants fit | В текущем коде порядок `(fit_score, id)`, **без completed_at**, с `NULLS LAST`. Чтение ускорилось, но score-update proxies ухудшились; общий набор пока не выпускать. |
| participants date | Уже есть `(employee_assessment_id, created_at DESC)`. Начальный план использует incremental sort; добавленный индекс даёт небольшой абсолютный выигрыш. Отложить до отдельного подтверждения пользы. |

`employee_assessments(company_id, updated_at DESC)` уже существует; его расширение
не добавлено без EXPLAIN настоящего aggregate view. Поиск по именам/названиям с ILIKE,
tests/packages invoker RPC, summary views, latest-invitation embedding и admin lists
этим локальным прогоном не проверены. Решение о pg_trgm/GIN остаётся открытым.

## Поиндексный прогон — следующий локальный шаг

```bash
npm run perf:indexes:isolate
# Необязательный каталог результатов:
npm run perf:indexes:isolate -- artifacts/performance/another-isolation-run
```

`scripts/perf-index-isolation.mjs` выполняет **11 парных прогонов**: контроль без
новых индексов, девять отдельных индексов и ещё один контроль без новых индексов.
Каждая пара заново создаёт обе БД, сохраняет все 47 SELECT и четыре write proxies
по 30 warm повторов. Это 31 020 warm SELECT EXPLAIN и 2 640 warm DML EXPLAIN.
Каталог проверяется на точное совпадение с выбранным набором; неверные/повторные
имена отклоняются до создания БД. Порядок/содержимое результатов до/после совпали
во всех парах. Набор исходных данных и ограничения fixture остаются прежними.

[Полный архив результатов](performance/PERF012_ISOLATED_2026-09-10.zip) содержит
11 JSON с SQL, планами/BUFFERS, всеми временами и каталогами, `summary.json` с
компактным сравнением и `runner-source.mjs` — снимок измерявшегося orchestration
script. SHA-256 источников сверены при архивировании. Рабочие файлы находятся
в `artifacts/performance/perf012-isolation/`; архив можно распаковать стандартными
средствами Windows. Исходный общий прогон выше сохранён как отдельное свидетельство.

Ниже — **p50, ms** конкретной пары с одним индексом. Для списков — первая DESC
страница. Значения нельзя сравнивать между разными парами как единый baseline.

| Единственный дополнительный индекс | Чтение до → после | Соответствующая запись до → после | Bytes индекса |
| --- | ---: | ---: | ---: |
| sections parent/order | 0.103 → 0.025 | section write не измерялся | 57 344 |
| questions parent/order | 0.914 → 0.016 | upsert: 1.874 → 1.173 | 425 984 |
| options parent/order | 2.617 → 0.012 | reorder: 6.347 → 4.999 | 1 654 784 |
| jobs date | 0.616 → 0.053 | job write не измерялся | 491 520 |
| applications date | 2.155 → 0.049 | score: 1.178 → 1.503 | 1 908 736 |
| applications job/date | 0.593 → 0.068 | score: 1.172 → 1.814 | 2 506 752 |
| applications fit | 0.897 → 0.054 | score: 1.140 → 1.567 | 2 506 752 |
| participants date | 0.107 → 0.059 | score: 1.166 → 1.757 | 2 506 752 |
| participants fit | 2.671 → 0.057 | score: 1.132 → 2.134 | 2 506 752 |

**Контроли выявили существенный разброс записи даже без новых индексов.** В начале
application score p50 изменился 1.252 → 1.332 ms, в конце 1.363 → 1.907 ms; employee
score — 1.212 → 1.422 и 1.470 → 1.224 ms соответственно. На unrelated-таблицах
тоже встречаются колебания. Поэтому эти пары не доказывают точную причинную оценку
замедления отдельным индексом; небольшие проценты и порог ≤10% ими не подтверждаются.
Контроли выявляют шум, но не корректируют его статистически. Повторный прогон
на native staging PostgreSQL с настоящими RPC и стабильной нагрузкой обязателен.

Приоритет для staging: questions/options parent/order (выбран Index Scan и уменьшилось
сканирование), затем sections и jobs с обязательным измерением их записи. Date/fit
индексы applications/participants требуют полноценного write/completion benchmark.
Participants date остаётся низким приоритетом: уже есть parent/date индекс и малый
абсолютный выигрыш чтения. **Ни один индекс этим шагом не принят для deployment.**

Проверки продолжения: 11/11 пар завершены; неверные имена/повторы и ошибочные repetitions
отклоняются; неудачный повтор сбрасывает старый `completed=true` до старта БД.
496/496 Node tests, lint и typecheck прошли заново. Production build прошёл при
повторе вне sandbox после `spawn EPERM` на TypeScript worker. Последняя правка runner
затрагивает только начальный маркер неполного запуска и проверена отдельным failure
сценарием; архив хранит снимок runner, выполнившего измерения.

## Проверка текущего проекта через API — 10.09.2026

Пользователь сообщил, что применил миграцию, и разрешил проверять текущий проект.
Использован проект из `.env`/`.env.local` с обычным приоритетом переменных окружения.
Отдельная классификация проекта как staging/production этим не подтверждается.

```bash
npm run perf:remote:check
```

`scripts/perf-remote-check.mjs` выполняет только GET, для данных/RPC — `LIMIT 0`.
Запрос плана использует `analyze=false`. Настройки, схема и данные не изменяются;
функции изменения данных, генерация auth credentials и подмена JWT не используются.

**25/25 проверок прошли на реальном PostgREST текущего проекта:**

- OpenAPI доступен; наборы столбцов пяти PERF-010 views соответствуют контрактам.
- Service role может читать эти views; проверено без получения бизнес-строк.
- Anon получает `401 / 42501` на все пять views.
- Обе функции PERF-011 присутствуют; service role получает `403 / 42501`, anon —
  `401 / 42501` при попытке GET-вызова с нулевым company UUID и limit 0.
- Разрешаются связи jobs/packages, candidate list/latest invitation и candidate
  comparison/competency summary. Семантика результатов при limit >0 здесь не проверяется.

[Сохранённый JSON](performance/PERF012_REMOTE_2026-09-10.json) содержит время,
отпечаток проекта, названия проверок и HTTP/error codes. Ключи, URL, персональные
данные, invitation tokens, raw errors и содержимое ответов в отчёт не записываются.

**EXPLAIN через REST недоступен:** plan media type вернул `406 / PGRST107`.
Настройки PostgREST не менялись. SQL-коннектор/connection string и authenticated
пользовательский JWT отсутствуют. Поэтому не проверены exact DDL, `security_invoker`,
`search_path`, все grants, реальная RLS matrix, история миграций и каталог индексов;
их нельзя вывести из успешного OpenAPI/GET smoke. PERF-012 не принят.

Для оставшейся SQL-проверки подготовлен
[`performance_remote_acceptance.sql`](../supabase/verification/performance_remote_acceptance.sql).
В SQL Editor **текущего проекта** выполнить файл целиком: он работает в read-only
транзакции с statement timeout 15 s / lock timeout 3 s и возвращает одну JSON-ячейку
`verification`. Она содержит 19 checks PERF-010, 13 checks PERF-011, каталог/размеры
индексов, версию PostgreSQL и видимое session-значение `pgrst.db_plan_enabled`.
Последнее может быть null и само по себе не описывает весь runtime-config PostgREST.
Нужно получить этот JSON для сверки; DDL и пользовательские строки скрипт не меняет.

Локально объединённый SQL выполнен в существующем PGlite RLS fixture: 32 checks
успешны, индексы valid/ready. Дополнительные mock HTTP tests проверяют GET/LIMIT 0,
отсутствие ключей/сырых ошибок в отчёте и обнаружение ошибочно открытого anon-доступа.
Это отдельные локальные свидетельства, не удалённая SQL/RLS-приёмка.
Регрессия этого продолжения: **498/498**, lint и typecheck успешны; production build
прошёл при повторе вне sandbox после `spawn EPERM` на TypeScript worker.

## Получен результат SQL Editor — 10.09.2026, 09:19:59 UTC

Пользователь предоставил JSON выполнения объединённого запроса в текущем проекте.
Сохранено [исходное свидетельство](performance/PERF012_SQL_VERIFICATION_2026-09-10.json)
с нормализованным форматированием; это предоставленный пользователем результат,
а не самостоятельное SQL-подключение агента. Он закрывает ожидание JSON выше.

- PostgreSQL **17.6**; PERF-010 **19/19**, PERF-011 **13/13**, все check names уникальны.
- Подтверждены проверяемые contracts/security_invoker/grants views и RLS enabled
  исходных таблиц; для RPC — invoker/STABLE/SETOF, пустой search_path и EXECUTE grants.
  Эти проверки не сравнивают полные тела функций и не воспроизводят JWT/RLS matrix.
- В переданном ограниченном каталоге **34 индекса на 16 таблицах**, все valid/ready.
  Экспериментальных `perf012_*` нет; parent/order индексов sections/questions/options
  и предложенных составных date/fit индексов в определениях этой выборки нет.
- Две пары совпадающих ключей: `idx_invitations_token` / `invitations_token_key` и
  `idx_employee_assessment_invitations_token` / `employee_assessment_invitations_token_key`.
  Первые — обычные, вторые — UNIQUE; это перекрытие доступа, а не эквивалентность
  ограничений уникальности. Обычные индексы занимают по 16 KiB. Автоматического удаления нет.
- `stats_reset=null`: нельзя вывести скорость запросов или период наблюдения из
  idx_scan. Даже 200 109 693 scans participant PK сами по себе не устанавливают
  текущую нагрузку/причину задержек. Нужны интервальные замеры и query plans.
- Jobs/applications/participants занимают по 8 KiB heap в этом снимке, questions —
  96 KiB, options — 232 KiB. Это размер хранения, не точный row count и не подтверждение
  representative dataset из PERF-плана.
- `postgrest_plan_setting=null` не доказывает runtime-настройку API; ранее прямой
  REST probe вернул 406/PGRST107. Настройки не менялись.

**Каталожная проверка PERF-010/011 завершена в пределах 32 условий. PERF-012 остаётся
открытым:** ещё нужны EXPLAIN на реальных формах запросов, representative dataset,
полные autosave/completion и authenticated/RLS checks. Удалённая DDL не выполнялась.
Это продолжение меняет только документы/артефакт: проверены структура JSON, условия,
ссылки и diff; старые 498/498 не выдаются за новый запуск тестов.

## Авторизованный staging-прогон на текущем проекте

После отдельного разрешения пользователя создан синтетический dataset и выполнены
**122/122** list/grants assertions с настоящими Auth JWT/PostgREST/RLS, включая dual
membership, system grant/revoke, full cursor traversal и disabled membership. Сняты
30 warm API-замеров для девяти запросов. Затем выполнены **75/75** candidate/employee
RPC checks на private fixture 100 вопросов/400 вариантов и **29/29** scoring route checks
через локальный Next `/api/assessment/complete`: persisted scores/results/reports и
idempotent retry. Все тестовые аккаунты/членства отключены, assessment links выключены
или истекли; проверки отключения успешны. [Отчёт и ограничения](33_STAGING_LIST_ACCEPTANCE.md),
[list/grants JSON](performance/PERF012_STAGING_2026-09-10.json),
[session JSON](performance/PERF012_SESSIONS_2026-09-10.json),
[scoring JSON](performance/PERF012_SCORING_2026-09-10.json).

Это закрывает перечисленные list/RLS/RPC/scoring-route сценарии, которые раньше ожидали
JWT/dataset; не закрывает полный browser UI, builder flows и SQL EXPLAIN. Индексы не добавлены.

## Staging: измерения и условия выпуска

1. После определения staging-проекта и SQL-подключения сверить фактическую историю
   миграций PERF-010/011 и выполнить read-only
   `supabase/verification/performance_index_inventory.sql`. Он возвращает только
   каталог, размеры и статистику индексов с датой сброса; пользовательские строки
   и SQL из pg_stat_statements не выводит. Нулевой idx_scan сам по себе не повод удалять индекс.
2. Снять реальные SQL shapes PostgREST под authenticated JWT с RLS двух tenants,
   а также разрешённым admin-контекстом. Использовать synthetic данные/параметры;
   не сохранять tokens, email, ответы или необезличенный SQL в артефакты.
3. Проверить parent/tenant filters, pushdown LIMIT через RPC/views, embedding,
   status/review/search, asc/desc, первую/глубокую/пустую страницу и nulls. Записать
   compute, версии, регионы/RTT, commit, dataset и минимум 30 cold/warm route-замеров.
4. На staging проверять **каждый индекс отдельно** и затем минимальный набор:
   планы/BUFFERS до/после, p50/p95 чтения, размер, INSERT/UPDATE/WAL, действующие
   candidate/employee autosave и builder delta upsert/reorder/clone. Критерий PERF-012
   «autosave/upsert не хуже более чем на 10%» локальными proxies не закрыт.
5. Только после подтверждения составить отдельный deployment SQL; его удалённое
   применение требует соответствующего разрешения. Для больших
   таблиц использовать `CREATE INDEX CONCURRENTLY` вне транзакционного migration
   wrapper, по одному индексу на таблицу; согласовать lock/statement timeouts с
   размером БД. До запуска сверить определение, после — `indisvalid/indisready`.
   `IF NOT EXISTS` не проверяет эквивалентность определения. Не удалять старые индексы
   автоматически. Неуспешный concurrent build может оставить invalid index;
   его исправление/удаление требует отдельного разрешения.

Поведение EXPLAIN, включая фактическое исполнение DML при ANALYZE, описано в
[PostgreSQL EXPLAIN](https://www.postgresql.org/docs/15/using-explain.html).
Ограничения concurrent build и проверки существующего имени — в
[PostgreSQL CREATE INDEX](https://www.postgresql.org/docs/15/sql-createindex.html).

## Проверки этого шага

- `npm run perf:indexes`: 47 × 2 SELECT shapes, 30 warm повторов; идентичность
  результатов, tenant/limit и отсутствие точных дубликатов кандидатов подтверждены.
- Read-only inventory SQL выполнен в fixture: 19 существующих индексов, valid/ready.
- `npm test`: 496/496; `npm run lint`, `npm run typecheck`, `npm run build` — успешно.
- Browser E2E и remote acceptance не выполнялись; приложение/RLS/миграции не изменены.
