# Baseline производительности Talvia

Дата подготовки: 4 сентября 2026 года.

Статус: каркас измерений реализован; production-like baseline ожидает запуск на staging с
подключенной Supabase и приемочным набором данных.

Локальная smoke-проверка production build:

- telemetry endpoint принимает валидное same-origin событие с ответом `204`;
- запрос с чужим Origin отклоняется с ответом `400`;
- token и session UUID в route label заменяются на `[token]` и `[id]`;
- correlation ID имеет отдельный префикс `req_` и не принимает произвольное значение;
- production build с телеметрией собран успешно; последний compile — 6,2 с, TypeScript — 9,7 с.

Эти локальные значения не являются продуктовым baseline и не используются для SLA.

## 1. Что измеряется

Серверные события `performance.server_operation`:

- `auth.context`;
- `jobs.list`, `candidates.list`, `candidates.job_list`, `tests.list`, `packages.list`;
- `employee_assessments.list`, `comparisons.employee`;
- `comparisons.candidate`;
- `reports.candidate`, `reports.employee`;
- `assessment.load_candidate`, `assessment.load_employee`;
- `assessment.load_question_candidate`, `assessment.load_question_employee`;
- `assessment.claim`, `assessment.heartbeat`, `assessment.autosave`, `assessment.event`,
  `assessment.complete`, `assessment.expire`;
- `scoring.candidate.calculate`, `scoring.candidate.persist`;
- `scoring.employee.calculate`, `scoring.employee.persist`;
- `builder.load`, `builder.import_sources`, `builder.save`, `builder.clone`.

Клиентские события:

- Core Web Vitals: CLS, FCP, INP, LCP и TTFB;
- полная document navigation;
- claim, heartbeat, autosave, event, expire и completion assessment;
- автосохранение конструктора.

Все события содержат только название фиксированной операции, длительность, результат,
время и безопасный correlation ID. Route label очищается от invitation token, UUID и query
parameters. Email, имя, телефон, ответ участника и идентификаторы бизнес-сущностей не
логируются.

## 2. Включение на staging

Добавить в staging environment:

```dotenv
PERFORMANCE_TELEMETRY_ENABLED=true
NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED=true
```

После изменения публичной переменной требуется новый production build. В production
переменные не включать до согласования объема и срока хранения логов.

## 3. Сценарии baseline

Использовать набор данных из `docs/16_PERFORMANCE_OPTIMIZATION_PLAN.md`. Для каждого
сценария выполнить не менее 30 cold/warm повторов:

1. Вход HR и открытие dashboard.
2. Списки вакансий, кандидатов, тестов, пакетов и оценок сотрудников.
3. Candidate и employee assessment: claim, heartbeat, обычный autosave, финализирующий
   autosave и completion.
4. Открытие candidate/employee report и comparison.
5. Открытие конструктора теста из 100 вопросов, изменение одного option и autosave.
6. Создание результата candidate и employee с отдельной фиксацией calculation/persistence.

Сохранять отдельно cold и warm выборки. Dev mode не использовать для SLA.

## 4. Агрегация логов

Сохранить JSON-логи staging в файл и выполнить:

```bash
npm run perf:summary -- staging-performance.log
```

Команда выводит count, failures, p50 и p95 для каждой операции и метрики.

## 5. Статическая оценка до инструментирования

Эти значения нужны только как отправная гипотеза и должны быть заменены фактическими
данными staging:

| Сценарий | Текущая оценка |
| --- | ---: |
| Auth/company context | 3 SQL/API запроса, 2 последовательные волны |
| Assessment heartbeat | несколько последовательных проверок и обновлений |
| Section-mode autosave | около 6 последовательных обращений к БД |
| One-question autosave | около 9 последовательных обращений к БД |
| Переход между секциями | Полный document reload и повторный server render |
| Candidate report | application query, параллельная волна из 9 запросов, затем version/template/answers |
| Builder initial load | builder document плюс полное содержимое всех import sources |
| Builder autosave | чтение текущего документа и последовательный upsert всей структуры |

## 6. SQL baseline

На production-like Supabase включить `pg_stat_statements` согласно политике окружения.
После прогонов сохранить 10 запросов с наибольшим `total_exec_time` и `mean_exec_time`.
Для каждого кандидата выполнить:

```sql
explain (analyze, buffers, settings)
-- запрос с обезличенными параметрами;
```

В этот документ занести query fingerprint, calls, mean/p95 на уровне приложения, план,
прочитанные buffers и вывод. SQL с token, email, телефоном или текстом ответа в артефакты
не копировать.

## 7. Инфраструктурные данные

До принятия baseline зафиксировать:

- регион Next.js runtime;
- регион Supabase проекта;
- средний RTT между runtime и Supabase;
- тип staging compute/database;
- commit SHA, Node.js и Next.js versions;
- размер приемочного набора данных.

## 8. Таблица результатов

| Операция | n | p50, мс | p95, мс | Ошибки | Цель из ТЗ | Вывод |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| assessment.autosave | — | — | — | — | ≤ 800 | Ожидает staging |
| assessment.heartbeat | — | — | — | — | ≤ 500 | Ожидает staging |
| jobs.list | — | — | — | — | list TTFB ≤ 1000 | Ожидает staging |
| candidates.list | — | — | — | — | list TTFB ≤ 1000 | Ожидает staging |
| reports.candidate | — | — | — | — | summary ≤ 1500 | Сейчас summary/details объединены |
| reports.employee | — | — | — | — | summary ≤ 1500 | Сейчас summary/details объединены |
| builder.load | — | — | — | — | Зафиксировать baseline | Ожидает staging |
| builder.autosave | — | — | — | — | ≤ 1500 | Ожидает staging |
| scoring.*.calculate | — | — | — | — | Зафиксировать baseline | Ожидает staging |
| scoring.*.persist | — | — | — | — | Зафиксировать baseline | Ожидает staging |

`PERF-001` считается полностью принятым после заполнения таблицы фактическими значениями,
приложения top-10 SQL и подтверждения регионов. До этого кодовая часть задачи готова, а
операционная часть остается открытой.

## 9. PERF-002: область обновления Auth session — 06.09.2026

Auth refresh выполняется только для `/dashboard`, `/admin`, `/login`, `/onboarding`,
`/invite/company`, `/auth` и вложенных путей. Проверяется граница сегмента: например,
`/administrator` не считается частью `/admin`. Существующий matcher сохраняется для
передачи correlation ID на публичных маршрутах; статические JS/image assets исключены.

Для `/employee-assessment/*`, `/api/assessment/session-control`, главной страницы
и публичных шаблонов импорта удален вызов `getClaims()` из proxy.
`/assessment/*` и telemetry API по-прежнему пропускают Auth refresh. Token validation, lease, deadlines,
проверки доступа в server actions/readers и RLS продолжают выполняться в своих обработчиках.

Регрессионные тесты `tests/proxy-auth.test.ts` проверяют GET и POST на публичных и
авторизованных маршрутах, отсутствие Auth client и `getClaims()` на публичных запросах
с просроченными HR cookies, передачу обновленных cookies вверх по запросу и в ответ,
удаление устаревшего cookie chunk, сохранение correlation ID и cache headers.
Используются реальные NextRequest/NextResponse и код proxy, Supabase transport имитируется.

Подтвержденный результат: **0 вызовов `getClaims()` из proxy на один autosave/heartbeat**
(ранее — 1). Это число вызовов SDK, а не SQL/сетевых запросов: при отсутствии Auth cookie
прежний `getClaims()` мог завершаться локально. Влияние на p50/p95 остается предметом
staging-прогона из раздела 3.

При добавлении нового маршрута с HR/platform Auth требуется включить его корень в
`AUTH_SESSION_ROUTE_ROOTS` и дополнить тесты. Откат изменения — восстановление предыдущего
условия в `proxy.ts`; миграции БД и новые переменные окружения не требуются.

