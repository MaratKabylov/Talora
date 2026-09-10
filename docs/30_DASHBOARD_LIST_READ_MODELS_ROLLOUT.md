# PERF-010 — лёгкие модели списков

Обновлено: 2026-09-10. Код реализован и локально проверен. Пользователь сообщил о
применении миграции; в текущем проекте подтверждены пять views, контракты столбцов
и ограничения anon через GET/LIMIT 0. [Remote API smoke](32_QUERY_INDEX_BENCHMARK.md):
25/25. Получен [SQL-результат пользователя](performance/PERF012_SQL_VERIFICATION_2026-09-10.json):
PERF-010 19/19, включая security_invoker, grants и base RLS enabled. Полные тела
определений, полноценная JWT/RLS matrix и performance-приёмка остаются открытыми.
Полный запрет scoring JSON для employee comparison остаётся открытым до PERF-014.
После разрешения на тестовые данные пройден [реальный list/RLS staging suite](33_STAGING_LIST_ACCEPTANCE.md):
122 assertions, grant/revoke и dual membership, девять API baseline queries.
Это ограниченная backend-приёмка; browser/full scoring paths и полный route payload открыты.

## Изменения

- Jobs: отдельный `JobListItem`, только поля таблицы и название пакета.
  Страницы кандидатов вакансии и импорта используют краткий job context без
  descriptions, scoring profiles, весов и списка доступных пакетов.
- Candidates: PostgREST ограничивает вложенное `invitations` до одной строки,
  сортирует по `created_at DESC, id DESC`. То же ограничение применяется к
  приглашениям в списке участников оценки сотрудников. Отсутствующее или
  недоступное по RLS приглашение остаётся `null`; token нужен существующему HR UI.
- Tests: `test_template_list` возвращает latest version, latest published version,
  version count и has draft. Считаются только версии, видимые вызывающему через RLS.
  Последняя опубликованная версия сохранена отдельно: новый draft не должен
  вытеснять её в таблице системных тестов. Описания, инструкции и settings отсутствуют.
- Packages: `assessment_package_list` считает test count в SQL через те же видимые
  version/template joins, что использовал прежний normalizer. Для admin-таблицы
  сохранены агрегаты количества обязательных тестов и длительности. Описание
  показывается на detail-странице; строки состава в список не передаются.
- Employee assessments: `employee_assessment_list` считает participant/completed
  counts и average fit в SQL. Среднее учитывает все ненулевые fit, как раньше;
  для пустой оценки counts = 0, average = null.
- Company и admin списки тестов/пакетов используют одинаковые лёгкие DTO.
  Импорт системного теста получает hasDraft и latest version number из summary.
  Полные DTO detail/builder сохранены отдельно.

## Comparison и границы следующих задач

Оба compare route применяют status/recommendation/risk filters и сортировку в БД.
Employee дополнительно фильтруется по department/role через `employees!inner`.
Keyset `(fit_score, id)`: fit asc/desc, nulls last, ID asc. Ранее одинаковые fit
досортировывались по имени в Next.js; теперь стабильный порядок задаётся ID.
Страница содержит 50 строк, запрос читает 51 для определения следующей страницы.
Lookahead-участник не попадает в загрузку employee dimensions.

Cursor кодируется base64url, проверяются размер, JSON, UUID, диапазон score и
контекст company/parent/filter/sort. Некорректный или устаревший cursor открывает
первую страницу. Он не является полномочием доступа: company/parent filter и RLS
применяются независимо. Фильтры/cursor находятся в URL; смена формы сбрасывает cursor.
Есть переходы «Следующие 50» и «К началу», назад — история браузера.

`job_comparison_summary` и employee list view сохраняют общие карточки по всей
вакансии/оценке, независимо от фильтров и страницы. `employee_comparison_filters`
возвращает distinct department/role values без передачи всех участников.
Группы/столбцы employee dimensions строятся по текущей странице; явно выбранная
группа сохраняется в URL даже при отсутствии значений на странице.

