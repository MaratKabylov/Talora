# HR Assessment SaaS MVP Starter Pack

Этот пакет содержит стартовые материалы для вайбкодинга MVP в VSCode/Codex.

## Файлы

- `00_MASTER_PROMPT_FOR_CODEX.md` — главный промпт для Codex.
- `01_PRODUCT_SPEC_MVP.md` — продуктовая и техническая спецификация.
- `02_DATABASE_MODEL.sql` — стартовая модель БД для Supabase.
- `03_SEED_SYSTEM_TESTS.json` — структура предустановленных тестов.
- `04_BACKLOG.md` — backlog по этапам.
- `05_ENV_EXAMPLE.md` — переменные окружения.

## Рекомендуемый порядок

1. Создай новый репозиторий.
2. Вставь `00_MASTER_PROMPT_FOR_CODEX.md` в Codex.
3. Попроси Codex сначала создать проект и структуру.
4. Затем отдельно дай задачу применить SQL-модель.
5. После каждого milestone проси Codex запускать lint/typecheck/build.
6. Не проси сразу “сделай весь проект” — лучше идти этапами из backlog.

## Внутренняя админ-панель

Backoffice владельца SaaS доступен по `/admin` после применения миграции
`supabase/migrations/20260526100000_platform_admin_backoffice.sql`.

Для серверных операций админки укажите в `.env` ключ из Supabase Dashboard:

```dotenv
SUPABASE_SECRET_KEY=sb_secret_...
```

Поддерживается и legacy-переменная `SUPABASE_SERVICE_ROLE_KEY`, но secret key
рекомендуется Supabase для нового server-side кода. Этот ключ нельзя использовать
в клиентских компонентах или переменных с префиксом `NEXT_PUBLIC_`.

Первого владельца платформы нужно назначить вручную после его регистрации и появления
записи в `public.profiles`:

```sql
insert into public.platform_users (user_id, role, status)
values ('<auth-user-uuid>', 'platform_owner', 'active');
```

Остальным сотрудникам можно назначить роли `platform_admin`, `platform_support` или
`platform_analyst`. Просмотры персональных данных кандидатов и операционные изменения
записываются в `public.platform_audit_logs`.
