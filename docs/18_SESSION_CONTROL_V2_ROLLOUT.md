# PERF-003 — Атомарное управление сессией и сохранение ответов

## Состояние на 06.09.2026

Реализованы claim, heartbeat, integrity event, autosave/finalize и expiration check
для candidate и employee assessment.
В обычном активном сценарии сервер делает **один Supabase RPC-вызов** вместо цепочки
чтения invitation, чтения session и обновления lease; событие записывается в той же
транзакции. Это сокращение HTTP round trips, а не количества SQL statements внутри БД.

Флаг `SESSION_CONTROL_V2` — server-only, включается только значением `true`, по умолчанию
выключен. Существующие идентификаторы, SHA-256 client/device hashes, 90-секундный lease
и внешний JSON-контракт `/api/assessment/session-control` сохраняются.

Пользователь сообщил о применении миграций. Агент не подключался к удаленной БД и
не проверял установленную версию функций; флаг окружения не переключал.
Ускорение p50/p95 и межсоединительная конкурентность еще не измерены; кодовая часть
готова, но весь PERF-003 пока не считается принятым.

## Границы этой части

- `claim`, `heartbeat`, `event` используют `control_assessment_session_lease_v2`.
- `guardCandidateSessionSubmission` использует тот же V2 heartbeat при включенном флаге.
- `autosave` и finalize ответа используют `save_assessment_answer_v2`, внутри которой
  вызывается lease RPC в той же транзакции. До фиксации ответа сохраняются все блокировки.
- Явный `expire` использует lease RPC как проверку срока; пока срок не вышел, это один RPC.
- `complete` и фактическое завершение/scoring остаются на существующем пути.
- При истекшем deadline RPC не продлевает lease и не пишет событие. Сервер повторно
  проверяет доступ и вызывает существующее завершение по таймеру/scoring. Это редкий
  терминальный путь, для него требование одного RPC не заявляется.
- Внутренние ответы `unavailable`, `terminal`, `expired` преобразуются сервером в
  существующие redirect-ответы, в browser они не передаются.
- При ошибке/неожиданном ответе RPC автоматического повтора через V1 нет: транзакция
  могла уже зафиксироваться. Для отката используется переключение флага.
- Формат ответов, scoring, правила remediation и опубликованные версии не меняются.
  Сохранение ответа и удаление ненужного remediation-ответа теперь атомарны.
  Сохраняется в том числе текущая V1-семантика multiple_choice remediation: этот путь
  не вычисляет новую correctness, значение остается null; это не исправление scoring.

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

Ответы upsert-ятся по `(session_id, question_id)`. SQL проверяет тип и варианты ответа,
required/skipped, one-question порядок, allowBack, captureQuestionTime и remediation.
При одинаковом `order_index` секции и вопросы упорядочиваются дополнительно по ID —
одинаково в SQL и обоих серверных readers. Без allowBack повтор финализированного ответа
возвращает прежний результат, не перезаписывая его. Ошибка сохранения или удаления
remediation откатывает также lease. Сроки повторно проверяются после записей: если
token/deadline истек внутри медленного trigger, изменения откатываются целиком.

Приватный `normalize_assessment_answer_v2` не разрешен даже service_role напрямую —
его вызывает только SECURITY DEFINER save RPC. Ошибки Forced/Multiple Choice передаются
через ограниченный набор машинных кодов; сервер восстанавливает прежние классы/сообщения
HTTP 400, не раскрывая произвольные сообщения PostgreSQL. Остальные ошибки сохраняют
существующий HTTP 500-контракт.

## Локальные проверки

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

На текущем шаге: 306 тестов прошли, typecheck/lint/production build прошли.
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

`tests/assessment-answer-v2-db.test.ts` сравнивает SQL с реальной V1-нормализацией на
44 наборах (все семь типов, частичные/пустые ответы, границы, Unicode). Отдельные сценарии
для обоих scope исполняют существующие Forced/Multiple Choice validators и answer
triggers: retry, запреты редактирования, время ответа, remediation, tenant/token/session
доступ, права RPC, откат при ошибке и истечение срока внутри искусственно медленного trigger.

**Файлы `tests/fixtures/*.sql` предназначены только для `npm test`. Их нельзя запускать
в Supabase SQL Editor или существующей БД. Они создают минимальные тестовые таблицы/роли.**

PGlite использует одно соединение: тест последовательного takeover не доказывает
корректность реального ожидания row locks. Локальный Docker daemon недоступен, поэтому
конкурентный PostgreSQL-прогон пока не выполнен и обязателен перед включением.

## Включение и приемка на staging

1. Сохранить baseline с `SESSION_CONTROL_V2=false` и включенной performance telemetry.
   Использовать synthetic candidate/employee datasets из PERF-001, минимум 30 повторов.
2. На выделенной staging БД применить миграции, включая
   `supabase/migrations/20260906120000_assessment_session_lease_v2.sql`, затем
   `supabase/migrations/20260906130000_assessment_answer_v2.sql`.
   Если они уже применены, выполнить только read-only проверку
   `supabase/verification/assessment_session_control_v2.sql`: все значения `installed`
   и `permissions_ok` должны быть true, а проверки защит save RPC — true.
   Это проверка наличия/прав/ожидаемых маркеров, не замена behavioral-тестов.
   Проверить права RPC через `has_function_privilege`: anon/authenticated — false,
   service_role — true (кроме приватного normalizer). Применение миграций само по себе V2 не включает.
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
   - autosave против takeover/cancel/completion: проигравший запрос не меняет ответы;
   - два одинаковых finalize без allowBack: одна запись, одинаковые результат и feedback;
   - ошибка удаления remediation откатывает основной ответ и lease;
   - ожидание записи ответа до истечения token/deadline не оставляет частичную запись.
   Все тесты — на синтетических данных, не на активных пользовательских сессиях.
4. Задать `SESSION_CONTROL_V2=true` только в серверном staging runtime и перезапустить его.
   Проверить оба flow в двух вкладках, потерю фокуса, восстановление после обрыва сети,
   истечение таймера и переход к следующему тесту, все типы ответов, one-question и section
   режимы, сохранение/очистку ответа и remediation. Autosave теперь тоже использует V2.
5. Сравнить 30+ замеров `assessment.claim`, `assessment.heartbeat`, `assessment.event`,
   `assessment.autosave`, `assessment.expire`
   при одинаковых условиях с baseline. Проверить HTTP trace: один RPC для активных
   операций, без `getAssessmentByToken`/загрузки вопросов. Цель heartbeat p95 ≤500 мс
   и autosave p95 ≤800 мс либо улучшение ≥40% без роста ошибок согласно PERF-003.
6. Записать commit, регион, RTT, объем данных и p50/p95 в `docs/17_PERFORMANCE_BASELINE.md`.
   Только после этих проверок согласовывать production rollout.

## Откат

Установить `SESSION_CONTROL_V2=false` и перезапустить серверный runtime. V1 продолжит
использовать те же session rows/hashes; данные не мигрируются и не удаляются.
RPC можно оставить в БД с server-only правами. Откат схемы для переключения не нужен.

## Продолжение: PERF-004

PERF-004a реализует ограниченное чтение содержимого/ответов активной секции под независимым
флагом. Инструкция: `docs/19_ASSESSMENT_SECTION_READ_ROLLOUT.md`. Минимальный overview и
предзагрузка с мягкой навигацией остаются следующими подзадачами. Приемку PERF-003 на staging
не считать закрытой до фактических замеров и проверки конкурентности.