Основание для сохранения обновления cookies на Auth-маршрутах:
[Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client).

## 10. PERF-003a: атомарные lease-операции — 06.09.2026

Под флагом `SESSION_CONTROL_V2=true` активные claim, heartbeat и integrity event для
candidate/employee выполняют один Supabase RPC. Для обычного heartbeat это 1 HTTP
round trip вместо 3 (invitation read → session read → lease update); при backfill
deadline прежний путь выполнял дополнительные обращения. SQL statements внутри RPC
остаются отдельными, но исполняются в одной транзакции без промежуточных HTTP-волн.

Число RPC подтверждено серверными тестами с имитацией transport. Выполнение SQL,
tenant/token/lease-проверки, дедупликация событий и права проверены в изолированном
PostgreSQL/PGlite; всего проходят 228 тестов проекта. Полная Supabase-схема и
конкурентность через отдельные соединения требуют staging-прогона.

Изменение выключено по умолчанию; миграция не применялась к рабочей БД. Фактические
p50/p95 еще не измерены. Autosave/finalize и явный expiration check остаются на V1.
Инструкция приемки, включения и отката: `docs/18_SESSION_CONTROL_V2_ROLLOUT.md`.

## 11. PERF-003b: атомарное сохранение ответов — 06.09.2026

При `SESSION_CONTROL_V2=true` обычный autosave/finalize выполняет один HTTP RPC-вызов
`save_assessment_answer_v2`, включая продление lease, валидацию, upsert/delete и очистку
remediation. Внутренний вызов lease RPC не создает второй HTTP-запрос и сохраняет
блокировки в той же транзакции. Активный expiration check также использует один RPC;
терминальное завершение/scoring по-прежнему требует существующей цепочки запросов.

Подтверждено локально: 306 тестов проходят; 44 набора SQL-нормализации совпадают с V1.
Для обоих scope проверены существующие answer triggers, идемпотентность, запреты после
takeover/завершения, атомарный откат remediation и истечение срока во время записи.
Lint, typecheck и production build проходят. Фактические p50/p95 не замерены.

Пользователь сообщил о применении миграций; удаленная схема/окружение инструментально
не проверялись. Флаг агентом не включался. Конкурентность на нескольких соединениях,
полная Supabase/RLS-интеграция и staging baseline остаются приемочными условиями.

## 12. PERF-004a: чтение активной секции — 06.09.2026

Под `ASSESSMENT_SECTION_READ_V2=true` обе test page получают содержимое/ответы активной
секции через один `read_assessment_section_v2` HTTP RPC после существующего overview.
Вместо двух прежних HTTP-запросов (все sections/questions/options и все session answers)
выполняется один RPC. Это число HTTP round trips, а не число SQL statements внутри функции.
Чтение overview, сохранение секции и финальный scoring в эту оценку не входят.

Счетчики видимости и первой незавершенной секции вычисляются в БД; вопросы и ответы остальных
секций не передаются в Next.js reader. В синтетическом SQL-тесте добавление 1000 вопросов
с длинным текстом вне активной секции увеличивает JSON-ответ менее чем на 20 символов,
только за счет счетчиков. Число секций в этом тесте фиксировано: manifest растет с числом
секций, а стоимость SQL-агрегации по-прежнему зависит от общего числа вопросов/ответов.
Это проверка ограниченного объема передачи, **не измеренное ускорение p50/p95**.

Локально проходят 325 тестов, typecheck, lint и production build. Новые тесты исполняют
реальный SQL, reader/presenter и обе страницы с имитацией Supabase transport; проверяют
права, tenant/token/consent guards, section selection, отсутствие записей, shuffle,
восстановление ответов, санитизацию и исключение scoring metadata из DTO чтения.
Ограничение PGlite прежнее: минимальная схема не заменяет полную Supabase/RLS-интеграцию.

Для staging добавить 30+ cold/warm замеров `assessment.load_section`, TTFB обеих test page
и размера RPC/RSC payload. Сравнить одинаковую активную секцию при росте остальных секций,
отдельно число вопросов и число секций. Токены/ответы/PII в результаты не включать.
Миграция на удаленной БД агентом не применялась, флаг не включался; фактических замеров нет.
Минимальный overview, prefetch и мягкая навигация остаются продолжением PERF-004/005.
Включение и откат: `docs/19_ASSESSMENT_SECTION_READ_ROLLOUT.md`.

## 13. PERF-004b: минимальный test-page overview — 07.09.2026

Под `ASSESSMENT_OVERVIEW_V2=true` текущий overview читается одним HTTP RPC
`read_assessment_test_overview_v2` вместо пяти запросов (invitation, company, job/assessment,
person, sessions). Новая операция: `assessment.load_test_overview`. В ответе только параметры
текущего теста, заголовки и счетчики; нет профиля человека, описания пакета, массива сессий
и инструкций/настроек остальных тестов.

При включенном также `ASSESSMENT_SECTION_READ_V2` обычная активная test page выполняет
2 HTTP-запроса чтения вместо 7 исходных или 6 после PERF-004a. Claim/heartbeat и terminal
side effects не входят в эти числа. SQL statements внутри RPC считаются отдельно.
При overview=true и section=false остается совместимый, но не оптимальный путь: 8 запросов;
для ускорения включать оба read-флага. Их таблица и откат — в документе rollout.

Локальные тесты исполняют новую SQL-функцию и реальные V1 readers на одной синтетической
схеме; подтверждено совпадение текущих параметров, счетчиков и scope-specific eligibility.
Добавление 200 других сессий/тестов с длинными инструкциями меняет JSON менее чем на 20
символов, только за счет счетчика. Рост инструкций существующих других тестов не меняет
payload. Это проверка объема, не замер p50/p95; стоимость SQL по числу сессий еще измеряется.

Все 344 теста, lint, typecheck и production build проходят. Новые проверки охватывают
tenant/person/context/session связи, consent/expiry/terminal redirects, права, отсутствие
записей, rich-text sanitization, error handling и все сочетания read-флагов на обеих страницах.
PGlite не заменяет полную Supabase/RLS-интеграцию; browser smoke, EXPLAIN, 30+ cold/warm
замеров TTFB/операций и фактический production-like p95 остаются открытыми.

Новая миграция агентом не применялась к удаленной БД, реальные флаги не включались.
Read-only overview больше не пишет opened/expired из GET; отображение и фиксацию
терминальных состояний проверить по rollout-инструкции. Минимальный overview реализован,
но prefetch/мягкая навигация остаются следующим шагом PERF-004/005.
Инструкция: `docs/20_ASSESSMENT_TEST_OVERVIEW_ROLLOUT.md`.

## 14. PERF-005a: мягкая навигация one-question — 07.09.2026

При серверных `ASSESSMENT_SOFT_NAVIGATION_V2=true` и `ASSESSMENT_SECTION_READ_V2=true`
обычный переход между секциями в `one_question` выполняет один section-read HTTP RPC
после существующего finalize. Test-page overview не перечитывается; session controller
остается смонтированным, дополнительный claim не выполняется. Первая загрузка по-прежнему
использует выбранный overview reader; ее числа приведены в разделе 13.

Добавлена разрешенная клиентская метрика `assessment.section_navigation`: время
fetch/применения snapshot, без finalize и ожидания painted frame. Не интерпретировать
ее как полную задержку от клика. Token, session ID, ответ и PII в метрику не передаются.

После повторной проверки проходят 349 тестов, typecheck, lint и production build.
Проверены обе страницы со всеми сочетаниями overview/section/navigation-флагов и двух
presentation mode. В headless Chrome прошли четыре browser-component сценария
candidate/employee × allowBack true/false с реальными компонентами и синтетическим
transport: ошибки, двойной клик, история/восстановление ответа, непрерывность таймера,
один claim, стабильная identity и heartbeat interval, отмена запроса при unmount.
При проверке исправлены review при browser Back и пересоздание heartbeat на смене секции.

