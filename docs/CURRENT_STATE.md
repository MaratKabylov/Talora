# Текущее состояние Talvia

Обновлено: 2026-09-08. Снимок для продолжения работы, не журнал и не доказательство состояния удалённой БД.
Опорная ревизия кода при составлении: `6a650d1` («Оптимизация производительности 15»); рабочее дерево до правки этих документов было чистым.

## Текущая задача и следующий шаг

- Документационная задача завершена: обновлён `AGENTS.md`, создан этот снимок. Проверены diff, локальные ссылки и пути; тесты/сборка приложения не запускались (только Markdown). Код приложения, env и БД не менялись.
- Последняя завершённая кодовая задача: PERF-008.1/008.2 — атомарное инкрементальное автосохранение и публикация по ревизии для company/system builder. Код локально проверен; staging/performance-приёмка открыта.
- Следующая кодовая задача: **PERF-009 — атомарное клонирование версии**. Требования и критерии: [план](16_PERFORMANCE_OPTIMIZATION_PLAN.md), раздел PERF-009. В рамках текущей документационной задачи не начата.
- Для PERF-009: одна server-only RPC/транзакция, set-based копирование и old→new ID mapping; перенос remediation links, matching target IDs и settings, rollback без частичной draft. Приёмка: все типы вопросов, 100 вопросов ≤ 2 секунд на staging.

## Что осталось по плану

- PERF-009: клонирование; PERF-010–012: лёгкие списки, cursor pagination/фильтры, подтверждённые индексами и EXPLAIN оптимизации.
- PERF-013–014: разделение summary/details отчёта, материализованные dimension scores для сравнения.
- PERF-015: completion/scoring только по результатам замеров; PERF-016–017: безопасное кэширование, размещение и local development.
- Итого 9 пунктов в 5 оставшихся блоках, включая условный PERF-015; отдельно незавершённая staging-приёмка уже написанного кода. Детали прошлых этапов — в плане и rollout-документах, не перечитывать их без необходимости.

## Выпуск PERF-008 и ограничения

- Источник: [rollout PERF-008.2](28_BUILDER_INCREMENTAL_AUTOSAVE_ROLLOUT.md). В `.env.example` — `BUILDER_SAVE_V2=false`; реальные значения env и удалённая история миграций в этой задаче не проверялись.
- Миграции по порядку: `supabase/migrations/20260908120000_builder_save_v2.sql`, затем `supabase/migrations/20260908140000_builder_save_v2_integration.sql`. Применение именно этой пары на staging/production не подтверждено; перед запуском проверить историю, не применять вслепую повторно.
- Read-only SQL: `supabase/verification/builder_save_v2.sql` и `supabase/verification/builder_save_v2_integration.sql`. Полный порядок deploy/включения/приёмки — в rollout, не заменять его этим снимком.
- Первая V2-запись регистрирует версию в `builder_save_state`. Выключение флага НЕ возвращает зарегистрированные draft к V1; нельзя удалять регистрацию для обхода защиты.
- Конфликт ревизий не делает автоматический rebase/V1 fallback. Recovery JSON — ручная резервная копия, не формат мастера импорта. Нет автоматического сохранения в localStorage; beforeunload не защищает все SPA-переходы.
- Клиент отправляет delta, но сервер пока читает весь документ для валидации. Реальные latency/p95/INP, network bytes, конкурентные подключения, истечение сессии и full RLS matrix требуют staging-проверок.

## Карта кода и проверок

- Редактор: `components/tests/builder/test-builder-editor.tsx`.
- Клиентский протокол: `lib/tests/builder-save-controller.ts`, `lib/tests/builder-delta.ts`, `lib/tests/builder-serialize.ts`.
- Сервер: `lib/tests/builder-v2-actions.ts`, `lib/tests/builder-v2-service.ts`, `lib/tests/builder-v2-schema.ts`, `lib/tests/builder-storage-delta.ts`; общий документ: `lib/tests/builder-document-schema.ts`.
- Профильные тесты: `tests/builder-save-v2.test.ts`, `tests/builder-save-v2-db.test.ts`, `tests/browser/builder-editor.entry.tsx`.
- Последний зафиксированный результат PERF-008.2 (2026-09-08, rollout и §21 [baseline](17_PERFORMANCE_BASELINE.md)): 462 Node tests, 8 browser-сценариев редактора + 8 импорта, lint/typecheck/build — успешно. Это прошлый запуск, не повторная проверка в текущей задаче.
- PGlite и React с синтетическими server actions не заменяют Supabase/Next end-to-end и реальную PostgreSQL-конкурентность.
- Команды: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`; browser: `npm run test:browser:builder-editor`, `npm run test:browser:builder-import`, `npm run test:browser:navigation` — по затронутому пути.

## Как продолжать

- Новый запрос имеет приоритет над следующим шагом из снимка. На «продолжай» сверить git status, раздел PERF-009 и затронутый clone-код; не повторять весь аудит проекта.
- После изменения кода обновить этот снимок и профильный rollout/план. Фиксировать среду и источник подтверждения миграций/флагов; неизвестное не превращать в «применено» или «включено».
