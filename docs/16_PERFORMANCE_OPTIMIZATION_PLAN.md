# План и техническое задание по оптимизации производительности Talvia

## 1. Назначение документа

Документ описывает работы по ускорению Talvia без изменения продуктовой логики, модели
скоринга и правил безопасности. Он предназначен для декомпозиции в backlog и передачи
задач в разработку.

Работы выполняются итерационно. Каждый следующий этап начинается после получения
измеримого результата предыдущего этапа.

## 2. Исходное состояние

На момент подготовки плана:

- production build, typecheck и lint проходят;
- проходят 185 автоматических тестов;
- основные пользовательские маршруты рендерятся динамически;
- серверная пагинация в dashboard-списках отсутствует;
- candidate/employee assessment flow выполняет несколько последовательных HTTP-запросов
  к Supabase на одно действие;
- конструктор загружает полное содержимое всех доступных источников импорта и сохраняет
  весь документ теста;
- отчеты загружают summary, подробные ответы и integrity events до первого отображения;
- фактические production p50/p95 и планы SQL-запросов не зафиксированы.

Главная рабочая гипотеза: основная задержка создается не размером клиентского bundle, а
последовательными сетевыми обращениями к Supabase, избыточными выборками и крупными
React-деревьями конструктора.

## 3. Цели

1. Сократить количество последовательных обращений к БД в assessment flow.
2. Сделать время загрузки списков предсказуемым при росте данных.
3. Устранить полную перезагрузку страницы при переходе между секциями теста.
4. Уменьшить начальную загрузку и стоимость повторного рендера конструктора.
5. Показывать основную часть отчета без ожидания подробных ответов и журнала событий.
6. Создать наблюдаемость, позволяющую сравнить производительность до и после изменений.

## 4. Не входит в объем работ

- изменение алгоритмов и результатов scoring;
- изменение рекомендаций, fit score, overall score и интерпретаций;
- ослабление token validation, RLS или tenant isolation;
- изменение структуры опубликованных версий тестов;
- редизайн интерфейса;
- миграция на другую БД или отказ от Supabase;
- добавление Redis до подтверждения необходимости измерениями.

## 5. Обязательные инварианты

- Результат scoring до и после оптимизации должен быть идентичным для одинакового набора
  ответов.
- Кандидат и сотрудник продолжают проходить тест без регистрации по invitation token.
- Опубликованное содержимое теста остается неизменяемым.
- Все tenant-запросы ограничиваются `company_id` и действующими правилами доступа.
- Server secret/service role key не передается в browser.
- Token, ответы, PII и server credentials не попадают в логи или telemetry.
- Операции сохранения ответа и изменения lease должны оставаться атомарными.
- Повтор запроса не должен создавать дубли ответов, событий или результатов.

## 6. Целевые показатели

Итоговые значения фиксируются после PERF-001. До получения baseline используются
следующие целевые ориентиры для staging, расположенного рядом с production БД:

| Сценарий | Цель |
| --- | --- |
| Сохранение ответа, p95 | не более 800 мс |
| Heartbeat сессии, p95 | не более 500 мс |
| Переход к следующему вопросу без scoring, p95 | не более 500 мс |
| Переход между секциями | без полной перезагрузки документа |
| Dashboard list TTFB, p95 | не более 1 000 мс |
| Отображение summary отчета, p95 | не более 1 500 мс |
| Реакция конструктора на ввод, INP | не более 200 мс |
| Автосохранение конструктора, p95 | не более 1 500 мс |

Если текущая инфраструктура не позволяет достигнуть абсолютной цели, обязательный
критерий — улучшение p95 не менее чем на 40% для соответствующего сценария без ухудшения
ошибок и корректности.

## 7. Набор данных для приемочного теста

Проверка выполняется на обезличенном synthetic dataset:

- не менее 1 000 applications в одной компании;
- не менее 200 applications в одной вакансии;
- не менее 100 employee assessment participants в одной оценке;
- тест из 100 вопросов и не менее 400 вариантов ответа;
- отчет с 300 ответами и 500 integrity events;
- не менее 50 test templates и 100 опубликованных test versions;
- не менее 30 assessment packages.

