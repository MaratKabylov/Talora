# PERF-014 — materialized employee comparison dimensions

Дата: 2026-09-12.

## Что меняется

- `employee_assessment_dimension_scores` хранит текущие нормализованные dimensions конкретной scoring revision.
- Normal completion и recalculation формируют строки через тот же `collectAssessmentDimensions`, который использовался comparison.
- `try_persist_scoring_snapshot` заменяет dimensions в той же транзакции, что result, summary, report и aggregate.
- Employee comparison читает одну tenant-scoped выборку dimensions для текущей страницы до 50 участников.
- Для исторических scoring revisions без materialized rows временно сохраняется fallback. Он читает JSON только для missing participant IDs, а не для всей страницы.

## Безопасность и целостность

- Таблица содержит прямые `company_id`, `employee_assessment_id`, `participant_id` и RLS `is_company_member(company_id)`.
- `authenticated` имеет только SELECT; `anon` не имеет доступа.
- Внешний `service_role` вызывает только `try_persist_scoring_snapshot` или идемпотентный backfill RPC.
- Внутренние writers закрыты от `public`, `anon`, `authenticated` и `service_role`.
- Writer блокирует participant, сверяет `scoring_revision` и проверяет принадлежность каждой пары session/version.
- Ошибка dimension insert откатывает весь scoring snapshot. Повторный backfill текущей revision не заменяет существующие строки.

## Порядок выпуска

1. Применить [миграцию](../supabase/migrations/20260911120000_perf014_employee_dimension_scores.sql).
2. Выполнить [read-only verification](../supabase/verification/perf014_employee_dimension_scores.sql).
3. Развернуть приложение. Миграция должна предшествовать коду, потому что comparison сразу обращается к новой таблице.
4. Выполнить normal completion или audited recalculation для исторических участников, которые попали в `scored_participants_without_current_dimensions`. До backfill они продолжают работать через ограниченный fallback.
5. Повторить verification: tenant/session mismatch и stale revision должны быть нулевыми; coverage должен уменьшаться до нуля для оцениваемых наборов.
6. Запустить scoring staging acceptance. Для employee он дополнительно проверяет materialized dimension и scoring revision.

## Проверки до применения migration

```text
node --experimental-strip-types --test --test-isolation=none tests/perf014-materialized-dimensions.test.ts tests/list-read-models.test.ts tests/scoring-atomic-persistence.test.ts
npm run typecheck
npm run lint
npm test
npm run build
```

PGlite regression проверяет initial insert, атомарную замену при recalculation, idempotent backfill, stale revision и rollback при чужой session.

## Staging acceptance — 12.09.2026

- Migration применена пользователем в текущем Supabase.
- Первая read-only verification: 12/12 catalog/RLS/grant/RPC checks, все integrity mismatches равны нулю; 5 исторических scored participants ещё используют fallback.
- Локальная production-сборка выполнила candidate/employee completion через текущий Supabase: 30/30 checks, включая materialized employee dimension и idempotent retry.
- Shutdown 2/2: обе созданные invitation-ссылки завершены и погашены.
- Evidence: [PERF014_STAGING_2026-09-12.json](performance/PERF014_STAGING_2026-09-12.json).
- Финальный read-only запрос после acceptance: `row_count=1`, staging dimension valid, tenant/session/stale mismatches равны нулю; coverage исторического fallback — 5. [SQL evidence](performance/PERF014_FINAL_VERIFICATION_2026-09-12.json).

## Откат

При проблеме приложение можно вернуть на прежнее чтение JSON, оставив таблицу и dual-write на месте. Таблицу и данные автоматически не удалять: destructive rollback требует отдельного решения после проверки зависимостей.