Эти результаты не заменяют полный Next.js App Router/Supabase E2E, проверки всех типов
вопросов в браузере, конкурентных вкладок и staging p50/p95. Фактическое ускорение пока
не измерено. Нужны 30+ cold/warm замеров и click-to-visible отдельно от времени чтения.
Новая миграция не нужна, реальные флаги агентом не менялись. Режим целой секции, prefetch
и мягкое завершение/смена теста остаются отдельными работами. Полный PERF-005 не закрыт.
Приемка и откат: `docs/21_ONE_QUESTION_NAVIGATION_ROLLOUT.md`.

## 15. PERF-005b: мягкая навигация целой секции — 07.09.2026

Новый серверный флаг `ASSESSMENT_SECTION_SAVE_V2` расширяет soft navigation на режим
`section`. Требует `SESSION_CONTROL_V2`, `ASSESSMENT_SECTION_READ_V2` и
`ASSESSMENT_SOFT_NAVIGATION_V2`. Общий контроллер остается смонтированным, дожидается
фоновых autosave, вызывает один batch-save RPC и один section-read RPC без overview.
Это число HTTP по коду/transport-тестам, не число SQL statements и не измеренное ускорение.

Миграция `20260907150000_assessment_section_save_v2.sql` добавляет атомарный batch с
нормализацией PERF-003b, проверками token/consent/company/session/lease, обязательных
ответов, remediation и deadline после записи. RPC не возвращает ключи ответов/скоринг.
Последняя секция сначала подтверждается batch, затем использует старый completion
Server Action с повторным сохранением. Терминальный путь в оценку двух HTTP не входит.

Локально проходят 365 тестов, typecheck, lint и production build. Новые SQL-тесты
исполняют реальный нормализатор и answer triggers в PGlite; подтверждены rollback всей
секции/lease при ошибке записи, удаления и истечении deadline/token внутри slow trigger,
структурированные ответы, обязательность, remediation, scope/tenant guards и права.
Расширенная проверка страниц покрывает все сочетания четырех необходимых флагов,
overview-флага и двух presentation mode.

В headless Chrome прошли 8 browser-component сценариев: оба режима × candidate/employee
× allowBack true/false. Для целой секции проверены ожидание уже начатых autosave,
ошибки batch/read, двойной клик, восстановление/история/неподтвержденный ввод, remediation,
непрерывный timer/heartbeat/client identity и передача последней формы в synthetic
Server Action. Общий сценарий one-question также сохраняет проверку abort чтения.

PGlite и synthetic transport не заменяют полную Next.js/Supabase-интеграцию, real terminal
action/scoring, конкурентность через отдельные соединения и p50/p95 staging. Новый флаг
остается выключенным; удаленная миграция агентом не применялась. Замеры server
`assessment.save_section`, client `assessment.section_navigation` и отдельного
click-to-visible еще предстоит собрать (30+ cold/warm повторов). Prefetch и оптимизация
completion/смены теста остаются открытыми; полный PERF-004/005 не закрыт.
Включение, приемка и откат: `docs/22_SECTION_NAVIGATION_ROLLOUT.md`.

## 16. PERF-004c/005c: предзагрузка следующей секции — 07.09.2026

Под серверным `ASSESSMENT_SECTION_PREFETCH_V3` контроллер предзагружает только одну
следующую секцию published/archived версии, без ответов/прогресса/обратной связи.
Новый read-only RPC `read_assessment_section_navigation_v3` поддерживает content-prefetch
и обязательную свежую проверку перехода. Cache hit возвращает state без текста/вариантов;
cache/canonical mismatch возвращает полный актуальный V2 snapshot внутри того же RPC.
Существующий finalize/batch, lease и scoring не изменены.

На критическом пути сохраняется один read HTTP/RPC после записи. Дополнительно появляется
один speculative HTTP/RPC на секцию. Преимущество — перенос подготовки/передачи статического
содержимого до клика; уменьшение общего числа запросов этим шагом не заявляется.
В PGlite увеличение текста следующего вопроса на 70 000 символов и добавление 100 длинных
вариантов не меняет JSON cache-hit ответа; prefetch payload растет. Это проверка контракта
объема, не измерение задержки, размера gzip или нагрузки production DB.

Локально проходят 383 теста, lint, typecheck, production build и 16 headless Chrome
browser-component сценариев: оба scope × режима × allowBack × prefetch off/on.
SQL-проверки исполняют реальную новую миграцию с V2 и integrity migrations в PGlite:
ограничение lookahead, read-only/grants, scope/company/token/consent/deadline/version,
совпадение state+content с V2, удаленные ответы, remediation, review, изменившаяся
каноническая секция. Проверены серверная очистка DTO, deterministic shuffle, свежая
ordering перестановка, одноэлементный кеш/TTL/лимит 1 MiB, abort, ошибки и live flag rollback.
Браузер проверяет успешное использование cache hints без раннего показа секции, сохранение
ввода после ошибок, историю, timer/identity/heartbeat и прежний terminal handoff.

Это synthetic component/transport и локальный PostgreSQL, не полная Next.js/Supabase/RLS
интеграция. Фактическое ускорение еще не измерено. Нужны 30+ cold/warm click-to-visible
замеров с флагом off/on, hit/miss, p50/p95, ошибками и общей нагрузкой БД; большие/малые
секции и слабая сеть должны оцениваться отдельно. Старые p95 не подменены оценками.

Флаг по умолчанию выключен. Новую миграцию агент в удаленную БД не применял, реальные
env не менял. Предыдущая инструкция выполнена со слов пользователя, без удаленной проверки.
Кодовая часть prefetch готова; staging-приемка и оптимизация completion/смены теста
остаются открытыми. Включение/ограничения/откат: `docs/23_SECTION_PREFETCH_ROLLOUT.md`.

## 17. PERF-005d: ручное завершение и переход между тестами — 08.09.2026

Под `ASSESSMENT_COMPLETION_V2` после ACK finalize/batch выполняется один
`complete_assessment_session_v2` RPC. В промежуточном завершении endpoint не делает
дополнительных overview/content reads и не запускает scoring readiness из Node: проверка
сохраненных ответов, завершение и старт следующей сессии выполняются в SQL. Повтор не
перезаписывает ответы/completed_at и не сбрасывает deadline следующей сессии. Последний
тест вызывает прежнюю синхронную scoring finalization вне SQL-транзакции; она по-прежнему
содержит дополнительные запросы и отдельно нуждается в замерах.

Новый endpoint не получает ответы/вопросы, только client/device/session/token. Внутри RPC
есть несколько SQL statements и вызовы нормализатора по вопросам; уменьшение HTTP нельзя
приравнивать к уменьшению SQL нагрузки или достигнутому p95. Следующая test page намеренно
читает свой overview/section и создает новый controller/claim. Клиент вызывает router.replace
вместо document navigation, но реальные RSC/network-метрики на staging еще не собраны.

Локально: 410 тестов; новые проверки используют реальную completion/lease/answer/integrity
логику в PGlite. Подтверждены scope/company/person/context/consent/token/lease, все типы
ответов, mandatory/optional/remediation, empty tests, ordering/eligibility, идемпотентность,
rollback завершения/старта следующего/lease при trigger failure или expiry и service-only grants.
Route/helper/page проверки покрывают флаги, no-store, отсутствие V1 fallback, неизменный
scoring dispatch, processing/error/retry, отсутствие внутренних owner/invitation IDs в DTO,
same-token destination и recovery вместо GET-scoring после reload.

30 headless Chrome browser-component сценариев прошли: прежние 16 с выключенным completion,
12 завершений (2 scope × 3 режима × intermediate/last) и 2 восстановления. Используются
реальные компоненты с synthetic transport и **mock router**, не полный Next.js App Router.
Проверены ACK, double click, ошибка после имитированного commit, повтор без новых answer
записей, processing, сохранение ввода, подавление heartbeat/autosave во время ожидания,
корректный scoped router destination и отсутствие автоматического scoring в recovery render.

