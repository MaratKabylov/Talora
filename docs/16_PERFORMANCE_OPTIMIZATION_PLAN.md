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

**Статус на 04.09.2026:** кодовая часть выполнена; сбор 30+ production-like замеров,
top-10 SQL и подтверждение регионов ожидают staging-прогон. Рабочий журнал и инструкция:
`docs/17_PERFORMANCE_BASELINE.md`.

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

**Статус на 06.09.2026:** реализован список маршрутов обновления Auth session в
`lib/supabase/proxy-routes.ts`. Публичные assessment/API запросы сохраняют correlation ID,
но не создают Supabase Auth client. Регрессионные тесты выполняют реальный proxy и
cookie adapter с имитацией Auth transport, включая обновление просроченной сессии.

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

**Статус на 06.09.2026:** кодовые части PERF-003a и PERF-003b реализованы под
`SESSION_CONTROL_V2` (по умолчанию false). Обычные claim, heartbeat, event,
autosave/finalize и expiration check используют один RPC для обоих scope.
Запись ответа, lease и очистка remediation атомарны; scoring не менялся.
Проходят 306 тестов, включая 44 набора паритета с реальной V1-нормализацией и
исполнение SQL с существующими answer triggers. Пользователь сообщил о применении
миграций; установленная удаленная схема инструментально не проверялась.
PERF-003 остается открытым до конкурентной приемки через отдельные соединения и
staging p50/p95. Инструкция: `docs/18_SESSION_CONTROL_V2_ROLLOUT.md`.

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

**Статус на 06.09.2026:** кодовая часть PERF-004a готова под отдельным серверным флагом
`ASSESSMENT_SECTION_READ_V2` (по умолчанию выключен). Один RPC возвращает содержимое/ответы
активной секции и счетчики остальных; выбор первой незавершенной секции выполняется в БД.
Оба test page используют общий безопасный presenter без scoring metadata. Существующие
overview и server actions пока сохранены. Минимальный overview остается отдельной подзадачей,
а предзагрузка следующей секции будет связана с мягкой навигацией PERF-005. Полный PERF-004
и staging-приемка еще не закрыты. Миграция и инструкция: `docs/19_ASSESSMENT_SECTION_READ_ROLLOUT.md`.

**Обновление на 07.09.2026:** PERF-004b добавляет минимальный test-page overview под
`ASSESSMENT_OVERVIEW_V2`. При включенных обоих read-флагах обычная страница выполняет
2 HTTP RPC вместо 7 исходных запросов: обзор без анкеты/пакета/инструкций других тестов и
активная секция. Подтверждены локальная SQL/reader-проверка и сравнение с V1; фактические
p50/p95 и полная Supabase/RLS-приемка остаются открытыми. Предзагрузка следующей секции
по-прежнему планируется вместе с PERF-005, поэтому полный PERF-004 не закрыт.
Включение и откат: `docs/20_ASSESSMENT_TEST_OVERVIEW_ROLLOUT.md`.

**Продолжение на 07.09.2026:** PERF-004c/005c добавляет предзагрузку одной следующей
секции под `ASSESSMENT_SECTION_PREFETCH_V3` для обоих scope и режимов. В кеше только
неизменяемое содержимое; ответы/доступ/прогресс заново читаются после сохранения.
Cache hit исключает повторную передачу текста/вариантов, но не обязательный read RPC;
prefetch добавляет фоновую нагрузку. Код и локальные проверки готовы, p50/p95 и staging
остаются открытыми. Включение, миграция, ограничения и откат: `docs/23_SECTION_PREFETCH_ROLLOUT.md`.

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

**Статус на 07.09.2026:** кодовая часть PERF-005a реализована только для режима
`one_question`, общая для кандидатов и сотрудников. Серверный флаг
`ASSESSMENT_SOFT_NAVIGATION_V2` по умолчанию выключен и требует `ASSESSMENT_SECTION_READ_V2`.
Переход загружает свежий snapshot секции после подтверждения ответа, без повторного overview,
перемонтирования session controller и перезапуска heartbeat. URL/back/forward учитывают
`allowBack` и несохраненный ввод. Проверены четыре browser-component сценария с синтетическим
transport; полная Next.js/Supabase-интеграция и staging p50/p95 остаются условиями приемки.
Режим целой секции, prefetch, завершение/переход к другому тесту не переведены в этом шаге;
полный PERF-005 не закрыт. Включение, ограничения и откат:
`docs/21_ONE_QUESTION_NAVIGATION_ROLLOUT.md`.

**Продолжение на 07.09.2026:** PERF-005b добавляет режим целой секции под отдельным
`ASSESSMENT_SECTION_SAVE_V2`. Общий контроллер ожидает фоновые записи, атомарно подтверждает
секцию через новый RPC и читает следующую без overview/reload. Для запуска нужны миграция,
три предыдущих флага и staging-приемка. Последняя секция подтверждается batch, а затем
передается старому completion/scoring action. Prefetch и оптимизация terminal navigation
остаются открытыми. Инструкция: `docs/22_SECTION_NAVIGATION_ROLLOUT.md`.

**Следующее обновление:** prefetch реализован отдельной подзадачей PERF-004c/005c
(инструкция 23). Оптимизация завершения/перехода к другому тесту и staging-приемка
остаются открытыми; они не входят в эту реализацию предзагрузки.

