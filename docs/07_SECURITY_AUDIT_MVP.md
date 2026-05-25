# Basic Security Audit - MVP

Дата проверки: 2026-05-25.

## Проверено

- HR-страницы получают данные через authenticated Supabase client и `company_id`/RLS.
- Candidate flow использует bearer invitation token только в server actions/server data layer.
- `SUPABASE_SERVICE_ROLE_KEY` читается только в `lib/supabase/admin.ts` с `server-only`.
- Согласие кандидата сохраняется до заполнения анкеты и прохождения тестов.
- Опубликованные версии тестов и их содержимое защищены trigger-правилами от редактирования.
- Scoring не использует чувствительные признаки кандидата.

## Усиления в Milestone 11

- Для `/assessment/*` включены `no-store`, `no-referrer` и `noindex`, чтобы token URL не
  кэшировался и не передавался внешним страницам.
- Добавлены базовые security headers: запрет iframe, MIME sniffing, камеры, микрофона и геолокации.
- Redirect после email confirmation и выбора компании ограничен внутренними разрешенными маршрутами.
- RLS helper-функции `is_company_member` и `is_company_admin` используют закрытый
  `search_path` и недоступны `anon`.
- Триггеры целостности не дают связать результат, competency score, comparison score или отчет
  с чужим application/session/candidate.

## Остаточные Риски Перед Production

- Invitation token хранится в базе в открытом виде, поскольку MVP позволяет HR скопировать
  действующую ссылку. Для production предпочтительны hash token и отдельная операция выдачи ссылки.
- Не реализованы rate limit и журнал доступа для публичных token-endpoint; их следует добавить
  на edge/API-уровне до публичного запуска.
- Нужны автоматические интеграционные тесты RLS для пар компаний и тесты истечения/отмены token.
- Следует определить срок хранения персональных данных и операцию удаления/анонимизации кандидата.
