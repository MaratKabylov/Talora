# Staging-проверка списков, доступа и assessment RPC в текущем проекте

Дата: 2026-09-10. Пользователь явно разрешил использовать текущий Supabase-проект
с созданием тестовых компаний, пользователей и результатов. Выполнены реальные
Auth/PostgREST/RLS проверки списков PERF-010/011 и baseline API для PERF-012.
Это не приёмка всего приложения и не отдельная копия production-окружения.

## Результат

**122/122 assertions**: 104 в основном прогоне, 18 в проверке системных grants.
Дополнительно четыре независимые проверки подтвердили отключение тестовых доступов.
[Полный JSON](performance/PERF012_STAGING_2026-09-10.json) содержит результаты,
сырые времена замеров, IDs созданных компаний/аккаунтов и проверки завершения.
Пароли, JWT, invitation tokens и содержимое ответов/персональные данные не записаны.

Проверено через реальный Supabase Auth с тремя отдельными паролями/JWT:

- Два пользователя с одной компанией и третий с обеими; изоляция jobs,
  applications, participants, test/package/assessment views. Попытка обновления
  чужой тестовой вакансии не затронула строку; значение отдельно сверено service role.
- RPC tests/packages соблюдают target_company_id даже для пользователя двух tenants.
- Полный обход 1 107 заявок, jobs и participants в обе стороны по датам; страницы
  50/100, одинаковые даты и микросекунды, серверный status filter; без пропусков/повторов.
- Оба comparison: fit asc/desc, одинаковые scores, null-tail, полный обход.
- Templates/packages RPC и assessments view: полный cursor-обход asc/desc.
- Inner-поиск имени, пустой поиск, одно latest invitation на каждого из трёх
  родителей при двух созданных invitations на родителя.
- Системный опубликованный package и составляющие его templates: до grant скрыты;
  grant A открывает их A, но не B, даже при dual membership. Перенос созданного grant
  A → B отзывает доступ A и открывает B; disabled membership закрывает B.

Существующие системные templates/package читались только по ID/status для выбора
сценария; их содержимое и публикации не менялись. Менялись только grants тестовых
компаний. Новых platform roles, SQL функций, индексов или feature flags нет.

## Набор данных и состояние после прогона

Префикс: **`PERF-STAGING-342e429f`**, run ID:
`342e429f-819f-4f68-9a18-d249fd8b4f7d`.

| Объект | Компания A | Компания B |
| --- | ---: | ---: |
| Jobs | 121 | 5 |
| Candidates / applications | 1 107 | 207 |
| Templates / draft versions | 61 | 3 |
| Packages | 35 | 3 |
| Employee assessments | 107 | 3 |
| Employees / participants | 137 | 17 |
| Invitations | 6 | 6 |

В A на первой вакансии 554 applications; participants принадлежат первой оценке.
`completed` и scores при seed — синтетические входные данные для проверки списков,
**не результат выполнения completion/scoring pipeline**. Здесь нет 100 опубликованных
версий, assessment questions/answers/integrity dataset из полного PERF-плана.

Созданы три Auth-пользователя, их profiles и четыре memberships. После обоих прогонов
все memberships имеют `disabled`, три пользователя заблокированы на 8 760 часов,
Auth sessions отозваны. Отдельное чтение Auth/memberships это подтвердило.
Тестовые компании и данные сохранены для разбора; удаления не выполнялись.
Существующие бизнес-строки других компаний не менялись. Для удаления fixture нужно
отдельное разрешение и проверка принадлежности по run ID/manifest, а не по общему префиксу.

## Замеры API

Девять сценариев, каждый — отдельный first sample и **30 warm повторов**.
В таблице времена округлены до ms; байты — максимум размера декодированного JSON
ответа (не сжатые сетевые bytes). Секретные поля/строки не сохранялись.

| Запрос | p50 ms | p95 ms | Max JSON bytes |
| --- | ---: | ---: | ---: |
| jobs | 294 | 308 | 10 958 |
| templates RPC | 486 | 532 | 22 273 |
| packages RPC | 301 | 344 | 7 426 |
| assessments view | 301 | 530 | 14 686 |
| candidates | 365 | 388 | 10 827 |
| job candidates | 332 | 360 | 9 955 |
| participants | 297 | 421 | 9 903 |
| candidate comparison | 330 | 374 | 8 315 |
| employee comparison | 302 | 327 | 6 424 |

Это последовательные вызовы с рабочей машины до Supabase, включая сеть, чтение JSON
и SDK. First sample снят после других проверок и **не является cold start**. Для
jobs/tests/packages/assessments использованы production select constants; candidate
и employee projections сокращены, включая сравнение сотрудников без scoring JSON.
Это не bytes/latency полноценных Next.js routes и не browser Web Vitals. Регион
runtime/Supabase, RTT отдельно и concurrent load здесь не измерялись. Baseline до
изменения индексов отсутствует; ускорение или SLA из этих чисел не заявляется.