**Обновление на 08.09.2026:** PERF-005d реализует ручное завершение под
`ASSESSMENT_COMPLETION_V2`. После подтвержденного сохранения один RPC проверяет ответы,
завершает сессию и запускает следующую, без полного content/overview чтения в endpoint
и повторного terminal batch. Последний тест вызывает прежнюю финализацию/скоринг;
поддержаны retry после commit, processing и recovery после reload. Клиент запрашивает
`router.replace` с новым controller/claim для следующей сессии. Истечение времени оставлено
на прежнем пути. Локальные SQL/component проверки готовы, реальный RSC/Supabase E2E,
конкурентность и p50/p95 еще обязательны для приемки. Миграция/включение/откат:
`docs/24_COMPLETION_NAVIGATION_ROLLOUT.md`. Следующая кодовая задача — PERF-006.

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

**Статус кода — 08.09.2026:** реализовано для company/admin builder. Начальная
загрузка возвращает metadata DTO из пяти полей, без содержимого источников; версии
читаются страницами по 500 строк. Содержимое одной опубликованной версии загружается
отдельным Server Action после «Загрузить источник», затем пользователь явно импортирует
копии секций. На сервере повторяются auth/role/tenant/grant/draft/published проверки.
Loading/error/retry, смена источника, late response и сохранность правок покрыты тестами.
Миграции и новые флаги не нужны. Полная PostgREST/RLS интеграция и замеры на staging
остаются условиями приемки: `docs/25_BUILDER_LAZY_IMPORT_ROLLOUT.md`.
Следующая кодовая задача — PERF-007; autosave/clone в этом шаге не переписаны.

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

**Статус кода — 08.09.2026:** реализованы memoized `SectionEditor`, `QuestionEditor`,
`OptionEditor` и стабильные операции над документом. При изменении option сохраняются
ссылки соседних сущностей, UI-состояние локализовано; при открытии раскрыт один вопрос.
Добавлен `content-visibility: auto`, drag-движение не меняет документ до drop; повторный
pointer target пропускает поддеревья редакторов. Клавиатурные перемещения и прежние
операции покрыты тестами. React Profiler на synthetic 100-question fixture подтверждает
локальный rerender. Production/staging INP ≤ 200 мс **еще не подтвержден**.
Результаты и приемка: `docs/26_BUILDER_RENDER_OPTIMIZATION_ROLLOUT.md`.
Следующий кодовый шаг — PERF-008 (revision и инкрементальное атомарное autosave).

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

**Статус кода — 08.09.2026:** PERF-008.1/008.2 реализованы за `BUILDER_SAVE_V2=false`:
consistent snapshot, sparse delta, atomic commit, retry ACK, trailing debounce 2 с,
one-in-flight/coalescing, conflict/recovery export, flush перед preview/publish и revision-CAS
публикация с прежней domain/scoring-валидацией. Legacy order indexes и terminal archive/delete
сохранены; зарегистрированные V2-версии защищены от V1 content writers. Локально пройдены
462 Node tests и 16 browser scenarios, lint/typecheck/build. **Performance/staging-приёмка
не закрыта**: full RLS, реальные concurrent connections, latency/network baseline.
Следующий шаг для выпуска — staging rollout обеих миграций; клонирование вынесено в PERF-009 ниже.
Инструкция и ограничения rollback: `docs/28_BUILDER_INCREMENTAL_AUTOSAVE_ROLLOUT.md`.

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

**Статус кода — 09.09.2026:** реализована общая server-only RPC для company/system actions:
одна транзакция, set-based копирование, old→new ID mapping, remediation, matching targets,
settings и scoring V2 (включая SJT/Forced Choice и criterion references). Повтор открывает
существующий draft, system audit атомарен. Локально прошли 475 Node tests, 16 browser
сценариев, lint/typecheck/build. Миграция удалённо не применялась.
**Staging/performance-приёмка открыта:** p95 ≤ 2 с, full RLS и реальные конкурентные
подключения не проверены. Инструкция: [rollout PERF-009](29_ATOMIC_TEST_VERSION_CLONE_ROLLOUT.md).
Следующая кодовая задача после PERF-009 — PERF-010; её локальный статус описан ниже.

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

**Статус на 09.09.2026:** основные list DTO и SQL aggregates реализованы и локально
проверены; обе comparison-страницы используют DB filters/sort и cursor на 50 строк.
Миграция `20260909140000_dashboard_list_read_models.sql` удалённо не применялась.
Полная приёмка открыта: staging/PostgREST/замеры и исключение employee comparison,
который до PERF-014 читает scoring JSON текущей страницы. У остальных перечисленных
списков rich text/scoring JSON и полные дочерние коллекции удалены из list path.
Подробности и проверки: [rollout PERF-010](30_DASHBOARD_LIST_READ_MODELS_ROLLOUT.md).

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

**Статус на 10.09.2026:** код списков первой очереди реализован. Добавлены общий
date/ID cursor, серверные фильтры и URL-навигация, страницы 50/max 100; comparison
сохраняет проверенную пагинацию PERF-010 по 50. Tests/packages используют две
tenant-scoped invoker SQL-функции без загрузки массивов grant IDs в Next.js.
Миграция `20260909160000_dashboard_list_pagination.sql` удалённо не применялась.
Staging/PostgREST/performance-приёмка открыта. Вспомогательные справочники форм
не переведены на страницы; точные границы и проверки —
[rollout PERF-011](31_DASHBOARD_CURSOR_PAGINATION_ROLLOUT.md).

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

**Статус на 10.09.2026:** локальный диагностический этап выполнен: 47 SELECT shapes,
30 warm EXPLAIN до/после, девять экспериментальных индексов и четыре write proxies.
Score-update proxies ухудшились; миграция набора не создана. Production-like EXPLAIN,
полные autosave/upsert и отдельный отбор индексов ожидают staging. Артефакты и условия
выпуска: [PERF-012 benchmark](32_QUERY_INDEX_BENCHMARK.md). PERF-012 целиком не принят.

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
