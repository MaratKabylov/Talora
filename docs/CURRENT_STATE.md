# Текущее состояние Talvia

Обновлено: 2026-09-18. Ручные веса компетенций убраны из вакансий и оценок сотрудников; competency `fit_score` теперь является равным средним фактически измеренных немотивационных компетенций. Группы показателей в отчётах кандидата и сотрудника свёрнуты по умолчанию; когнитивная сводка показывает итоговые «Обучаемость» и «Внимательность». PERF-012 indexes и DB-часть PERF-015 async scoring ранее применены и проверены в разрешённом текущем Supabase-проекте (`main PRODUCTION`).

## Текущий этап

- **Competency fit:** UI «Веса компетенций» заменён на «Требования к компетенциям» с полями минимума и обязательности. Ручной процент и проверка суммы 100% удалены в candidate/job и employee assessment flows. Мотивационные шкалы не показываются в требованиях и не входят в competency fit.
- `fit_score` считает простое среднее только доступных немотивационных competency percentages; отсутствующие результаты не считаются нулём. `weighted_score` summary rows хранит равную долю компетенции. Employee fallback на `overall_score` удалён.
- **UI отчётов:** `components/reports/assessment-dimensions-report.tsx` — независимые нативные `details/summary` для групп показателей, свёрнутые по умолчанию; стрелка состояния, управление с клавиатуры, видимый фокус. Карточки не растягиваются по высоте соседнего блока. В когнитивной сводке `learning_final` отображается как «Обучаемость» перед `attention_accuracy`; промежуточные learning-метрики остаются в подробностях теста. Код готов; визуальная проверка в браузере и deployment этой правки не выполнены.
- **PERF-012:** установлены восемь индексов для candidate/employee list/comparison и builder parent-order запросов. Remote catalog: `expected_count=8`, `ready_valid_count=8`, `missing_or_invalid=[]`, PostgreSQL 17.6. [Evidence](performance/PERF012_INDEXES_REMOTE_2026-09-13.json).
- Индекс `jobs` не добавлялся: измеренный объём около 121 строки и EXPLAIN не подтвердили пользу. Старый `(company_id, job_id)` индекс applications не удалялся.
- **PERF-015:** установлена durable `scoring_jobs` с RLS, дедупликацией parent/revision, lease claim через `SKIP LOCKED`, пятью попытками с backoff и атомарным queued persistence.
- Remote catalog подтвердил таблицу, RLS, четыре `SECURITY DEFINER` RPC, пустой `search_path`, закрытый direct table access и service-only execute. Queue пуста; expired leases и tenant-parent mismatches — 0. [Evidence](performance/PERF015_ASYNC_QUEUE_REMOTE_2026-09-13.json).
- Completion за флагом `ASSESSMENT_ASYNC_SCORING_V2`: enqueue возвращает `processing`, Next `after()` делает best-effort drain, client выполняет bounded polling, отдельный protected endpoint предназначен для scheduler.
- Флаг по умолчанию выключен. Синхронный completion остаётся рабочим rollback path.

## Реализация и безопасность

- Таблицы `job_competency_weights` и `employee_assessment_competency_weights` сохранены как совместимый слой для minimum/required; legacy `weight` записывается как `1`, но scoring его не читает. Миграции и удалённая БД не менялись. Уже сохранённые отчёты сохраняют прежний `fit_score` до явного пересчёта.
- Миграции: `20260912150000_perf012_confirmed_query_indexes.sql` и `20260912160000_perf015_async_scoring_jobs.sql`; применены через Supabase SQL Editor, поэтому remote migration ledger отдельно не подтверждён.
- Worker использует случайный UUID, ограничивает batch/lease, не возвращает job IDs, SQL, PII или raw errors. Просроченную lease может забрать другой worker; старый worker после expiry не может завершить job.
- Enqueue сам выводит `company_id` из parent, проверяет завершённость session rows и привязывает invitation. Клиентский `company_id` не принимается.
- Parent, invitation, scoring snapshot, revision и job завершаются одной транзакцией. Terminal retry требует явного действия.
- `/api/internal/scoring/drain` принимает только POST, проверяет 32+ character bearer secret через SHA-256/timing-safe comparison и возвращает безопасные агрегаты.
- Отдельное отображение terminal failure для HR/admin остаётся rollout follow-up; состояние доступно в operational verification без PII.
- [Security notes](06_RLS_AND_SECURITY_NOTES.md), [rollout](37_PERF012_INDEXES_AND_PERF015_ASYNC_SCORING_ROLLOUT.md), [baseline §40](17_PERFORMANCE_BASELINE.md).

## Проверки

- Текущие изменения (2026-09-18): `npm run lint`, `npm run typecheck`, `npm run build` — успешно; профильный `assessment-results` — **20/20**, полный `npm test` — **524/524**.
- Предыдущая полная регрессия (2026-09-14): `npm test` — **524/524**; профильная scoring/forms регрессия — **54/54**.
- PGlite исполняет обе реальные миграции и verification SQL. Покрыты idempotent DDL, tenant isolation, service-only grants, dedup, lease exclusivity/expiry/takeover, bounded retry, explicit terminal retry и rollback атомарной транзакции.
- Подключённый Chrome: navigation suite **30/30**, включая automatic completion polling, manual retry и recovery без дублирования записи.
- Local production async acceptance на текущем Supabase: **40/40** для candidate и employee; первый ответ `processing`, polling до результата, неверный worker secret отклонён, retry сохранил revision 1, оба invitation expired. [Evidence](performance/PERF015_ASYNC_LOCAL_ACCEPTANCE_2026-09-13.json).
- `git diff --check`: успешно; только предупреждения Git о переводе LF в CRLF на Windows.
- PERF-014 ранее принят на текущем Supabase: staging scoring **30/30**, final integrity без tenant/session/stale mismatches. Исторические пять missing dimension rows обслуживаются bounded fallback.
- PERF-017 local production/runtime и candidate browser E2E ранее прошли; точные hosting/Supabase regions и production-like latency остаются неизвестны.

## Следующий шаг

Для UI: проверить в браузере отчёты кандидата и сотрудника — все группы должны стартовать свёрнутыми, а при наличии завершённых learning/attention тестов когнитивный блок должен показывать «Обучаемость» и «Внимательность», включая узкий экран.

1. Если появится внешний hosting, развернуть код с server-only `SCORING_WORKER_SECRET`, затем включить `ASSESSMENT_ASYNC_SCORING_V2` после preview smoke.
2. Для постоянного внешнего запуска настроить scheduler раз в минуту: `POST /api/internal/scoring/drain` с `{"limit":5}`. Локальная проверка использовала временный secret, который удалён.
3. После deployment собрать p50/p95 completion/drain. Текущие числа относятся к локальному Next runtime и не являются production SLA.
4. Для PERF-017 подтвердить hosting runtime region и Supabase Postgres region, затем разместить preview ближе к БД.

`tests/fixtures/*.sql` остаются локальными stand-ins. Удалённые destructive/downgrade операции и production flags без отдельного решения не выполнять.