Должны быть отдельно измерены cold start и warm execution. В итоговый отчет попадают
минимум 30 повторов каждого основного сценария.

## 8. План реализации

### Этап 0. Baseline и наблюдаемость

#### PERF-001 — Инструментирование ключевых сценариев

**Задача**

Добавить измерение продолжительности серверных операций и клиентских действий.

**Технические требования**

- Измерять отдельно:
  - получение auth/company context;
  - list queries для jobs, candidates, tests, packages и employee assessments;
  - загрузку report summary и report details;
  - assessment claim, heartbeat, autosave, event и completion;
  - scoring calculation и persistence;
  - загрузку и автосохранение конструктора.
- Добавить `Server-Timing` там, где это возможно, и структурированные server logs.
- На клиенте фиксировать Web Vitals, время soft navigation и autosave.
- В Supabase собрать данные `pg_stat_statements` и планы наиболее медленных запросов через
  `EXPLAIN (ANALYZE, BUFFERS)`.
- Не включать в labels и сообщения token, email, имя, телефон, текст ответа или UUID
  кандидата.

**Результат**

- документ с baseline p50/p95;
- список 10 наиболее дорогих SQL-запросов;
- количество SQL/HTTP round trips для каждого критического сценария;
- подтверждение региона приложения и региона Supabase.

**Критерии приемки**

- Метрики доступны для staging.
- Один request можно проследить по безопасному correlation ID.
- Ошибки telemetry не влияют на пользовательский сценарий.
- Зафиксирован отчет «до оптимизации».

#### PERF-002 — Ограничение области действия Next.js proxy

**Задача**

Не выполнять обновление Supabase Auth session для публичных token-маршрутов и API
управления assessment session.

**Технические требования**

- Proxy должен обрабатывать только маршруты, которым действительно нужна HR/platform
  auth session.
- Обязательно исключить:
  - `/assessment/:path*`;
  - `/employee-assessment/:path*`;
  - `/api/assessment/session-control`;
  - публичные static/API endpoints, не использующие Supabase Auth.
- Сохранить refresh cookies для dashboard, admin, onboarding и company invitation flow.

**Критерии приемки**

- Candidate и employee flow работают без auth cookie.
- Dashboard продолжает обновлять истекшую auth session.
- Один autosave не вызывает auth-проверку в proxy.
- Добавлены route-level тесты matcher/skip logic.

### Этап 1. Assessment flow

#### PERF-003 — Атомарные RPC для session control

**Задача**

Сократить обычное сохранение ответа с нескольких последовательных запросов к Supabase до
одного RPC-вызова из route handler.

**Объем**

Реализовать одинаковый контракт для candidate и employee assessment:

- claim session;
- heartbeat;
- autosave/finalize answer;
- integrity event;
- expiration check.

**Рекомендуемые RPC**

Допускается одна dispatch-функция либо несколько узких функций:

```text
control_assessment_session_v2(
  p_scope,
  p_token,
  p_session_id,
  p_client_id,
  p_device_id,
  p_operation,
  p_payload
) -> jsonb
```

Либо:

```text
claim_assessment_session_v2(...)
touch_assessment_session_v2(...)
save_assessment_answer_v2(...)
record_assessment_event_v2(...)
```

**Требования к RPC**

- Выполнение в одной транзакции.
- Блокировка изменяемой session row через `FOR UPDATE`.
- Проверка invitation token, статуса, срока действия и связи с session owner.
- Проверка `test_version_id`, section и question ownership.
- Проверка lease/client/device hashes.
- Серверная валидация типа и допустимых вариантов ответа.
- Идемпотентный upsert по `(session_id, question_id)`.
- Идемпотентная запись event по `(session_id, client_event_id)`.
- Поддержка remediation без дополнительных запросов из Node.js.
- Возврат только необходимых полей:
  `status`, `deadlineAt`, `savedAt`, `answerIsCorrect`, `incorrectFeedback`,
  `redirectTo` или `retryAfterSeconds`.
