# PERF-012 indexes и PERF-015 async scoring rollout

Обновлено: 13.09.2026. Обе миграции применены через SQL Editor в разрешённом текущем Supabase-проекте (`main PRODUCTION`). Приложение, scheduler и feature flag ещё не развёрнуты.

Remote verification: PERF-012 — 8/8 индексов ready/valid, PERF-015 — таблица/RLS/RPC/grants полностью прошли, очередь пуста и tenant mismatches отсутствуют. [Индексы](performance/PERF012_INDEXES_REMOTE_2026-09-13.json), [очередь](performance/PERF015_ASYNC_QUEUE_REMOTE_2026-09-13.json).

## Что меняется

- PERF-012 добавляет восемь индексов для измеренных list/comparison/builder query shapes. Индекс `jobs` не входит:
  измеренный staging объём около 121 строки и EXPLAIN не подтвердили пользу.
- PERF-015 добавляет service-only `scoring_jobs`, дедупликацию по `(scope, parent_id, expected_revision)`, lease claim
  через `FOR UPDATE SKIP LOCKED`, пять попыток с bounded backoff и атомарное завершение snapshot/parent/invitation/job.
- Completion при включённом флаге ставит job и сразу возвращает `processing`. Next `after()` запускает best-effort
  drain, client делает bounded polling. Надёжные retries обеспечивает отдельный scheduler.

## Порядок staging rollout

1. Применить `20260912150000_perf012_confirmed_query_indexes.sql`.
2. Выполнить read-only `perf012_confirmed_query_indexes.sql`: `expected_count=8`, `ready_valid_count=8`,
   `missing_or_invalid=[]`. Повторить сохранённые PERF-012 EXPLAIN для list/comparison/builder shapes. Старый
   `(company_id, job_id)` индекс пока не удалять.
3. Применить `20260912160000_perf015_async_scoring_jobs.sql`.
4. Выполнить read-only `perf015_async_scoring_jobs.sql`: все catalog/privilege checks `true`,
   `tenant_parent_mismatches=0`; до включения queue обычно пуста.
5. Развернуть приложение с `ASSESSMENT_ASYNC_SCORING_V2=false` и случайным `SCORING_WORKER_SECRET` длиной 32+
   символов. Секрет остаётся только на сервере.
6. Настроить scheduler раз в минуту: `POST /api/internal/scoring/drain`, заголовок
   `Authorization: Bearer <SCORING_WORKER_SECRET>`, JSON `{"limit":5}`. Успешный ответ содержит только счётчики
   `claimed/completed/retried/failed/unresolved`.
7. Включить `ASSESSMENT_ASYNC_SCORING_V2=true` на staging и перезапустить runtime.

## Приёмка

- Завершить по одному synthetic candidate и employee assessment. Первый ответ completion — `processing`, затем
  polling приводит к scoped `/complete` только после сохранения результата.
- Для каждого parent/revision существует один job; двойной POST не увеличивает scoring revision повторно.
- Parent, invitation, job и scoring snapshot становятся completed в одной транзакции.
- Ошибка scoring переводит job в `retry`, просроченная lease восстанавливается другим worker; после пяти попыток
  статус `failed`, ручной retry явно сбрасывает только этот terminal job.
- Verification показывает `expired_leases=0`, `tenant_parent_mismatches=0`, `unresolved=0`. В логах нет token/PII/SQL.
- Повторить candidate/employee report и comparison acceptance: score/revision/dimensions совпадают с sync path.

## Откат

При проблеме выключить `ASSESSMENT_ASYNC_SCORING_V2` и перезапустить приложение. Синхронный completion path остаётся
в коде. Таблицу и индексы не удалять: это destructive rollback. Перед остановкой scheduler дождаться
`pending/retry/processing=0` или оставить drain включённым до опустошения очереди.

## Локальная проверка

PGlite выполняет обе реальные миграции. Проверены idempotent index install, определения всех восьми индексов,
service-only RPC, tenant/parent/invitation binding, deduplication, lease expiry/takeover, bounded terminal retry,
explicit retry и rollback всего queued snapshot при ошибке invitation update. TypeScript, lint, production build,
полный suite и browser navigation фиксируются в `CURRENT_STATE.md` после финального прогона.
