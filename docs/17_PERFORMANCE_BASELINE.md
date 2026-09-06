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
