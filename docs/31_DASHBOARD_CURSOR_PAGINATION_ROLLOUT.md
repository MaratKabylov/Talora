# PERF-011 — страницы списков и серверные фильтры

Обновлено: 2026-09-10. Код реализован; результаты локальных проверок — в
[CURRENT_STATE](CURRENT_STATE.md). Удалённая миграция и staging-приёмка не выполнены.

## Поведение

- Страница по умолчанию — 50 строк, максимум — 100. Запрос читает одну дополнительную
  строку для next cursor; она не отображается. Offset и загрузки всех страниц циклом нет.
- `lib/lists/pagination.ts` задаёт keyset `(created_at|updated_at, id)`, дату asc/desc,
  ID asc. Сохраняются шесть знаков микросекунд PostgreSQL, без округления через JS Date.
- Base64url cursor валидируется на сервере: размер, JSON, UUID, timestamp, контекст
  route/company/parent/filter/sort/pageSize. Невалидный или устаревший cursor открывает
  первую страницу. Cursor не является полномочием доступа и не содержит PII/tokens.
- GET-формы и ссылки хранят поиск, фильтры, сортировку, pageSize и cursor в URL.
  Смена формы сбрасывает cursor. Есть «Следующая страница» и «В начало»;
  предыдущие страницы доступны через историю браузера.
- Счётчики строк подписаны «На странице», а не как общее количество результатов.
  Сохранены таблицы, действия, пустые состояния и существующие loading/error boundaries.

## Маршруты

| Route | Порядок по умолчанию | Серверные фильтры |
| --- | --- | --- |
| `/dashboard/candidates` | created_at DESC, id ASC | имя кандидата, статус, requires_review |
| `/dashboard/jobs/[id]/candidates` | created_at DESC, id ASC | то же + обязательный job_id |
| `/dashboard/employee-assessments/[id]` — участники | created_at DESC, id ASC | имя, статус, requires_review + assessment_id |
| `/dashboard/jobs` | updated_at DESC, id ASC | название, статус |
| `/dashboard/tests` | updated_at DESC, id ASC | название, статус, system/company |
| `/dashboard/packages` | updated_at DESC, id ASC | название, system/company |
| `/dashboard/employee-assessments` | updated_at DESC, id ASC | название, статус |
| `/admin/companies` | created_at DESC, id ASC | название, статус |
| `/admin/applications` | created_at DESC, id ASC | компания, статус, requires_review |
| `/admin/users` | created_at DESC, id ASC | имя, компания, статус |
| `/admin/audit` | created_at DESC, id ASC | действие, компания |

Оба comparison route сохраняют реализацию PERF-010: страницы по 50, keyset
`(fit_score, id)`, nulls last, серверные фильтры и общий summary родителя.
Это укладывается в максимальный размер 100; выбор размера в comparison не добавлен.

Tests/packages теперь имеют единый порядок по дате между system/company; разделы
библиотеки тестов группируют только текущую страницу. Фильтр источника позволяет
просматривать системные или собственные материалы отдельно.

## Миграция и доступ

`20260909160000_dashboard_list_pagination.sql` зависит от PERF-010 views.
Добавляет две SQL-функции: `list_company_test_templates(uuid)` и
`list_company_assessment_packages(uuid)`. Они возвращают строки существующих
лёгких views. PostgREST применяет поиск, фильтры, keyset/order/limit в PostgreSQL.
Полные массивы grant/package IDs больше не передаются в Next.js для этих списков.

Функции — STABLE, SECURITY INVOKER, с пустым search_path. EXECUTE разрешён только
authenticated; public/anon/service_role отозван. Проверяется `is_company_member`
для переданной компании, company ownership или её system-access helper. RLS
исходных views/таблиц остаётся действующей. Grant другой компании, членом которой
также является пользователь, не даёт системный материал выбранной компании.

Dashboard использует session client и company из `requireCompanyContext`; основные
запросы имеют явный tenant filter или target_company_id RPC. Admin выполняет
`requirePlatformContext` до service client. Глобальные admin-списки намеренно
межкомпанейские; выбранный company filter применяется в БД. Ограничения PII для
analyst сохраняются. Невалидный admin company UUID даёт пустую выборку.
Нет новых env, production-флагов, индексов или backfill.

## Проверки и ограничения

- HTTP contract tests с настоящим Supabase builder/mock transport: select, tenant,
  parent, inner search, latest invitation, page limit, cursor, ошибки, admin/PII.
- PGlite: production migration/views/выбранные RLS policies; auth/membership/system
  helpers — локальные stand-ins. Отдельно проверены requested-company access и revoke.
- SQL dataset: 1507 строк, две компании, статусы, одинаковые даты и разница 1 мкс;
  полный обход отфильтрованной выборки в обе стороны со страницами 1/50/100,
  без повторов/пропусков. Comparison ties/null regression сохранена.
- SSR настоящего ListControls проверяет URL ссылок, значения фильтров, reset и empty.
  Это не browser E2E и не реальный PostgREST transport.
- Вспомогательные справочники форм (например выбор пакета в карточке оценки),
  detail/report routes, admin monitoring/team/system catalogs вне списка первой
  очереди не переведены на новый контракт. Не считать их объём ограниченным этим шагом.
- При конкурентном изменении sort date/fit список не является snapshot: строки могут
  перемещаться между страницами. Гарантия без пропусков относится к неизменной выборке.
- Payload bytes, p50/p95, execution plans и pushdown через SQL-функции не измерены.
  Их проверка на реальном объёме — staging и PERF-012; ограничения ответа не доказывают
  стоимость вычисления SQL read model.

## Выпуск

1. После разрешения на удалённое применение проверить историю миграций и PostgreSQL 15+.
   Применить PERF-010, затем PERF-011, **до** deploy приложения.
2. Выполнить `supabase/verification/dashboard_list_pagination.sql`: 13 строк,
   все `passed=true`; также проверить 19 checks PERF-010.
3. Под реальными JWT двух tenants и пользователя с обеими memberships проверить
   все перечисленные маршруты, system grants/revoke, anon и inactive membership.
   Для admin проверить support/admin/analyst и ограничение company.
4. На >1000 строках пройти страницы asc/desc с ties, смену фильтров, reset, Back,
   пустые результаты, устаревший cursor, возврат из detail/action и ошибки загрузки.
   Через PostgREST проверить inner search и ровно одно invitation на родителя.
5. Снять payload/latency/EXPLAIN для query shapes и SQL-функций. Не создавать индексы
   без подтверждения плана (PERF-012). Зафиксировать staging acceptance отдельно.

Откат приложения допускает сохранение добавленных read-only функций. Старый код
использует прежние queries, функции не меняют данные или политики. Удаление функций
не нужно для отката; destructive/downgrade требует отдельного разрешения.