Полная Supabase/RLS интеграция, параллельные соединения, реальный scoring parity, RSC/E2E,
canary/rollback и 30+ cold/warm p50/p95 остаются условиями staging-приемки. Реальное ускорение
не заявляется. Метрики: server `assessment.finish_session`, endpoint Server-Timing
`assessment_complete`, client `assessment.complete`; последняя не включает новый RSC/paint.
Скоринг и time-expired pipeline не переписаны, фоновая очередь не внедрена.

Новая миграция агентом в удаленную БД не применялась, реальные флаги не менялись.
Инструкция и ограничения отката/recovery: `docs/24_COMPLETION_NAVIGATION_ROLLOUT.md`.

## 18. PERF-006: ленивые источники импорта — 08.09.2026

Прежде оба builder route запрашивали sections/questions/options всех доступных версий,
после чего отфильтровывали published в Node и передавали весь контент в Client Component.
Теперь первоначальный DTO содержит только `templateId`, `versionId`, `templateTitle`,
`versionNumber`, `questionCount`. В PostgREST выбираются published версии и вложенные
счетчики вопросов; section descriptions/settings и questions/options источников отсутствуют
в начальном запросе и props. Текущий редактируемый документ по-прежнему загружается целиком.

Для библиотеки до 500 версий на ветку: company — 2 metadata HTTP queries (own/system с
grant активной компании), admin — 1 (system). Большие библиотеки читаются страницами по
500 с детерминированным порядком ID. Это не константная SQL-стоимость: подсчет вопросов и
RLS по-прежнему выполняются в БД, размер metadata списка зависит от числа версий/секций.

После кнопки «Загрузить источник» выполняется Server Action: auth/role, проверка target
draft/ownership, metadata источника для выбора company/system ветки и один content query
ровно выбранной published версии. Content query включает template scope, а для system
источника HR — активный template и актуальный grant именно активной компании. Client не
задает company ID или привилегированный режим. Загрузка сама не меняет BuilderDocument.
При явном импорте применяется прежний copySection; autosave и scoring semantics не изменены.

Нет общего/permanent cache: только один загруженный источник в памяти picker, удаляемый
при смене источника, новом запросе, импорте и unmount. Server Action нельзя отменить в БД
из picker; поздний результат игнорируется. Запросы не запускаются автоматически/по retry timer.

Локальные проверки: 418 Node tests, включая 8 новых проверок real Supabase query builder
с synthetic HTTP (DTO/counts, pagination, company/grant/status filters, admin restrictions,
role matrix, UUID/error handling и нормализация контента). Это не живой PostgREST/RLS E2E.
8 новых headless Chrome component сценариев: loading/error/retry, stale selection,
unmount, empty/mismatched/large source и 2 editor сценария с копированием/remediation
и сохранением локальных правок. Транспорт Server Actions в browser fixture синтетический.
Typecheck, lint и production build прошли. Реальное время открытия, RSC bytes, p50/p95,
нагрузка счетчиков и отзыв доступа на staging еще не измерены/не проверены агентом.

Метрики: `builder.import_sources` теперь измеряет только metadata; сравнение с прежним
именем учитывает изменение семантики. Новая `builder.import_source_content` измеряет
ленивую server operation вместе с auth; названия/ID/контент тестов в метрики не добавлены.
Миграция/feature flag не требуются; удаленные данные и реальные env не менялись.
Приемка/откат: `docs/25_BUILDER_LAZY_IMPORT_ROLLOUT.md`.

## 19. PERF-007: локальные перерисовки конструктора — 08.09.2026

Монолитный JSX перенесен в memoized SectionEditor → QuestionEditor → OptionEditor.
Стабильные callbacks используют актуальный документ через прежний updateSections/ref;
неизмененные section/question/option сохраняют object identity. Collapse хранится на уровне
секции, remediation/option drag — вопроса. Список названий для remediation передается отдельной
primitive projection: option edit не меняет его, а переименование/перестановка обновляет меню.
Первоначально раскрыт первый вопрос первой непустой секции, остальные свернуты.

После первичного замера добавлен content-visibility:auto с contain-intrinsic-block-size для
карточек вопросов. Это пропуск browser rendering вне viewport, не удаление данных из DOM.
Перетаскивание использует стабильные handlers, референсы pointer state и dedup target; документ
меняется только при drop. No-op question drop не инициирует dirty/save. Добавлены стрелки
вверх/вниз для keyboard-перемещения вопроса внутри секции и structured option.

Локальная fixture: Chrome headless, development React Profiler, два раздела по 50 single-choice
вопросов, 400 вариантов. Одинаковые данные до/после; на обоих edit samples все 100 вопросов
специально раскрыты. Server Actions синтетические, fixture без production Tailwind stylesheet.
Десять программных input events на один option; это actualDuration React, **не INP**, не
network latency и не p95. Profiler/probe внедряются только test loader, не в production bundle.

| Показатель одного локального прогона | До | После |
| --- | ---: | ---: |
| Раскрытых вопросов при открытии | 100 | 1 |
| Начальных DOM-элементов внутри редактора | 31 705 | 3 589 |
| Mount actualDuration, мс | 404,1 | 155,0 |
| Edit actualDuration, диапазон 10 вводов, мс | 53,3–109,8 | 3,8–5,8 |

До, мс: 103,8; 94,6; 69,5; 69,8; 59,6; 78,2; 53,3; 81,1; 64,2; 109,8.
После, мс: 3,9; 4,6; 3,9; 5,8; 5,3; 5,2; 4,4; 5,8; 3,8; 4,2.
Значения не являются статистическим обещанием ускорения: другие локальные прогоны после
рефакторинга давали около 3–12 мс. Инвариант теста — рендерится один измененный QuestionEditor
и OptionEditor, соседняя секция/вопросы/варианты пропускаются. Root и измененная секция все
еще рендерятся; status save может отдельно обновить root. Локальный render probe и React
Profiler подтверждены в browser fixture; counters не содержат реальных данных пользователей.

Проверки: 426 Node tests (8 новых — structural sharing, latest-state callbacks, move/copy,
remediation, content blocks и defaults типов). Четыре новых browser-component сценария:
100-question profiling, CRUD, все типы/option callbacks/remediation/collapse, keyboard/drag.
Дополнительно повторно пройдены все 8 browser сценариев lazy import. Pointer capture и hit
testing в drag fixture синтетические; native touch/mouse/scroll требуют ручной проверки.
Typecheck/lint/build прошли. Серверные save/RLS/scoring и schema не изменялись; никакая
миграция или новый flag для этого шага не требуются. Полный BuilderDocument по-прежнему
сохраняется целиком: это будущий PERF-008, не результат PERF-007.

Staging INP, доступность с assistive technology, реальное scroll/drag поведение и общий
performance acceptance остаются открыты. Инструкция: `docs/26_BUILDER_RENDER_OPTIMIZATION_ROLLOUT.md`.

## 20. PERF-008.1: atomic delta storage — 08.09.2026

Добавлена server-only RPC сохранения dirty entities одним пакетом, bigint revision,
последнее идемпотентное подтверждение и закрытая таблица регистрации V2 writer. Row guards
сериализуют изменения содержимого с версией, сохраняют immutable published/archive и
не дают старому writer обойти revision после регистрации версии. Один V2 batch — одно
увеличение revision; неизвестные settings, scoring metadata и match_target_id сохраняются.

12 PGlite сценариев (13 новых Node tests с родительским) проверяют реальную миграцию:
sparse update, rollback, stale revision, lost ACK, moves/deletes, ownership/roles, grants,
metadata, legacy fence, совместимость publication/archive/revert guards. Полный набор —
439 тестов; typecheck/lint/build проходят. Нет измерений PostgreSQL latency, network payload или
статистического ускорения: UI всё ещё сохраняет полный документ V1, SQL RPC ещё не вызывается
приложением. До готовности PERF-008.2 migration предназначена только для staging.