## Воспроизведение

Нужны существующие env Supabase и разрешение на тестовые записи в выбранном проекте.
Команды требуют явный `--execute` и создают новые отдельные fixtures:

```bash
npm run staging:lists -- --execute artifacts/performance/staging-new-run
npm run staging:grants -- --execute artifacts/performance/staging-new-run/report.json
```

Первый script не перезаписывает существующий manifest, чтобы не потерять IDs
оставленных удалённых записей. Второй сверяет fingerprint проекта, metadata
perf_run_id аккаунта и имена обеих компаний; использует только test dual user,
временно возвращает его доступ, затем снова отключает. При существующих grants
отказывается их перезаписывать. Все отчёты имеют completed/shutdown status.
При прерывании процесса до finally нужно отдельно проверить shutdown; наличие
файла само по себе не означает успешное завершение. Пароли генерируются в памяти.

## Что остаётся

- SQL EXPLAIN и стоимость индексов: SQL connection отсутствует, REST plan format
  ранее возвращал 406/PGRST107. Ни migration, ни настройка PostgREST не менялись.
- Scoring finalizer, полный consent/token lifecycle, successor/concurrent completion,
  draft/published builder write flows и критерий записи ≤10% остаются открытыми.
  RPC-прогон ниже не заменяет browser/server-action acceptance.
- Browser E2E/Next.js route latency, admin roles/PII и остальные RLS paths вне
  перечисленной матрицы остаются отдельной приёмкой.
- PERF-012 целиком открыт. Уже подтверждённые 25 API smoke и 32 SQL-каталожных
  условия сохранены в [предыдущем отчёте](32_QUERY_INDEX_BENCHMARK.md).

После реального прогона scripts получили только защиту manifest от перезаписи;
этот fail-fast путь проверен локальным тестом без удалённых вызовов. Измерения и
утверждения RLS относятся к выполненным запросам из сохранённого JSON.

## Дополнение: сохранение и завершение сессий

[Session JSON](performance/PERF012_SESSIONS_2026-09-10.json): **75/75 checks**;
в сумме с list/grants — **197/197**. Создан отдельный private template/version
в синтетической компании A: один раздел, 100 single-choice вопросов, 400 вариантов.
Содержимое создано в draft, затем версия опубликована и не изменялась.
Добавлены package и кандидатская/employee цепочки person/context/owner/invitation/session.
Новые Auth users не создавались, ранее отключённые пользователи не активировались.

В обеих областях проверены четыре server-only RPC: anon-deny, claim, incomplete
completion, отказ при неверном token/session/client без изменения сессии/ответов,
upsert одного ответа и раздела из 100 ответов без дублей, сохранённые option IDs/time,
атомарный отказ duplicate-question batch, completion → ready, освобождение lease,
сохранность ответов, идемпотентный retry и отказ late autosave.
Ready означает готовность к отдельному scoring finalizer; итоговые scores не вычислялись.
Согласие и started/in_progress заданы как synthetic fixture: UI согласия/старта не проходился.
Wrong-session использовал несуществующий UUID; межтенантовая подмена реальной
assessment-сессии здесь не проверялась.

| Scope / RPC | Warm n | p50, ms | p95, ms |
| --- | ---: | ---: | ---: |
| Candidate answer upsert | 30 | 293 | 313 |
| Candidate section, 100 answers | 30 | 389 | 527 |
| Employee answer upsert | 30 | 291 | 330 |
| Employee section, 100 answers | 30 | 391 | 552 |

Completion выполнен по одному разу: candidate 328 ms, employee 306 ms; это не p95.
Измерения включают сеть текущей машины и PostgREST; нет сравнения до/после индексов,
SQL execution time, cold I/O или доказательства ограничения регрессии ≤10%.

Обе созданные invitation-ссылки переведены в expired в finally. Независимые 6/6 проверок
подтвердили expiry, четыре disabled memberships и ban трёх test users.
Fixture-записи оставлены для проверки по IDs из JSON; опубликованная версия сохранена.

Повтор для нового list manifest:

```bash
npm run staging:sessions -- --execute artifacts/performance/staging-new-run/report.json
```

Script проверяет fingerprint/имя synthetic tenant и отказывается перезаписывать
sessions-report.json до удалённых вызовов. Он пишет только новые fixture-объекты;
token/client/device IDs остаются в памяти. При аварийном завершении проверять manifest
и expiry отдельно. Remote migrations, индексы и feature flags не изменялись.

Итоговые локальные проверки: **500/500 tests**, lint, typecheck, production build.
Build повторён вне sandbox после `spawn EPERM` на TypeScript worker. Локальные тесты
проверяют ownership/manifest guard до любых удалённых запросов.
