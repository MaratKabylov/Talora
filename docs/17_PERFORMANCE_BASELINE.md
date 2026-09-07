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
- `builder.load`, `builder.import_sources`, `builder.save`.

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