PGlite не заменяет full Supabase/RLS и реальные конкурентные PostgreSQL соединения.
Оставшаяся реализация и условия rollout: `docs/27_BUILDER_ATOMIC_SAVE_STORAGE.md`.

## 21. PERF-008.2: подключение и перепроверка — 08.09.2026

Company/system builder используют V2 только при явном серверном flag. Начальный snapshot
читается один раз, без предварительной полной V1-загрузки. Browser передаёт изменённые
сущности/удалённые ID, server service после auth делает snapshot + commit RPC. Валидация
полного документа на сервере остаётся; не заявляется O(1) стоимость чтения/CPU.

Synthetic 100-question browser case подтвердил: trailing debounce 2 с, один изменённый
option, ноль других questions/sections в payload. Ввод во время in-flight покрыт controller
test; lost ACK повторяет тот же request. Preview/publish flush и publication CAS не дают
опубликовать непроверенную revision. Metadata, matching target IDs и legacy order indexes
сохраняются; неизвестный исход публикации замораживает UI до повторного подтверждения.

Перепроверка выявила и исправила order-index регрессию старых черновиков и исключение на
нечисловой revision. Добавлена проверка 900 000 bytes до отправки вместо retries большого
HTTP body. HTML test приведён к реальному rich-text протоколу; legacy plain text не изменён.

462 Node tests (включая 36 V2 storage/service/controller/contract/role tests с родительскими),
8 browser editor scenarios и 8 browser import scenarios прошли; lint/typecheck/build проходят.
Snapshot/publish/audit транзакции проверены реальными миграциями в PGlite. Это не full
Supabase/RLS, не многосоединительный concurrency test, не production latency или INP.

Флаг по умолчанию выключен, remote migrations/env не менялись. Staging-приёмка и rollout:
`docs/28_BUILDER_INCREMENTAL_AUTOSAVE_ROLLOUT.md`. Выключение flag останавливает V2 draft
writes; это не безопасный автоматический downgrade зарегистрированных версий в V1.

## 22. PERF-009: атомарное клонирование версии — 09.09.2026

Company/system actions после auth вызывают один HTTP RPC `clone_published_test_version`.
N+1 чтение/вставки содержимого в Next.js заменены set-based копированием в одной
транзакции с old→new ID mapping. Ответ — только ID черновика и признак создания.
System audit входит в транзакцию; telemetry `builder.clone` измеряет RPC и проверку
ответа, без auth, revalidation и последующей загрузки редактора.

Локальный PGlite, последний полный `npm test`: **156 мс** на один clone 5 секций /
100 вопросов / 400 вариантов (текст вопроса 2200 символов, варианта 700 символов).
Это один синтетический замер с действующими publication/revision triggers,
не PostgreSQL/Supabase staging, не cold/warm распределение и не подтверждение p95 ≤ 2 с.

Пройдены 475 Node tests, lint/typecheck/production build, 8 browser editor и 8 browser
import сценариев. Проверены структура всех типов в обоих scope, scoring/remediation/
matching IDs, неизменность источника, откат каждой стадии вместе с аудитом, права и
повторный вызов. Browser fixtures и PGlite не заменяют full Next/Supabase/RLS matrix
или конкуренцию через отдельные соединения.

Удалённые миграции/env не менялись. Staging-порог остаётся открытым; нужны минимум
30 cold и 30 warm замеров настоящего создания draft, отдельный click-to-visible и
приёмка concurrency/ролей. Инструкция: [rollout PERF-009](29_ATOMIC_TEST_VERSION_CLONE_ROLLOUT.md).

## 23. PERF-010: лёгкие списки и comparison pagination — 09.09.2026

Изменена форма данных: jobs без descriptions/scoring profiles; candidates получают
одно latest invitation на application; tests — latest/latest published summary,
version count и hasDraft; packages — SQL counts/duration; employee assessments —
SQL participant/completed counts и average fit без передачи participants.
Company/admin detail DTO отделены от list DTO. Страницы кандидатов вакансии и
импорта больше не вызывают полный job-detail loader.

Comparison query возвращает максимум 51 строку: 50 отображаемых и одну lookahead.
Filters/sort/keyset выполняются до limit в БД. Employee sessions/results/dimensions
читаются только для 50 участников страницы; lookahead исключён из дочерних reads.
Общие карточки и employee department/role options считаются отдельными invoker views.
SQL keyset проверен на 127 строках с одинаковыми/null score в обоих направлениях.

Финальный полный прогон: **489/489 Node tests**, в том числе 14 новых проверок
с родительским DB test. Lint/typecheck/production build прошли; **8/8 browser import
scenarios**. После дополнительной SQL aggregate-проверки исправлена локальная fixture:
исходный DDL candidates не имеет company_id; tenant принадлежность applications
проверяется на её реальном company_id. Полный suite повторён успешно.
19 deployment verification checks прошли в PGlite. SQL использует production DDL
и выбранные SELECT policies; auth/system-access helpers — локальные stand-ins.
Контракты HTTP используют настоящий Supabase query builder с mock transport.

Это проверка корректности/границ payload, не замер экономии bytes, p50/p95,
PostgREST embedding latency или production EXPLAIN. Удалённая миграция не применена.
Employee comparison до PERF-014 сохраняет чтение scoring JSON текущей страницы;
общий критерий полного отказа от JSON для этого route пока открыт.
Staging-проверки и порядок выпуска: [rollout PERF-010](30_DASHBOARD_LIST_READ_MODELS_ROLLOUT.md).

## 24. PERF-011: cursor ??????? ? ????????? ??????? ? 10.09.2026

?????? ?????? ??????? ?????? 51 ?????? ?? ????????? (50 + lookahead), ???????? 101
(100 + lookahead); ?????? ? UI ?????? ????????. Keyset ?? date/ID ?? ??????????
OFFSET. ??????? ? ?????????? ??????????? ? PostgreSQL. Tests/packages ??????
?? ????????? ??????? grant IDs: ?????????? ??? tenant-scoped invoker SQL-???????.
Comparison ????????? ????????????? ???????? ?? 50 ? ??????? fit/null filters.
??????????????? ??????????? ???? ? ?? ????????????? admin catalogs ?? ??????????.

???????? ????????????: SQL dataset ?? **1507 ?????**, ??? ????????, ???????,
?????????? ???? ? ??????? 1 ???; ???????? 1/50/100, ??? ??????????, ?????? ??????????
?????? ? ??????????? ??????????????? ????????, ??? ????????/?????????.
PGlite ????????? ????? migration ? ????????? production RLS policies; ????????
?????????, ??? ?????????? RLS-????????? system item ????? ?????? ???????? ?? ????
??? ????????? ???????? ??? ?? grant. Auth/access helpers ? fixture ? stand-ins.
**13/13** ????? deployment checks ??????; 19 checks PERF-010 ????? ????????.

????????? ?????? suite: **496/496 Node tests**. Lint/typecheck/production build ??????.
Sandbox ?????????? ???????? ??????? build (`spawn EPERM`), ??????????? ?????? ??????
????? ??????????? ?????????? ???????????? ????? Supabase builder. HTTP contracts
?????????? ????????? Supabase SDK ? mock transport. SSR ListControls ?????????
?????? ? filters/sort/pageSize, ????? cursor ?????? ? ?????? ?????????.
Browser E2E ? PostgREST transport ? ???? ???? ?? ???????????.

??? ???????? ?????? ?????? ? ????????????, ?? ????? bytes/p50/p95/EXPLAIN. SQL-???????
????? ????????? ?????? ?????, ??? ??????????: pushdown/????????? ?????????? ????
????????? ?? staging ????? PERF-012. ??? ???????????? ?????????? ????/fit cursor
?? ???????????? snapshot. ????????? ???????? ?? ?????????; ??????? ??????? ?
??????? ? [rollout PERF-011](31_DASHBOARD_CURSOR_PAGINATION_ROLLOUT.md).

