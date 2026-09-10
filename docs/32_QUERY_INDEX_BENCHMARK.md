# PERF-012 — измерение запросов и отбор индексов

Обновлено: 2026-09-10. **Локальный диагностический этап выполнен; PERF-012 целиком
не принят.** Миграции индексов не созданы и удалённые изменения не выполнялись.

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

## Staging: измерения и условия выпуска

1. После отдельного разрешения на доступ/изменения сверить фактическую историю
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
5. Только после подтверждения составить отдельный deployment SQL. Для больших
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
