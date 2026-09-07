# PERF-004b: минимальный обзор страницы прохождения

## Что реализовано — 07.09.2026

Server-only RPC `read_assessment_test_overview_v2` заменяет загрузку полного overview только
на candidate/employee test page. Возвращаются название компании и вакансии/оценки, счетчики
сессий, ID следующей активной сессии и текущая сессия: статус, deadline, название теста,
описание, инструкции и три presentation settings. Анкета, пакет, scoring settings и
содержимое других тестов не читаются в ответ RPC и не передаются странице.

Функция проверяет token и цепочку company → owner → person/context → session. Права
исполнения — только `service_role`, `search_path` пустой, функция STABLE и ничего не пишет.
Серверный presenter валидирует ответ, отбрасывает неизвестные поля, санитизирует rich text
и сохраняет стандартные значения настроек. Ошибка RPC не вызывает скрытый legacy retry.

## Совместимость

- Перенаправления при отсутствии согласия, завершенном приглашении/тесте и неактивной
  сессии сохранены. Завершенное приглашение ведет на receipt даже после expires_at.
- Candidate eligibility остается как в V1: опубликованные версии текущего пакета вакансии.
  Переход на frozen candidate package snapshot здесь не реализован и не подменяет оптимизацию.
- Employee eligibility сохраняет назначенные версии, включая архивированные/вне текущего
  пакета. Порядок берется из текущего опубликованного package entry, затем snapshot order.
  Для старых строк без order определен fallback created_at/id; совпадающий order разрешается
  по session ID. V1 в этих случаях зависел от неопределенного порядка ответа БД.
- Новый test-page reader не отмечает приглашение opened/expired записью в БД. Он немедленно
  возвращает соответствующее состояние доступа. Прежние landing/profile readers и write/
  expiration handlers сохраняются; сроки и lease проверяются при записи независимо от reader.
  Это устраняет побочные записи из нового GET, но может отложить сохранение статуса expired
  до существующего обработчика. Проверить отображение таких состояний на staging.
- Между overview и section RPC нет общей транзакции. Section RPC повторно проверяет доступ;
  при отмене/завершении между чтениями контент не возвращается. Изменения других сессий
  могут отразиться в счетчиках при следующем чтении. Глобальный кеш token-data не добавлен.
- Полные readers остаются для landing/profile/completion и старых server actions. Навигация,
  prefetch, timer, lease и scoring этим шагом не изменяются.

## Флаги и число HTTP-запросов чтения

Для обычной активной test page с уже данным согласием (без API claim/heartbeat и side effects):

| ASSESSMENT_OVERVIEW_V2 | ASSESSMENT_SECTION_READ_V2 | HTTP к Supabase | Режим |
| --- | --- | ---: | --- |
| false | false | 7 | Полный legacy overview + content |
| false | true | 6 | Legacy overview + section RPC |
| true | false | 8 | Overview RPC + legacy overview/content для совместимости |
| true | true | 2 | Компактный overview RPC + section RPC |

Это количество HTTP round trips по коду/transport-тестам, не число SQL statements и не p95.
Оптимальный режим требует **обоих** read-флагов. Они независимы от `SESSION_CONTROL_V2`.
При legacy-чтении overview повторно используется только в пределах одного рендера страницы.
Установка одного overview-флага при выключенном section-флаге безопасна, но не ускоряет чтение.

## Порядок включения

1. На staging применить `supabase/migrations/20260907120000_assessment_test_overview_v2.sql`
   поверх актуальной схемы. Миграция добавляет функцию/права, без изменения пользовательских данных.
   Ранее должна быть установлена section-read миграция `20260906140000_assessment_section_read_v2.sql`
   для включения обоих режимов. **Не запускать `tests/fixtures/*.sql` в Supabase.**
2. Выполнить read-only проверки `supabase/verification/assessment_test_overview_v2.sql`
   и `supabase/verification/assessment_section_read_v2.sql`: все boolean должны быть `true`.
3. В серверном staging runtime установить `ASSESSMENT_SECTION_READ_V2=true` и
   `ASSESSMENT_OVERVIEW_V2=true`, перезапустить/переопубликовать приложение.
   Префикс `NEXT_PUBLIC_` не использовать. Агент реальные флаги не менял и миграцию не применял.
4. На синтетических приглашениях обоих scope проверить: согласие, первая/повторная загрузка,
   section/one-question, review, shuffle, восстановление ответа, deadline, completion и переход
   к следующему тесту. Отдельно — смену пакета у сотрудника и архивированную назначенную версию.
   Чужая session, неверная tenant/person/context связь, отмена и истечение token не должны
   раскрывать контент. Проверить оба значения `SESSION_CONTROL_V2`.
5. В server → Supabase trace подтвердить два RPC чтения и отсутствие запросов анкеты/полного
   пакета. Проверить отсутствие других тестов/PII/scoring в RPC/RSC payload. Не сохранять
   реальные token/PII в логах и артефактах. Сравнить 30+ cold/warm замеров
   `assessment.load_test_overview`, `assessment.load_section` и TTFB обеих test page.
6. Результаты, commit, регион/RTT и размер данных записать в `docs/17_PERFORMANCE_BASELINE.md`
   перед production rollout. Цель — измеримое улучшение без роста ошибок/нарушения доступа.

## Проверки и ограничения

`tests/assessment-test-overview-v2.test.ts` исполняет настоящий SQL в PGlite, оба действующих
V1 reader для сравнения, новый presenter/reader и обе страницы. Покрыты права, отсутствие
записей, tenant/consent/expiry, terminal redirects, все сочетания read-флагов, bounded payload
и request-local повторное использование legacy overview.

Добавление 200 других тестов/сессий с длинными инструкциями увеличивает ответ менее чем
на 20 символов, только за счет счетчика. Увеличение инструкций существующих других тестов
не меняет ответ. Это синтетическая проверка объема, не замер реального ускорения.
PGlite использует минимальную схему; полная Supabase/RLS-интеграция, browser smoke test,
EXPLAIN и фактические p50/p95 еще требуют staging. PERF-004 остается открыт по prefetch,
а PERF-005 — по мягкой навигации.

## Откат

Установить `ASSESSMENT_OVERVIEW_V2=false` и перезапустить runtime. Section RPC можно оставить
включенным; для полного возврата к старым DB-readers выключить также `ASSESSMENT_SECTION_READ_V2`.
Данные, scoring и режим записи не меняются. Удалять read RPC или откатывать схему не нужно.