## 25. PERF-012: локальный EXPLAIN и стоимость индексов — 10.09.2026

Добавлен `npm run perf:indexes`: две независимые синтетические PGlite БД, 47 SELECT
shapes, 30 warm повторов до/после, девять дополнительных индексов и четыре write
proxies. Сохранены полные планы/BUFFERS, времена, размеры, source hashes и проверка
одинакового результата. [Артефакт](performance/PERF012_LOCAL_2026-09-10.json) и
[методика/таблица результатов](32_QUERY_INDEX_BENCHMARK.md).

Dataset: 8 компаний, 8 000 jobs, по 32 000 applications и participants, 100 templates
и draft versions, 10 000 questions / 40 000 options. Это частичный fixture из
production CREATE TABLE, без полной истории миграций, RLS, triggers и PostgREST.
PostgreSQL 18.3 / PGlite 0.5.8, Node 24.14.0; это не staging PostgreSQL 15 baseline.

Основные DESC-списки и questions/options используют новые Index Scan. Стоимость
дополнительных индексов — 14 565 376 bytes в fixture. Application score-update p50:
1.557 → 2.540 ms; employee score-update: 1.206 → 1.983 ms. Общий набор не принят
для выпуска; стоимость отдельных индексов и реальных autosave/upsert ещё не доказана.
Точное локальное ускорение нельзя переносить на production: WASM/JIT, кеши,
последовательность фаз и rollback bloat влияют на времена.

`supabase/verification/performance_index_inventory.sql` проверен локально:
19 существующих индексов valid/ready. Регрессия 496/496, lint, typecheck и build
успешны. Миграции не созданы/не применены; staging, cold I/O, route bytes/p50/p95,
RLS/embedding/RPC pushdown и критерий autosave/upsert ≤10% остаются открытыми.

## 26. PERF-012: отдельные индексы и контроли — 10.09.2026

`npm run perf:indexes:isolate` завершил 11 пар: девять отдельных индексов и два
no-index контроля. В каждой паре две свежие PGlite БД, 47 SELECT / четыре DML proxies,
по 30 warm повторов. Все результаты SELECT до/после совпали; каталог содержит ровно
выбранные индексы. [Планы, времена и каталоги в ZIP](performance/PERF012_ISOLATED_2026-09-10.zip),
[разбор и таблица](32_QUERY_INDEX_BENCHMARK.md).

Questions/options используют Index Scan и показывают большой локальный выигрыш
чтения. Score-update times растут в нескольких парах, но существенный разброс есть
и без индексов: application score p50 в конечном контроле 1.363 → 1.907 ms.
Точные проценты причинного влияния индексов и критерий autosave ≤10% не доказаны.
Ни один индекс не принят для deployment. Следующая проверка — native staging
PostgreSQL/RLS/PostgREST и настоящие autosave/completion RPC при стабильной нагрузке.

SQL-подключение и staging-проект не определены; ответ пользователя ожидается.
Удалённых чтений/изменений не было. Проверки текущего шага: 496/496, lint, typecheck;
build прошёл при повторе вне sandbox после `spawn EPERM`. Проверен сброс completed
при неудачном повторе runner; snapshot измерявшегося runner находится в архиве.

## 27. PERF-010/011: API-проверка текущего проекта — 10.09.2026

После сообщения пользователя о применении миграции выполнен `npm run perf:remote:check`
в текущем проекте из настроек приложения. **25/25 remote checks:** OpenAPI/столбцы
пяти views, SELECT service role, запрет anon, наличие двух PERF-011 RPC и запрет их
вызова service role/anon, три embedding-контракта. Все data/RPC запросы — GET/LIMIT 0,
бизнес-строки не получались. [Артефакт](performance/PERF012_REMOTE_2026-09-10.json).

REST EXPLAIN без ANALYZE вернул **406/PGRST107**; настройки не менялись. Exact DDL,
SQL grants, index catalog, authenticated/RLS, payload/latency и performance acceptance
не подтверждены. Пользовательское сообщение и API наличие объектов не являются
доказательством exact migration history. Текущий проект не классифицирован как staging.

`supabase/verification/performance_remote_acceptance.sql` объединяет существующие
19+13 checks и index inventory в одну JSON-ячейку, read-only transaction/timeouts.
Локальный PGlite прогон этого SQL успешен; remote-результат ожидается из SQL Editor.
Два новых mock HTTP теста проверяют GET/LIMIT 0, отсутствие секретов/raw errors
в отчёте и обнаружение неожиданно разрешённого anon SELECT.
Проверки этого продолжения: **498/498 Node tests**, lint, typecheck; production build
прошёл при повторе вне sandbox после `spawn EPERM`. Remote-каталог пока не прочитан.

## 28. PERF-010/011: получена SQL-верификация — 10.09.2026

Пользователь предоставил результат SQL Editor от **09:19:59 UTC**, PostgreSQL 17.6:
[JSON](performance/PERF012_SQL_VERIFICATION_2026-09-10.json). PERF-010 **19/19** и
PERF-011 **13/13**; подтверждены проверяемые свойства views/functions, grants и
RLS enabled. История миграций, полные тела функций и фактическая JWT/RLS matrix
не входят в эти условия. Это внешнее свидетельство пользователя, не SQL-вызов агента.

В выборке **34 индекса на 16 таблицах**, все valid/ready. Индексы PERF-012 отсутствуют.
Два обычных token-индекса перекрываются с UNIQUE-индексами invitations и employee
invitations; каждый занимает 16 KiB. Ничего не удалялось. `stats_reset=null` не позволяет
трактовать idx_scan как интенсивность нагрузки; размеры таблиц не заменяют row counts.
`postgrest_plan_setting=null`; REST EXPLAIN ранее вернул 406/PGRST107.

Каталожная часть проверки завершена. PERF-012 требует реальных query plans,
representative dataset и полных autosave/completion замеров. Обновлены только
документы/JSON: проверены структура, количество/уникальность/успех checks, индексы,
ссылки и diff. Сборка и тесты приложения в этом продолжении не запускались.

## 29. Авторизованный staging в текущем проекте — 10.09.2026

По разрешению пользователя созданы два synthetic tenants, три Auth users и объёмные
list fixtures. [Отчёт](33_STAGING_LIST_ACCEPTANCE.md),
[list/grants JSON](performance/PERF012_STAGING_2026-09-10.json),
[session JSON](performance/PERF012_SESSIONS_2026-09-10.json),
[scoring JSON](performance/PERF012_SCORING_2026-09-10.json).

List/RLS/grants: **122/122**, реальные JWT A/B/dual, cursor ties/nulls, полный обход,
requested-company grants/revoke, disabled membership. Девять API shapes ×30 warm;
p95 от 308 до 532 ms, ответы примерно 6–22 KB. Это сеть + PostgREST, не Next route SLA.

Candidate/employee RPC: **75/75**, отдельный published fixture из 100 вопросов/400 вариантов.
Answer upsert p50/p95: candidate 293/313 ms, employee 291/330 ms; section из 100 ответов —
389/527 и 391/552 ms, по 30 warm. Один completion в каждой области — 328/306 ms;
retry сохраняет timestamps/answers. Эти сессии дошли до ready-for-scoring; scoring
проверен отдельным route-прогоном ниже. Нет before/after index gate.

Scoring route/finalizer: **29/29**, локальный Next `/api/assessment/complete` с флагами
в текущий Supabase. Для candidate и employee проверены claim, section save, route 200,
`completed`, `assessment_completed`, `overall_score=100`, `fit_score=100`, scoring
revision 1, result/summary/report rows и retry без роста revision. Один first completion:
candidate 6 058 ms, employee 3 092 ms; retry 693/344 ms. Это локальный dev server +
удалённый Supabase, не production SLA и не p95.