- `SECURITY DEFINER`, `set search_path = ''`, полные schema-qualified имена.
- Отозвать execute у `public`, `anon` и `authenticated`, если RPC вызывается только через
  server-only admin client.

**Совместимость**

- Внешний JSON-контракт `/api/assessment/session-control` сохраняется.
- Переключение на V2 выполняется через feature flag `SESSION_CONTROL_V2`.
- Существующий путь остается временным fallback до завершения rollout.

**Критерии приемки**

- Обычный autosave использует один RPC-вызов.
- Heartbeat использует один RPC-вызов.
- Результаты validation совпадают с существующей реализацией.
- Конкурентная вкладка блокируется как раньше.
- Retry не создает дубликаты.
- Есть integration-тесты для candidate и employee scope.
- Есть тесты истекшего token, чужого question ID, завершенной session и гонки lease.

#### PERF-004 — Section-scoped чтение assessment content

**Задача**

Не загружать все секции, вопросы и ответы при каждом открытии или переходе.

**Технические требования**

- Разделить данные на:
  - минимальный assessment/session overview;
  - список секций с ID, порядком и количеством вопросов;
  - содержимое активной секции;
  - ответы только активной секции.
- Добавить server-only endpoint/RPC для загрузки секции.
- Предзагружать следующую секцию после открытия текущей.
- Не передавать scoring keys, points, `is_correct` и competency effects в browser.
- Не менять детерминированный shuffle вариантов.

**Критерии приемки**

- Объем начального ответа не растет пропорционально общему количеству вопросов теста.
- В browser отсутствуют правильные ответы и scoring metadata.
- Повторное открытие текущей секции восстанавливает сохраненные ответы.

#### PERF-005 — Мягкая навигация внутри теста

**Задача**

Исключить `window.location.assign` при переходе между вопросами и секциями.

**Технические требования**

- `AssessmentTestSession` остается смонтированным между секциями.
- Текущая секция и вопрос меняются client state либо soft navigation.
- URL секции обновляется через router/history без reload документа.
- Перед переходом обязательный ответ должен быть подтвержден сервером.
- При сетевой ошибке введенный ответ остается на экране.
- Back/forward behavior должен быть определен тестами и учитывать `allowBack`.

**Критерии приемки**

- В Playwright/browser test переход между секциями не создает document navigation.
- Не выполняется повторная загрузка company/job/package overview.
- Timer и active lease не сбрасываются.
- Candidate и employee используют одну реализацию.

### Этап 2. Конструктор тестов

#### PERF-006 — Ленивые источники импорта

**Задача**

Убрать загрузку полного содержимого всех опубликованных тестов при открытии конструктора.

**Технические требования**

- Начальный запрос возвращает только:
  `templateId`, `versionId`, `templateTitle`, `versionNumber`, `questionCount`.
- Sections/questions/options выбранного источника загружаются только после действия
  пользователя «Загрузить источник».
- Результат выбранного immutable `test_version_id` допускается кэшировать по version ID.
- Для больших источников UI показывает loading/error/retry state.

**Критерии приемки**

- Открытие конструктора не загружает content других test versions.
- В network trace отсутствуют options/questions источников до выбора версии.
- Импорт дает тот же BuilderDocument, что и текущая реализация.

#### PERF-007 — Декомпозиция и оптимизация React-редактора

**Задача**

Снизить стоимость ввода и повторного рендера большого теста.

**Технические требования**

- Выделить memoized-компоненты `SectionEditor`, `QuestionEditor`, `OptionEditor`.
- Изменение одного option не должно рендерить остальные вопросы.
- При первом открытии развернут только первый/активный вопрос.
- Для длинных тестов использовать windowing либо `content-visibility` после измерения.
- Drag state не должен обновлять весь документ на каждый pointer event.
- Сохранить keyboard accessibility и существующие aria attributes.

**Критерии приемки**

- React Profiler подтверждает локальный rerender измененного узла.
- На тесте из 100 вопросов INP соответствует разделу 6.
- Все операции create/copy/delete/move продолжают работать.

