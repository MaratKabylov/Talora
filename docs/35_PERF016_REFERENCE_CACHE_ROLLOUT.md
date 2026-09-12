# PERF-016 — safe reference-data cache

Дата: 2026-09-12. Первый срез готов и проверен локально; app deployment не выполнялся.

## Реализованный scope

- Профиль организации получает `system_cities` через server-only `unstable_cache`.
- Cache хранит только глобальные reference-поля `id`, `name`, `is_active`; tenant, user, invitation, session и answer data отсутствуют.
- Ключ `reference/system-cities/v1`, tag `reference:system-cities`, TTL один час.
- `createSystemCityAction` и `updateSystemCityAction` вызывают `updateTag` сразу после успешной записи.
- Проверка выбранного города в `updateCompanyProfileAction` остаётся прямым запросом к БД и не доверяет cached state.
- Versioned import schema route возвращает публичную HTTP cache policy: browser 5 минут, shared cache 24 часа, stale-while-revalidate 7 дней. URL `?version=v1|v2` разделяет cache entries.

## Границы безопасности

- Shared cache не содержит company-private данных и не использует cookies или invitation token.
- Profile вызывает `requireCompanyContext` до cached read.
- Admin city list с live company counts не кэшируется.
- Published assessment content не кэшируется в этом срезе: текущие RPC смешивают immutable content с token/session/answer state. Сначала требуется безопасно разделить static content и live state.
- Tenant-scoped metadata системных тестов и пакетов не кэшируется до появления company-scoped key и повторной проверки доступа перед выдачей.

## Проверки

- Targeted cache/auth regression: 7/7.
- Полный `npm test`: 516/516.
- `npm run typecheck`, `npm run lint`, `npm run build` — успешно.
- Production HTTP smoke: v1/v2 status 200, корректные schema version и filename, ожидаемый `Cache-Control`.
- `git diff --check`.

## Rollout и откат

Изменение не требует migration или feature flag. После app deployment проверить два последовательных profile request и create/update города с немедленным появлением нового значения. При проблеме вернуть прямой city read в profile; cache tag и HTTP headers можно удалить независимо, без изменения данных.