Все **226/226** staging-проверок успешны. Три аккаунта заблокированы, четыре memberships
disabled, две session invitation-ссылки expired; две completed scoring-ссылки получили
`expires_at=1970-01-01`. Тестовые данные оставлены, реальные бизнес-строки не изменялись.
Миграции, индексы и flags не менялись. Позже получены 10 SQL Editor EXPLAIN result sets без ANALYZE/JWT/RLS latency; полные browser, builder и performance-приёмка остаются открытыми. Локально **501/501 tests**, lint и typecheck
успешны после добавления scoring; ранее production build успешен. Build/dev server
повторялись вне sandbox после `spawn EPERM`. Подробная матрица и ограничения — в отчёте staging.
## 30. PERF-012: SQL Editor EXPLAIN result sets — 10.09.2026

Пользователь выгрузил 10 `EXPLAIN (FORMAT JSON, ANALYZE false)` result sets из подготовленного
SQL Editor пакета: [plans](performance/PERF012_QUERY_PLANS_2026-09-10.json),
[summary](performance/PERF012_QUERY_PLAN_SUMMARY_2026-09-10.json), свежий
[index inventory](performance/PERF012_INDEX_INVENTORY_2026-09-10_AFTER_STAGING.json).
Контекст: PostgreSQL 17.6, prefix `PERF-STAGING-342e429f`, SQL Editor role, без JWT/RLS
latency, timings и buffers.

Планы сузили черновой набор для write gate: applications date/job-date/job-fit,
participants date/fit и builder parent/order для sections/questions/options. Jobs date низкий
приоритет из-за малого staging cost/rows. RPC list templates/packages видны только как
Function Scan + Sort; DDL по ним без внутреннего плана не обоснован. Индексы не добавлены;
before/after write gate ≤10% остаётся обязательным перед deployment SQL.
## 31. PERF-012: before write-gate baseline и RLS check — 10.09.2026

Rollback-wrapped `EXPLAIN (ANALYZE, BUFFERS, WAL, SETTINGS, FORMAT JSON)` снят до добавления
индексов. `candidate_applications` update 100: 43.121 ms, WAL 159734 bytes, 39 dirtied blocks.
`employee_assessment_participants` update 100: 8.579 ms, WAL 69121 bytes, 12 dirtied blocks;
planner использует существующий `idx_employee_assessment_participants_assessment` для target selection.
Builder options reorder 100: 50.020 ms, WAL 74772 bytes, 4 dirtied blocks; использован temporary
draft fixture в транзакции с rollback, потому что published version была корректно заблокирована guard-ом,
а существующие draft versions не имели контента.

После пользовательского RLS prompt проверены `test_templates`, `test_versions`, `test_sections`,
`questions`, `answer_options`, `candidate_applications`, `employee_assessment_participants`:
7/7 имеют RLS enabled, force RLS=false, policies>=2. Нулевых policy tables не найдено.
Артефакты сохранены в `docs/performance/PERF012_WRITE_GATE_BEFORE_*` и
`PERF012_RLS_CATALOG_CHECK_2026-09-10.json`. Индексы всё ещё не добавлены; следующий шаг —
по одному DDL-кандидату с after EXPLAIN/read+write gate.
## 32. Builder/browser acceptance retry — 10.09.2026

После решения остановить PERF-012 без DDL выполнен следующий безопасный acceptance step.
Targeted Node regression для builder/session paths прошёл: **164/164**; затем полный `npm test` прошёл **501/501**, `npm run lint` и `npm run typecheck` успешны. Команда targeted regression покрыла
builder V2 DB/RPC, builder import lazy/actions, builder editor pure logic, assessment answer,
section save и completion V2 DB flows.

Browser fixtures `test:browser:builder-import`, `test:browser:builder-editor` и
`test:browser:navigation` собрались и подняли synthetic servers на 4319/4320/4318. DOM статус
`#result[data-status]` не подтверждён: in-app browser CUA transport в текущем окружении закрыт.
Артефакт: `docs/performance/PERF012_BUILDER_BROWSER_ACCEPTANCE_2026-09-10.json`.

## 33. PERF-013: logical report test title lookup — 10.09.2026

Первый non-schema шаг PERF-013 убирает последовательный lookup `test_versions -> test_templates`
из candidate и employee report loaders. Candidate sessions теперь запрашивают
`test_versions(..., test_templates(title))`; employee report title lookup делает один запрос
к `test_versions` с nested `test_templates(title)` и больше не делает отдельный `.from("test_templates")`.
Это сохраняет `resolveReportTestTitle`: logical template title приоритетен, version title остаётся fallback.

Дополнительно candidate/employee report pages разделены на summary и details без изменения схемы:
primary loader больше не читает answers и integrity event rows; отдельные details loaders под Suspense
читают answers страницами по 50 и integrity events страницами по 100. С 11.09.2026 независимые
URL-параметры `answersPage`/`eventsPage` управляют страницами, запросы используют стабильный порядок
`created_at, id` и `occurred_at, id`, а дополнительная строка определяет наличие следующей страницы.
Счётчики answers и integrity summary относятся к отображаемой странице, что явно отмечено в UI.
Добавлены performance operation labels `reports.candidate_details` и `reports.employee_details`, чтобы
summary/details можно было измерять отдельно.

Проверки: targeted report tests 7/7, `npm run typecheck`, `npm run lint`, `npm run build`,
`npm test` (507/507), включая отказ перезаписывать существующий PERF-013 evidence до remote access.

### Staging acceptance report pages — 11.09.2026

`npm run staging:reports -- --execute http://127.0.0.1:4325` проверил локальную production-сборку
против текущего Supabase на существующих PERF-012 synthetic report fixtures. Результат: 75/75 checks,
candidate/employee first/second page возвращают HTTP 200, маркеры summary/details присутствуют, ответы
передаются 11–13 HTTP chunks. Первый chunk стабилен на 7,182 bytes; полный first-page HTML/RSC —
77,373 bytes для candidate и 76,426 bytes для employee, то есть details не блокируют первый chunk.

Пять warm HTTP samples на shape:

| Shape | TTFB p50 / p95 | Total p50 / p95 | Max bytes |
| --- | ---: | ---: | ---: |
| candidate first page | 307 / 333 ms | 2,485 / 2,521 ms | 77,373 |
| candidate second page | 313 / 327 ms | 2,182 / 2,235 ms | 58,022 |
| employee first page | 315 / 326 ms | 2,947 / 3,303 ms | 76,426 |
| employee second page | 323 / 342 ms | 2,387 / 2,653 ms | 57,857 |

Артефакт: `docs/performance/PERF013_STAGING_2026-09-11.json`. Три временных пользователя от
acceptance/retry прогонов заблокированы, их memberships disabled; read-only shutdown audit 3/3.
Схема, flags и business rows не менялись. Это локальный Next server + удалённый Supabase, не deployment
приложения. Fixture содержит 20 answers и не пересекает заполненную границу 50/100; page 2 и URL/control
path проверены на пустой странице, high-cardinality traversal остаётся ограничением evidence.

## 34. PERF-015: completion pipeline, первая итерация — 11.09.2026

V2 completion теперь передаёт финализатору подтверждённую RPC готовность и уже проверенные owner/invitation IDs.
Это убирает повторный invitation/session preflight только после ответа `ready` от service-only
`complete_assessment_session_v2`; legacy completion по-прежнему выполняет полную проверку. Candidate и employee
scoring больше не читают `assessment_package_tests`, когда все session rows содержат замороженные weight/required/
passing/contribution значения; fallback для старых неполных snapshots сохранён. Persistence остаётся одним
атомарным `try_persist_scoring_snapshot`, normal completion и recalculation используют ту же модель revision.

Локальная production-сборка против текущего Supabase прошла **29/29** checks для обоих scope: persisted result,
summary/report, `assessment_completed`, revision 1 и idempotent retry. Один телеметрический sample на scope:

