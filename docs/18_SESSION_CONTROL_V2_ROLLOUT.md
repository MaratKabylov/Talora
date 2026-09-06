# PERF-003a — Атомарное управление lease

## Состояние на 06.09.2026

Реализованы claim, heartbeat и integrity event для candidate и employee assessment.
В обычном активном сценарии сервер делает **один Supabase RPC-вызов** вместо цепочки
чтения invitation, чтения session и обновления lease; событие записывается в той же
транзакции. Это сокращение HTTP round trips, а не количества SQL statements внутри БД.

Флаг `SESSION_CONTROL_V2` — server-only, включается только значением `true`, по умолчанию
выключен. Существующие идентификаторы, SHA-256 client/device hashes, 90-секундный lease
и внешний JSON-контракт `/api/assessment/session-control` сохраняются.

Изменение еще не применялось к рабочей БД и не включалось на staging/production.
Ускорение p50/p95 не измерено; весь PERF-003 пока не считается завершенным.

## Границы этой части

- `claim`, `heartbeat`, `event` используют `control_assessment_session_lease_v2`.
- `guardCandidateSessionSubmission` использует тот же V2 heartbeat при включенном флаге.
- `autosave`, finalize ответа, complete и явный `expire` остаются на V1.
- При истекшем deadline RPC не продлевает lease и не пишет событие. Сервер повторно
  проверяет доступ и вызывает существующее завершение по таймеру/scoring. Это редкий
  терминальный путь, для него требование одного RPC не заявляется.
- Внутренние ответы `unavailable`, `terminal`, `expired` преобразуются сервером в
  существующие redirect-ответы, в browser они не передаются.
- При ошибке/неожиданном ответе RPC автоматического повтора через V1 нет: транзакция
  могла уже зафиксироваться. Для отката используется переключение флага.
- Поля ответов кандидата, scoring, remediation и опубликованные версии не меняются.

## Безопасность и блокировки

RPC имеет `SECURITY DEFINER`, пустой `search_path`; исполнение разрешено только
`service_role`, отозвано у PUBLIC, anon и authenticated. Token/PII/DB errors не логируются
новым адаптером, браузер не получает server credentials или внутренние данные.

Имена таблиц выбираются из двух фиксированных наборов; входные значения передаются как
SQL-параметры. Проверяются company/owner invitation, принадлежность session и question
версии теста, статус invitation/session, сроки и client/device hashes.

Порядок блокировок: owner `FOR KEY SHARE` → invitation `FOR SHARE` → session `FOR UPDATE`.
Owner берется первым из-за FK-проверки при вставке события: иначе возможен цикл с
отменой оценки, которая уже держит owner `FOR UPDATE` и ожидает invitation. Invitation
повторно читается после получения owner lock. Время проверяется через `clock_timestamp()`
после получения session lock, чтобы ожидание блокировки не продлевало просроченный доступ.
Семантика блокировок описана в [PostgreSQL 17](https://www.postgresql.org/docs/17/explicit-locking.html).

События дедуплицируются по `(session_id, client_event_id)`. Разрешенные client event types
перечислены явно, reserved types нельзя прислать через `event`. Из metadata сохраняется
только числовой `durationMs` для `focus_returned`, округленный и ограниченный 0…86400000.

## Локальные проверки

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

На текущем шаге: 228 тестов прошли, typecheck/lint/production build прошли.
Build выполнялся на версии Next.js 16.3.1 из существующего lockfile.

`tests/session-control-v2-db.test.ts` исполняет реальные candidate/employee integrity
миграции и новую RPC в [PGlite](https://pglite.dev/docs/), добавленном как dev dependency.
Используется минимальная схема зависимостей `tests/fixtures/session-control-v2.sql`.
Проверяются hashes, claim/takeover, чужие client/device/token/session/question, tenant
связь, сроки, терминальные состояния, очистка metadata, retry, откат при ошибке события
и права исполнения. Это не проверка всех миграций/RLS production Supabase.

`tests/session-control-v2.test.ts` исполняет реальный серверный адаптер и session-control
с имитацией Supabase transport: один RPC на активную операцию, оба scope, flag on/off,
сохранение JSON-контракта, обработка истечения срока, отсутствие V1 retry при ошибке RPC.

PGlite использует одно соединение: тест последовательного takeover не доказывает
корректность реального ожидания row locks. Локальный Docker daemon недоступен, поэтому
конкурентный PostgreSQL-прогон пока не выполнен и обязателен перед включением.

## Включение и приемка на staging

1. Сохранить baseline с `SESSION_CONTROL_V2=false` и включенной performance telemetry.
   Использовать synthetic candidate/employee datasets из PERF-001, минимум 30 повторов.
2. На выделенной staging БД применить миграции, включая
   `supabase/migrations/20260906120000_assessment_session_lease_v2.sql`.
   Проверить права RPC через `has_function_privilege`: anon/authenticated — false,
   service_role — true. Применение миграции само по себе V2 не включает.
3. На двух отдельных PostgreSQL-соединениях проверить оба scope:
   - два разных клиента одновременно claim-ят свободную сессию: только один active;
   - takeover истекшего lease против heartbeat прежнего клиента: единственный владелец,
     последующий запрос от проигравшего blocked;
   - открытая транзакция удерживает session lock до истечения deadline/token, затем
     ожидающий heartbeat/claim не обновляет lease;
   - claim/event одновременно с `cancel_candidate_assessment` / `cancel_employee_assessment`:
     нет deadlock, после отмены новые запросы не возобновляют сессию;
   - принудительная ошибка вставки события откатывает обновление lease;
   - повтор одного `clientEventId` не создает второй event.
   Все тесты — на синтетических данных, не на активных пользовательских сессиях.
4. Задать `SESSION_CONTROL_V2=true` только в серверном staging runtime и перезапустить его.
   Проверить оба flow в двух вкладках, потерю фокуса, восстановление после обрыва сети,
   истечение таймера и переход к следующему тесту. Autosave пока продолжает работать на V1.
5. Сравнить 30+ замеров `assessment.claim`, `assessment.heartbeat`, `assessment.event`
   при одинаковых условиях с baseline. Проверить HTTP trace: один RPC для активных
   операций, без `getAssessmentByToken`/загрузки вопросов. Цель heartbeat p95 ≤500 мс
   либо улучшение ≥40% без роста ошибок согласно PERF-003.
6. Записать commit, регион, RTT, объем данных и p50/p95 в `docs/17_PERFORMANCE_BASELINE.md`.
   Только после этих проверок согласовывать production rollout.

## Откат

Установить `SESSION_CONTROL_V2=false` и перезапустить серверный runtime. V1 продолжит
использовать те же session rows/hashes; данные не мигрируются и не удаляются.
RPC можно оставить в БД с server-only правами. Откат схемы для переключения не нужен.

## Следующий шаг: PERF-003b

Перенести autosave/finalize и expiration check в атомарный DB-путь, сохранив текущие
правила single/multiple/forced choice, scale, ordering/matching, open text, skipped,
one-question order, allowBack, captureQuestionTime и remediation. Проверять паритет
V1/V2 на одинаковых ответах и невозможность записи после takeover/deadline/completion.
Scoring менять не требуется.
