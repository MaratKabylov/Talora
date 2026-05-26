# RLS and Security Notes

## Главная логика

HR-пользователи должны видеть только данные своей компании.

Кандидаты проходят тесты по invitation token. Для candidate flow лучше использовать server actions / route handlers:

- validate token;
- проверить срок действия;
- получить application;
- получить список test sessions;
- сохранить ответы.

Не открывать прямой anon-доступ ко всем таблицам.

## Server secret

Для нового server-side кода предпочитайте `SUPABASE_SECRET_KEY` (`sb_secret_...`).
Legacy `SUPABASE_SERVICE_ROLE_KEY` также можно использовать только на сервере, например для:

- генерации системных seed-тестов;
- защищенного scoring;
- обработки candidate token flow.

Никогда не передавать secret/service role key в browser.

## Published tests

Опубликованные версии тестов нельзя редактировать. Это можно enforced на уровне приложения, а позже добавить trigger:

- если `test_versions.status = 'published'`, запретить update связанных sections/questions/options.

## Sensitive data

Не использовать для скоринга:

- возраст;
- пол;
- национальность;
- религию;
- здоровье;
- семейное положение;
- политические взгляды;
- любые другие чувствительные признаки.

## Candidate consent

На стартовой странице кандидата обязательно:

- кто собирает данные;
- для какой вакансии;
- что результаты используются для предварительной оценки;
- согласие на обработку персональных данных.