| Scope | First completion | Retry | finish-session RPC | calculation | persistence RPC |
| --- | ---: | ---: | ---: | ---: | ---: |
| candidate | 3 490 ms | 326 ms | 460 ms | 1.30 ms | 631 ms |
| employee | 3 097 ms | 293 ms | 292 ms | 0.19 ms | 320 ms |

[Артефакт](performance/PERF015_STAGING_2026-09-11.json) содержит route и коррелированные server-operation
метрики. Это единичные samples локального сервера с удалённой БД, не p95 и не production SLA. Первый completion
остаётся выше условного порога 2 секунд; durable `scoring_jobs`/worker требует изменения схемы и не выполнялся
согласно решению не менять схему. Созданы только synthetic fixture rows, обе completed invitation-ссылки погашены;
remote flags, схема и реальные бизнес-строки не менялись.

Проверки после изменения: `npm test` 507/507, `npm run typecheck`, `npm run lint`, `npm run build`,
`git diff --check`.

## 35. PERF-014: materialized employee comparison dimensions — 12.09.2026

Employee scoring теперь формирует comparison dimensions тем же `collectAssessmentDimensions`, который ранее
выполнялся только при чтении страницы. Новый `employee_assessment_dimension_scores` хранит нормализованные строки
текущей `scoring_revision`. Обновлённый `try_persist_scoring_snapshot` заменяет их в одной транзакции с result,
summary, report и participant aggregate; ошибка dimension writer откатывает весь snapshot.

Employee comparison делает одну tenant-scoped выборку materialized rows для текущей страницы до 50 участников.
Если у исторического scored participant ещё нет строк текущей revision, legacy JSON/competency reads выполняются
только для missing participant IDs. Это позволяет применить migration и развёртывать код до полного backfill без
потери данных сравнения.

Таблица защищена RLS `is_company_member(company_id)`, browser role имеет только SELECT. Внутренние snapshot и
dimension writers закрыты от `public`, `anon`, `authenticated` и прямого вызова `service_role`; наружу оставлены
атомарная wrapper RPC и идемпотентный service-only backfill RPC. Writer блокирует participant, сверяет revision и
проверяет принадлежность каждой session/version пары.

Локальные проверки: targeted regression 46/46, полный `npm test` 513/513, `npm run typecheck`, `npm run lint`,
`npm run build`, `git diff --check`. PGlite выполняет реальную migration и read-only verification, проверяя initial
insert, замену revision, stale conflict, idempotent backfill и rollback при чужой session. Пользователь сообщил о
применении remote migration 12.09.2026. Первая read-only verification подтвердила все 12 catalog/RLS/grant/RPC
проверок и нулевые tenant/session/stale mismatches; coverage показал 5 исторических scored participants без строк.

Локальная production-сборка против текущего Supabase прошла staging scoring acceptance **30/30**: candidate и
employee completion, persisted result/summary/report, revision 1 и idempotent retry; employee path дополнительно
проверил materialized dimension с корректными participant/session/version, group/domain/source и percentage 100.
Candidate/employee first completion заняли 3 073/2 769 ms, retry — 298/306 ms; это единичные samples, не p95.
Shutdown 2/2 погасил обе synthetic invitation-ссылки. [Артефакт](performance/PERF014_STAGING_2026-09-12.json).
Финальная post-acceptance verification подтвердила `row_count=1`, валидную staging dimension и нулевые
tenant/session/stale mismatches. Coverage осталось 5: эти исторические participants читаются через bounded fallback;
полный backfill не является условием безопасного rollout. [SQL evidence](performance/PERF014_FINAL_VERIFICATION_2026-09-12.json).
Порядок выпуска: [PERF-014 rollout](34_PERF014_EMPLOYEE_DIMENSIONS_ROLLOUT.md).

## 36. PERF-016: system reference cache, первый срез — 12.09.2026

Профиль организации больше не читает полный `system_cities` на каждый request. Server-only cache хранит только
глобальные reference-поля `id`, `name`, `is_active`, использует ключ `reference/system-cities/v1`, tag
`reference:system-cities` и TTL один час. Admin create/update немедленно вызывают `updateTag`; write-path профиля
по-прежнему валидирует выбранный город прямым запросом к БД. Admin city list с live company counts не кэшируется.

Import schema v1/v2 получила публичную HTTP cache policy `max-age=300, s-maxage=86400,
stale-while-revalidate=604800`; query `version` разделяет URL cache keys. Production HTTP smoke вернул 200,
корректные `talvia.test.v1`/`talvia.test.v2` и разные download filename.

Shared cache не содержит tenant/user/token/session/answer/scoring data. Published assessment content и tenant-scoped
system test/package metadata оставлены без cache до безопасного разделения immutable content и live access/state.
Проверки: targeted 7/7, полный `npm test` 516/516, `npm run typecheck`, `npm run lint`, `npm run build`,
`git diff --check`. Migration, remote data и flags не менялись. [Rollout](35_PERF016_REFERENCE_CACHE_ROLLOUT.md).

## 37. PERF-017: local runtime modes и placement inventory — 12.09.2026

Одинаковый no-DB endpoint `/api/tests/import-schema?version=v2` измерен на локальной Windows-машине под Node.js
v24.14.0 и Next.js 16.3.1. Для каждого режима выполнены один first request и 20 последовательных warm requests.

| Режим | First | Warm p50 | Warm p95 | Warm min/max |
| --- | ---: | ---: | ---: | ---: |
| `next start` | 116.24 ms | 6.70 ms | 11.30 ms | 5.19/14.24 ms |
| `next dev` | 484.24 ms | 15.31 ms | 21.50 ms | 12.71/26.22 ms |

Все ответы: HTTP 200, 24 445 bytes, ожидаемые filename и public cache policy. Evidence:
[production](performance/PERF017_LOCAL_PRODUCTION_2026-09-12.json),
[development](performance/PERF017_LOCAL_DEVELOPMENT_2026-09-12.json). Это local mode comparison без DB/network
path, concurrency и cold-start контроля; оно не является SLA.

Repository inventory не обнаружил hosting/region config или runtime region env. Рабочая копия находится под
OneDrive; README теперь рекомендует отдельную несинхронизируемую копию при замедлении `.next`/`node_modules`.
Фактические deployment runtime и Supabase Postgres regions остаются неизвестны; конфигурация региона ожидает
точное значение из Supabase Dashboard и выбор hosting provider. [Gate](36_PERF017_RUNTIME_PLACEMENT.md).

## 38. Browser/UI acceptance retry — 12.09.2026

Повторно собраны и подняты три synthetic browser fixtures: assessment navigation на 4318, builder import на 4319
и builder editor на 4320. Для каждой fixture HTML и JavaScript bundle отвечают HTTP 200; размеры bundles —
1 851 072, 1 507 794 и 1 521 373 bytes соответственно. После проверки все локальные servers остановлены.

После подключения Chrome extension DOM acceptance пройдена: navigation **30/30**, builder import **8/8**,
builder editor profiling — `data-status=passed` для large-editor profile и семи CRUD/type/drag/V2 save/publish/
conflict scenarios. Development React Profiler: initial mount 122.7 ms, 10 edit samples p50/p95 11.3/20.6 ms,
3 589 DOM nodes при одном раскрытом вопросе. Это synthetic development fixture, не INP и не staging p95.
[Evidence](performance/PERF017_BROWSER_UI_RETRY_2026-09-12.json). Remote DB, схема и данные не затрагивались.

Дополнительный manual fixture mode позволил проверить настоящий Chrome mouse pointer path без подмены
`setPointerCapture`/`elementFromPoint`: вопрос 101 перетащен с первой позиции в конец секции 1, после Save
зафиксирован порядок `102, 103, 101` и `data-status=saved`. Затем автоматический editor suite повторно получил
`data-status=passed`. Native touch и cross-section autoscroll этим шагом не проверены.
