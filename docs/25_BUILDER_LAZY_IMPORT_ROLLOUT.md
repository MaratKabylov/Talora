# PERF-006: ленивые источники импорта конструктора

## Что готово — 08.09.2026

Изменение действует в `/dashboard/tests/[id]/builder` и `/admin/tests/[id]/builder`.
При открытии приходят текущий редактируемый документ и список доступных published версий:
`templateId`, `versionId`, `templateTitle`, `versionNumber`, `questionCount`.
Содержимое других тестов не входит в начальные запросы/props.

Пользователь выбирает версию → нажимает «Загрузить источник» → видит число секций →
нажимает «Импортировать секции». Первая кнопка ничего не добавляет и не сохраняет.
Вторая использует прежнее копирование секций/вопросов/вариантов/content blocks с новыми
ID и переносом remediation-ссылок внутри секции. После импорта действует прежний autosave.
Для повторного импорта источник нужно загрузить заново.

Во время загрузки можно править документ и сменить источник. Запоздалый ответ для старой
версии/unmounted picker игнорируется. Ошибки показываются отдельно от статуса сохранения;
доступен ручной retry без сброса ввода. Отмена picker не отменяет уже выполняющийся Server
Action на сервере. Общего кэша/localStorage/prefetch нет; в памяти — только выбранный ответ.

Права перепроверяются при каждом запросе содержимого:

- Company: авторизованный owner/admin/recruiter/super_admin, target — active custom template
  и draft в активной компании. Источник — published own version либо active system template
  с grant именно активной компании. Членство/доступ в другой компании не подходят.
- Admin: только platform_owner/platform_admin, target — active system draft с company_id=null;
  источник — published system version с company_id=null, без company content.
- Исходные правила для archived templates сохранены: собственный company template и system
  template в admin могут быть archived, но версия-источник должна оставаться published.
  Для HR system template обязан быть active. Archived/draft версии не являются источниками.
- Неавторизованный запрос, UUID-подмена, отзыв grant, публикация target или архивация source
  после открытия страницы не позволяют загрузить запрещенный источник. Сохранение черновика
  остается отдельно защищено существующими server actions/RLS.

## Развертывание

1. Развернуть приложение на staging обычным способом и открыть страницу заново.
2. Новая SQL-миграция **не нужна**, новые env/feature flags **не нужны**.
   Флаги assessment из предыдущих шагов не менять для проверки конструктора.
3. Проверить checklist ниже. В production переносить после staging-приемки.

Список использует `test_sections(questions(count))`: вложенные счетчики, не тексты вопросов.
Использован поддерживаемый legacy `count` без включения общих aggregates на PostgREST;
этот синтаксис может быть deprecated в будущем. Справка:
[PostgREST: count и агрегаты](https://postgrest.org/en/latest/references/api/aggregate_functions.html#the-count-aggregate).
Настройки PostgREST агент не менял. Совместимость конкретного staging и корректность counts
нужно проверить; ошибка запроса не подменяется успешным пустым списком. Работает существующий
page error boundary с повтором. Pagination metadata — по 500 version rows; предполагается
обычный API row limit не менее 500. Пределы вложенного content остаются прежними.

## Checklist приемки

- [ ] Company и admin: открыть большой draft; до нажатия кнопки в RSC response нет текстов,
  descriptions/settings, вопросов и вариантов **других** версий. Контент самого draft ожидаем.
- [ ] В server/network trace запросы metadata содержат только ID/названия/version_number и
  counts; отсутствует eager query `answer_options(...)` для источников.
- [ ] Сверить questionCount с БД, в том числе пустую секцию с content blocks, несколько
  секций, published/draft/archived версии и библиотеку более 500 версий.
- [ ] Выбор в select сам не вызывает content load. Кнопка загружает только выбранный version ID;
  загрузка без импорта не создает save/dirty state и не меняет документ.
- [ ] Offline/ошибка: повтор работает; текст, введенный до/во время запроса, остается на месте.
- [ ] Сменить A → B во время медленной загрузки A: ответ A не перезаписывает B и не импортируется.
  Double click не дублирует один запрос/одно добавление секций.
- [ ] Импортировать source с options, matching, ordering, Forced Choice, competency effects,
  content blocks и remediation; сохранить, reload и preview. Сравнить BuilderDocument с прежним
  импортом с учетом новых UUID; published источник не изменяется.
- [ ] Попытаться загрузить foreign company source, system source с grant другой компании,
  draft/archived version, неправильную пару template/version и не свой target.
- [ ] Отозвать grant после открытия списка, сменить active company, понизить роль до viewer,
  опубликовать target или архивировать source version: запрос не отдает запрещенный контент.
  Проверять новыми запросами; уже разрешенно загруженные данные нельзя отозвать из памяти браузера.
- [ ] Проверить platform_support/platform_analyst: новый content action не доступен; company
  sources не раскрываются даже platform_admin через этот action.
- [ ] Собрать хотя бы 30 cold/warm samples: время открытия, initial RSC transferred bytes,
  время загрузки одного source, `builder.import_sources` и `builder.import_source_content`.
  Сравнить на одинаковой библиотеке/железе. Не считать уменьшение payload доказанным p95.

## Локальные проверки и границы

Пройдены `npm test` (418), `npm run typecheck`, `npm run lint`, `npm run build`.
Новые 8 Node tests используют настоящий Supabase query builder поверх synthetic HTTP,
а не реальную удаленную БД. Проверки текущего RLS на Supabase обязательны отдельно.

`npm run test:browser:builder-import` запускает изолированную fixture на `127.0.0.1:4319`.
Открыть ее в отдельном Chrome профиле и дождаться `PASS 8 builder browser scenarios`.
Проверяются реальные React picker/editor; Server Actions и данные синтетические.
Это не полноценный Next.js/Supabase E2E и не production benchmark. Учетные данные не нужны.
Fixture SQL из assessment-тестов запускать в Supabase **нельзя**.

## Откат и следующий шаг

Сохранить изменения в открытых редакторах перед откатом. Вернуть предыдущую версию приложения,
затем заново открыть страницы (IDs Server Actions могут измениться). Schema/data rollback не
требуется; уже импортированные и сохраненные секции остаются обычными секциями черновика.
Их удаление не является частью отката. Предыдущая сборка вернет eager-загрузку источников.

Следующий шаг — PERF-007: декомпозиция редактора и локализация React rerender. Инкрементальный
autosave (PERF-008) и атомарное клонирование (PERF-009) здесь не реализовывались.
