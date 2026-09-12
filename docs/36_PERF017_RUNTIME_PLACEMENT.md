# PERF-017 — runtime placement и local development

Дата: 2026-09-12. Локальная часть принята; фиксация пары deployment-region / Supabase-region ожидает
данные платформы размещения.

## Инвентаризация размещения

| Компонент | Подтверждённое состояние | Источник |
| --- | --- | --- |
| Next.js runtime для текущей проверки | Локальная Windows-машина, рабочая копия находится в OneDrive | benchmark evidence |
| Развёрнутый Next.js runtime | Неизвестен: в репозитории нет `vercel.json`, `.vercel/project.json` или конфигурации другого hosting provider | repository inventory |
| Supabase Postgres | Регион неизвестен: URL проекта и ключи не раскрывают надёжное значение региона | требуется Supabase Dashboard |

Provider-specific region config намеренно не добавлен. Сначала нужно получить точный регион Postgres и определить
платформу deployment; затем выбрать тот же или ближайший доступный runtime region. Для Vercel регион Functions
задаётся в project configuration, а Supabase привязывает проект к одному primary region. См.
[Vercel Functions regions](https://vercel.com/docs/functions/configuring-functions/region) и
[Supabase regions](https://supabase.com/docs/guides/platform/regions).

## Локальное сравнение режимов

Оба режима проверены на одной машине, Node.js v24.14.0, Next.js 16.3.1, Windows 10.0.26200. Последовательно
выполнены один first request и 20 warm requests к
`/api/tests/import-schema?version=v2`. Endpoint возвращал HTTP 200, 24 445 bytes и ожидаемую public cache policy;
удалённых DB-вызовов в этом shape нет.

| Режим | First | Warm p50 | Warm p95 | Warm min/max |
| --- | ---: | ---: | ---: | ---: |
| `next start` | 116.24 ms | 6.70 ms | 11.30 ms | 5.19/14.24 ms |
| `next dev` | 484.24 ms | 15.31 ms | 21.50 ms | 12.71/26.22 ms |

Evidence: [production](performance/PERF017_LOCAL_PRODUCTION_2026-09-12.json) и
[development](performance/PERF017_LOCAL_DEVELOPMENT_2026-09-12.json). Скрипт
[`perf-runtime-benchmark.mjs`](../scripts/perf-runtime-benchmark.mjs) принимает только localhost origin, проверяет
ответ и не сохраняет project URL/ref, ключи, токены, данные пользователей или имя машины.

Это сравнение изолирует локальные накладные расходы Next.js mode. Оно не измеряет задержку до Supabase, реальный
deployment network path, concurrency или cold start и не является продуктовым SLA. Для release evidence нужно
использовать production build на развёрнутом runtime.

## Закрытие deployment gate

1. В Supabase Dashboard открыть настройки текущего проекта и записать точное значение primary region без URL,
   project ref и ключей.
2. Указать hosting provider и фактический регион server runtime. Значение проверять в runtime metadata/log одного
   безопасного server request, а не по локальному окружению разработчика.
3. Настроить runtime в том же регионе, что Postgres, либо в ближайшем доступном регионе; применить изменение сначала
   на preview/staging deployment.
4. На preview повторить production-mode server measurement для DB-backed read shape и проверить RLS/tenant scope.
5. Зафиксировать итоговые два региона и результаты в этом документе до production rollout.

Изменений схемы, Supabase settings, remote flags и deployment в этом шаге нет.