#### PERF-008 — Инкрементальное атомарное автосохранение

**Задача**

Не отправлять и не upsert-ить весь тест после каждого изменения.

**Технические требования**

- Добавить persistent revision для draft test version либо надежный optimistic lock по
  `updated_at`.
- Клиент хранит набор dirty/deleted entity IDs.
- За один debounce отправляется только version patch и измененные/удаленные
  sections/questions/options.
- Сервер применяет batch одной транзакционной RPC.
- RPC повторно проверяет ownership и статус `draft`.
- При revision conflict сервер не перезаписывает более новую версию и возвращает
  конфликт с инструкцией reload/merge.
- Debounce 1,5–2,5 секунды, один in-flight save, объединение следующих изменений.
- Retry с bounded exponential backoff; статус dirty сохраняется до подтверждения.
- Перед publish выполняется flush pending changes.

**Критерии приемки**

- Изменение одного option не отправляет остальные вопросы.
- Частичная ошибка не оставляет документ в промежуточном состоянии.
- Два редактора не могут молча перезаписать изменения друг друга.
- Publication всегда использует последнюю подтвержденную revision.
- Добавлены integration-тесты rollback и revision conflict.

#### PERF-009 — Атомарное клонирование версии

**Задача**

Заменить N+1 insert sections/questions/options при создании draft из published version.

**Технические требования**

- Реализовать server-only RPC одной транзакцией.
- Использовать set-based `INSERT ... SELECT` и таблицы соответствия old ID → new ID.
- Корректно перенести remediation links, structured matching target IDs и settings.
- При ошибке не оставлять пустую или частично заполненную draft version.

**Критерии приемки**

- Одна RPC создает полную draft version.
- Структурное сравнение исходника и копии проходит для всех типов вопросов.
- Время клонирования теста из 100 вопросов укладывается в 2 секунды на staging.

### Этап 3. Dashboard-списки и SQL

#### PERF-010 — Легкие list read models

**Задача**

Отделить DTO списков от DTO detail-страниц.

**Требуемые read models**

- Jobs: только поля таблицы списка и package title.
- Candidates/applications: application, candidate summary, job summary и только последнее
  invitation.
- Tests: template summary, latest version и version count без description/instructions.
- Packages: package summary и test count без полного списка test versions.
- Employee assessments: агрегированные participant/completed counts и average fit.
- Comparison: серверные filters, sort и page cursor.

Реализация допускается через SQL views, security-definer RPC или прямые PostgREST-запросы,
если сохраняется RLS и отсутствует overfetching.

**Критерии приемки**

- List routes не получают rich text, scoring JSON и полные дочерние коллекции.
- Employee assessment list не загружает строки всех participants.
- Candidate list не загружает всю историю invitations.
- SQL snapshot/contract tests фиксируют форму read model.

#### PERF-011 — Cursor pagination и серверные фильтры

**Технические требования**

- Размер страницы по умолчанию — 50, допустимый максимум — 100.
- Использовать keyset cursor `(sort_column, id)`, а не offset для больших таблиц.
- Cursor кодируется и валидируется на сервере.
- Фильтры и сортировка применяются до `limit` в PostgreSQL.
- URL хранит filter/sort/cursor state.
- Empty/loading/error states сохраняются.

**Маршруты первой очереди**

- `/dashboard/candidates`;
- `/dashboard/jobs/[id]/candidates`;
- `/dashboard/jobs/[id]/compare`;
- `/dashboard/employee-assessments/[id]`;
- `/dashboard/employee-assessments/[id]/compare`;
- `/dashboard/jobs`, `/dashboard/tests`, `/dashboard/packages`;
- admin companies, applications, users и audit.

**Критерии приемки**

- Приемочный dataset не загружается целиком ни на одном list route.
- Нет повторов или пропусков при переходе между страницами с одинаковой датой сортировки.
- Tenant filter включен в каждый запрос.

#### PERF-012 — Индексы под подтвержденные запросы

**Предварительные кандидаты**

