# Текущее состояние Talvia

Обновлено: 2026-09-13. PERF-012 indexes и DB-часть PERF-015 async scoring применены и проверены в разрешённом текущем Supabase-проекте (`main PRODUCTION`). Код приложения готов локально; deployment, scheduler, секрет worker и async feature flag ещё не включены.

## Текущий этап

- **PERF-012:** установлены восемь индексов для candidate/employee list/comparison и builder parent-order запросов. Remote catalog: `expected_count=8`, `ready_valid_count=8`, `missing_or_invalid=[]`, PostgreSQL 17.6. [Evidence](performance/PERF012_INDEXES_REMOTE_2026-09-13.json).
- Индекс `jobs` не добавлялся: измеренный объём около 121 строки и EXPLAIN не подтвердили пользу. Старый `(company_id, job_id)` индекс applications не удалялся.
- **PERF-015:** установлена durable `scoring_jobs` с RLS, дедупликацией parent/revision, lease claim через `SKIP LOCKED`, пятью попытками с backoff и атомарным queued persistence.
- Remote catalog подтвердил таблицу, RLS, четыре `SECURITY DEFINER` RPC, пустой `search_path`, закрытый direct table access и service-only execute. Queue пуста; expired leases и tenant-parent mismatches — 0. [Evidence](performance/PERF015_ASYNC_QUEUE_REMOTE_2026-09-13.json).
- Completion за флагом `ASSESSMENT_ASYNC_SCORING_V2`: enqueue возвращает `processing`, Next `after()` делает best-effort drain, client выполняет bounded polling, отдельный protected endpoint предназначен для scheduler.
- Флаг по умолчанию выключен. Синхронный completion остаётся рабочим rollback path.

## Реализация и безопасность

- Миграции: `20260912150000_perf012_confirmed_query_indexes.sql` и `20260912160000_perf015_async_scoring_jobs.sql`; применены через Supabase SQL Editor, поэтому remote migration ledger отдельно не подтверждён.
- Worker использует случайный UUID, ограничивает batch/lease, не возвращает job IDs, SQL, PII или raw errors. Просроченную lease может забрать другой worker; старый worker после expiry не может завершить job.
- Enqueue сам выводит `company_id` из parent, проверяет завершённость session rows и привязывает invitation. Клиентский `company_id` не принимается.
- Parent, invitation, scoring snapshot, revision и job завершаются одной транзакцией. Terminal retry требует явного действия.
- `/api/internal/scoring/drain` принимает только POST, проверяет 32+ character bearer secret через SHA-256/timing-safe comparison и возвращает безопасные агрегаты.
- Отдельное отображение terminal failure для HR/admin остаётся rollout follow-up; состояние доступно в operational verification без PII.
- [Security notes](06_RLS_AND_SECURITY_NOTES.md), [rollout](37_PERF012_INDEXES_AND_PERF015_ASYNC_SCORING_ROLLOUT.md), [baseline §40](17_PERFORMANCE_BASELINE.md).

## Проверки

- `npm test`: **523/523**.
- `npm run lint`, `npm run typecheck`, `npm run build`: успешно; build содержит `/api/internal/scoring/drain`.
- PGlite исполняет обе реальные миграции и verification SQL. Покрыты idempotent DDL, tenant isolation, service-only grants, dedup, lease exclusivity/expiry/takeover, bounded retry, explicit terminal retry и rollback атомарной транзакции.
- Подключённый Chrome: navigation suite **30/30**, включая automatic completion polling, manual retry и recovery без дублирования записи.
- `git diff --check`: успешно; только предупреждения Git о переводе LF в CRLF на Windows.
- PERF-014 ранее принят на текущем Supabase: staging scoring **30/30**, final integrity без tenant/session/stale mismatches. Исторические пять missing dimension rows обслуживаются bounded fallback.
- PERF-017 local production/runtime и candidate browser E2E ранее прошли; точные hosting/Supabase regions и production-like latency остаются неизвестны.

## Следующий шаг

1. Развернуть текущий код с `ASSESSMENT_ASYNC_SCORING_V2=false` и server-only `SCORING_WORKER_SECRET` длиной 32+ символов.
2. Настроить scheduler раз в минуту: `POST /api/internal/scoring/drain` с `{"limit":5}`.
3. На preview/staging включить async flag и выполнить synthetic candidate + employee acceptance: processing → completed, повторный POST без роста revision, очередь без unresolved/expired/mismatch.
4. После приёмки включать постепенно и собрать p50/p95 completion/drain. Результаты локального PGlite не являются performance SLA.
5. Для PERF-017 подтвердить hosting runtime region и Supabase Postgres region, затем разместить preview ближе к БД.

`tests/fixtures/*.sql` остаются локальными stand-ins. Удалённые destructive/downgrade операции и production flags без отдельного решения не выполнять.
