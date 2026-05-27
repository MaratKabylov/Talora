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
`supabase/migrations/20260526100000_platform_admin_backoffice.sql` и миграции
`supabase/migrations/20260527120000_platform_team_invitations.sql`.

Для сотрудников платформы используется отдельный auth-flow, который не создает компанию:

- `/admin/register` — регистрация аккаунта сотрудника платформы;
- `/admin/login` — вход в backoffice.

Для серверных операций админки укажите в `.env` ключ из Supabase Dashboard:

```dotenv
SUPABASE_SECRET_KEY=sb_secret_...
```

Поддерживается и legacy-переменная `SUPABASE_SERVICE_ROLE_KEY`, но secret key
рекомендуется Supabase для нового server-side кода. Этот ключ нельзя использовать
в клиентских компонентах или переменных с префиксом `NEXT_PUBLIC_`.

Первого владельца платформы зарегистрируйте через `/admin/register`. После появления
записи в `public.profiles` назначьте роль вручную:

```sql
insert into public.platform_users (user_id, role, status)
values ('<auth-user-uuid>', 'platform_owner', 'active');
```

После создания владельца новых сотрудников можно приглашать из `/admin/team`:

- владелец выбирает email и роль `platform_owner`, `platform_admin`,
  `platform_support` или `platform_analyst`;
- Supabase Auth отправляет email-приглашение;
- приглашенный задает имя и пароль на `/admin/accept-invitation`;
- роль сохраняется при отправке, а доступ становится активным только после принятия.

Для доставки писем настройте email provider и redirect URLs проекта Supabase, включая
`/auth/confirm?next=/admin/accept-invitation` на домене приложения. Просмотры
персональных данных кандидатов и операционные изменения записываются в
`public.platform_audit_logs`.

Регистрация через `/admin/register` сама по себе не выдает доступ к backoffice:
до назначения роли пользователь остается на странице ожидания и не проходит onboarding
организации. Если такой аккаунт уже создан, приглашение из `/admin/team` сразу назначит
ему выбранную роль без повторного письма.