```sql
create index ... on test_sections(test_version_id, order_index);
create index ... on questions(section_id, order_index);
create index ... on answer_options(question_id, order_index);
create index ... on jobs(company_id, updated_at desc, id);
create index ... on candidate_applications(company_id, created_at desc, id);
create index ... on candidate_applications(company_id, job_id, fit_score desc, completed_at desc, id);
create index ... on employee_assessment_participants(employee_assessment_id, fit_score desc, completed_at desc, id);
```

Для поиска `ILIKE '%text%'` рассмотреть `pg_trgm` и GIN index.

**Технические требования**

- Каждый индекс должен быть обоснован production-like `EXPLAIN`.
- Проверить существующие unique/composite indexes и не создавать дубликаты.
- Оценить write amplification и размер индекса.
- Для больших production-таблиц подготовить безопасный deployment без длительной
  блокировки записи.

**Критерии приемки**

- До/после приложены планы запросов и фактическое время.
- Нет дублирующих индексов.
- Производительность autosave/upsert не ухудшилась более чем на 10%.

### Этап 4. Отчеты и сравнение

#### PERF-013 — Разделение report summary и details

**Задача**

Показывать основную оценку без ожидания всех answers и integrity events.

**Технические требования**

- Первый запрос возвращает candidate/employee summary, scores, recommendation, risks,
  groups и highlights.
- Answers загружаются отдельным server component/API с пагинацией по 50 строк.
- Integrity events загружаются отдельно с пагинацией по 100 строк.
- Использовать отдельные Suspense boundaries и skeleton для подробных секций.
- Получать logical test title без последовательных запросов version → template.
- Не выполнять scoring при чтении отчета.

**Критерии приемки**

- Summary отображается до завершения загрузки answers/events.
- В исходный RSC/HTML payload не входят все answers/events.
- Пагинация сохраняет порядок секций, вопросов и событий.
- Candidate и employee reports используют одинаковую модель отображения dimensions.

#### PERF-014 — Материализованные dimension scores для comparison

**Задача**

Не вычислять comparison путем чтения всех `scoring_result_json` каждого участника.

**Технические требования**

- При scoring сохранять нормализованные dimension rows для employee participant.
- Минимальные поля:
  `company_id`, `employee_assessment_id`, `participant_id`, `session_id`,
  `test_version_id`, `dimension_key`, `group_key`, `title`, `percentage`,
  `interpretation_direction`, `scoring_revision`.
- Уникальность должна предотвращать дубли одного dimension в одной scoring revision.
- Persistence входит в существующий атомарный scoring snapshot.
- Comparison читает participants и dimensions по assessment ID с pagination.
- Recalculation заменяет предыдущий актуальный snapshot атомарно.

**Критерии приемки**

- Comparison не читает `scoring_result_json` всех участников.
- Результаты совпадают с текущим `collectAssessmentDimensions` на regression fixtures.
- Tenant isolation подтверждена отдельным security test.

### Этап 5. Завершение и scoring

#### PERF-015 — Оптимизация completion pipeline

**Первая итерация**

- Устранить повторные загрузки assessment overview.
- Передавать уже подтвержденные IDs/config в scoring pipeline.
- Сохранить атомарный scoring persistence RPC.
- Измерять calculation и persistence отдельно.

**Условная вторая итерация**

Выполняется только если после первой итерации completion p95 превышает 2 секунды.

- Добавить durable `scoring_jobs` с уникальным активным job на parent/revision.
- Completion фиксирует session и ставит job в очередь.
- Пользователь сразу переходит на страницу «Результат рассчитывается».
- Worker выполняет scoring с retry и idempotency.
- UI получает статус polling/revalidation с увеличивающимся интервалом.
- Ошибка scoring видна HR/admin и доступна для безопасного retry.

Не использовать недолговечный fire-and-forget process без durable job record.

**Критерии приемки**

- Двойное завершение не запускает два scoring snapshot.
- Candidate не видит ложный статус completed до фиксации результата.
- Recalculation и normal completion используют совместимую persistence-модель.

### Этап 6. Кэширование и инфраструктура