В PERF-010 остальные верхнеуровневые коллекции ещё не были пагинированы.
Текущая реализация страниц 50/max 100 описана в
[rollout PERF-011](31_DASHBOARD_CURSOR_PAGINATION_ROLLOUT.md); comparison сохраняет 50.
PERF-014 отвечает за материализованные employee dimensions: до неё сравнение
читает scoring JSON только для текущих максимум 50 участников и использует
прежний `collectAssessmentDimensions`. Поэтому общий критерий PERF-010
«list routes не получают scoring JSON» пока не выполнен для employee compare.
Не менять scoring persistence и не удалять V2 dimensions ради формального закрытия.

## Миграция и безопасность

- Миграция: `supabase/migrations/20260909140000_dashboard_list_read_models.sql`.
- Пять views имеют `security_invoker=true`. Требуется PostgreSQL 15+.
- Views доступны только на SELECT для authenticated/service_role; anon/public
  grants отсутствуют. Права и RLS исходных таблиц продолжают действовать внутри
  lateral-подзапросов и агрегатов; security-definer обхода нет.
- Dashboard использует session client. Admin перед service client проверяет
  `requirePlatformContext`, а запрос ограничен `is_system=true, company_id IS NULL`.
- Новых env, production-флагов и индексов нет. Views не требуют backfill.
  Индексы/EXPLAIN — PERF-012 после замеров реальных запросов.

## Локальные проверки

- `tests/list-read-models-db.test.ts`: реальный migration SQL, production business
  DDL и выбранные действующие SELECT policies в PGlite. Auth/membership/system
  access helpers — локальные stand-ins; это не полная Supabase RLS matrix.
- SQL contracts фиксируют колонки, invoker options, SELECT-only grants и base RLS;
  проверяются видимость company/system/draft, counts/average, null/empty,
  отказ anon, отсутствие чужих tenant-строк и SQL keyset на 127 строках с ties/nulls.
- `tests/list-read-models.test.ts`: настоящая библиотека Supabase формирует HTTP
  запросы с mock transport; проверяются select, tenant/grant filters, embedded
  invitation limit/order, compare limit/filters, bounded child reads, ошибки и auth.
  Этот тест не исполняет PostgREST embedding на реальном сервере.
- Lint, typecheck, production build и полный Node suite пройдены; итоговые числа —
  в [CURRENT_STATE](CURRENT_STATE.md). Browser import regression: 8/8 сценариев.
  Chrome потребовал разрешённый запуск вне sandbox из-за IPC access denied.

## Порядок выпуска и приёмка

1. С разрешением на удалённое применение проверить PostgreSQL version, историю
   миграций и существующие RLS/grants. Применить новую миграцию **до** deploy кода.
2. Выполнить `supabase/verification/dashboard_list_read_models.sql`:
   все 19 строк должны иметь `passed=true`. Это read-only проверка структуры,
   не замена выполнению запросов под реальными пользовательскими JWT.
3. Под owner/recruiter/viewer компаний A/B проверить все пять списков и обе
   comparison-страницы. Проверить inactive membership, anon, system access grant/
   revoke, published/archived/draft, отсутствие приглашений и ограничения viewer.
4. На нескольких applications с длинной историей invitations проверить через
   PostgREST ровно одно latest invitation **на каждого** родителя, включая ties.
   Убедиться, что limit дочерней связи не ограничивает список applications.
5. На >100 участниках сравнить SQL counts/average с контрольным запросом,
   пройти asc/desc страницы с одинаковыми/null fit; проверить URL filters,
   пустую выборку, reset, back navigation, переход в отчёт и shortlist action.
   При конкурентном изменении fit между запросами snapshot страниц не гарантирован.
6. Сверить admin package duration/required counts, импорт в существующий system
   test с draft, последнюю опубликованную версию при более новом draft/archive.
7. Собрать payload bytes, query count и p50/p95 cold/warm на dataset baseline.
   Проценты ускорения и SLA локальной компиляцией/fixture-тестами не подтверждены.

При отсутствии view loader возвращает ошибку; автоматического тяжёлого fallback
нет. При необходимости откатить только приложение на предыдущую версию,
оставив совместимые read-only views. Удаление views не нужно для такого отката.