#### PERF-016 — Безопасное кэширование immutable/reference data

**Разрешено кэшировать**

- опубликованное содержимое конкретного `test_version_id`;
- системные города и другие редко меняющиеся справочники;
- import schema;
- metadata системных тестов и пакетов с tag invalidation.

**Не кэшировать как shared data**

- invitation/token state;
- session lease/deadline;
- candidate/employee answers;
- tenant-private lists без company-scoped key и проверки доступа;
- scoring job state.

**Критерии приемки**

- Cache key содержит immutable version ID или company scope.
- После admin changes вызывается tag invalidation.
- Security tests не обнаруживают cross-tenant cache leakage.

#### PERF-017 — Проверка размещения и local development

**Технические требования**

- Зафиксировать регион Next.js runtime и Supabase Postgres.
- По возможности разместить application compute рядом с БД.
- Сравнить production server и dev mode; dev mode не использовать для продуктового SLA.
- Добавить в README рекомендацию хранить рабочую копию вне синхронизируемой OneDrive
  директории, если синхронизация `.next`/`node_modules` замедляет Windows-разработку.

## 9. Последовательность поставки

Рекомендуемый порядок:

1. PERF-001 и PERF-002.
2. PERF-003, PERF-004, PERF-005.
3. PERF-006, PERF-007, PERF-008, PERF-009.
4. PERF-010, PERF-011, PERF-012.
5. PERF-013 и PERF-014.
6. PERF-015 только по результатам измерений.
7. PERF-016 и PERF-017 параллельно с соответствующими этапами.

Assessment flow имеет высший приоритет, поскольку задержка непосредственно влияет на
кандидатов и риск потери ответов. После него приоритет отдается конструктору, затем
dashboard и отчетам.

## 10. Стратегия rollout

- Все крупные изменения включаются сначала на staging.
- Для session control, builder save и новых report read models используются независимые
  feature flags:
  - `SESSION_CONTROL_V2`;
  - `BUILDER_SAVE_V2`;
  - `REPORT_READ_MODEL_V2`.
- Новые переменные добавляются только в `.env.example`, без реальных значений.
- После staging проводится smoke/load test и сравнение baseline.
- Production rollout: внутренние пользователи → ограниченная доля компаний → 100%.
- Старый путь удаляется только после стабильной работы V2 и проверки rollback procedure.

## 11. Проверки после каждого этапа

Обязательные команды:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Дополнительно:

- SQL migration tests;
- multi-tenant/RLS regression tests;
- integration tests candidate и employee flow;
- concurrency tests lease/autosave/revision;
- browser tests soft navigation и сохранения введенных данных;
- performance benchmark на dataset из раздела 7.

## 12. Definition of Done программы оптимизации

Программа считается завершенной, если:

- опубликован отчет с baseline и результатами после оптимизации;
- целевые p95 достигнуты либо есть документированное инфраструктурное ограничение;
- autosave и heartbeat assessment используют один RPC каждый;
- переход между секциями не выполняет document reload;
- конструктор не загружает все источники импорта при открытии;
- изменение одного элемента не сохраняет весь BuilderDocument;
- основные list routes используют server pagination и облегченные DTO;
- report summary не блокируется answers и integrity events;
- comparison не строится чтением всех scoring JSON;
- typecheck, lint, tests и production build проходят;
- security/RLS regression tests проходят;
- отсутствуют cross-tenant leakage, token/PII logging и изменения scoring semantics;
- подготовлены rollback notes и эксплуатационная документация.

## 13. Рекомендуемая декомпозиция релизов

### Release A — Быстрый candidate flow

- PERF-001;
- PERF-002;
- PERF-003;
- PERF-005.

### Release B — Масштабируемый test content и builder

- PERF-004;
- PERF-006;
- PERF-007;
- PERF-008;
- PERF-009.

### Release C — Dashboard и отчеты

- PERF-010;
- PERF-011;
- PERF-012;
- PERF-013;
- PERF-014.

### Release D — Completion и инфраструктура

- PERF-015 при подтвержденной необходимости;
- PERF-016;
- PERF-017.
