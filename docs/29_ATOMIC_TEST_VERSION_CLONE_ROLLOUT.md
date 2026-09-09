# PERF-009 — атомарное клонирование версии

Дата: 09.09.2026. **Код готов и локально проверен; staging/performance-приёмка открыта.**
Удалённые миграции и env в этой задаче не менялись. Нового feature flag нет.

## Поведение и границы

Company и system actions вызывают общий `lib/tests/clone-service.ts`. После получения
серверного auth context выполняется один HTTP RPC `clone_published_test_version`.
Контекст авторизации, revalidation и загрузка открываемого редактора в этот счёт не входят.
Ответ содержит только `{versionId, created}`; содержание теста через Next.js не переносится.

RPC повторно проверяет активность шаблона, компанию и активное членство с ролью
`owner/admin/recruiter/super_admin`; для system scope — `platform_owner/platform_admin`.
`company_id` и actor берутся из серверного контекста. Browser roles `anon/authenticated`
не имеют EXECUTE; функция `SECURITY INVOKER` доступна только `service_role`.
RLS и существующие publication/revision triggers не изменяются.

Блокировки шаблона и исходной версии сериализуют clone-вызовы, проверку опубликованного
источника и выделение следующего номера. Если черновик уже есть, возвращается его ID без
записи. Это позволяет повторить запрос после потери ответа, пока черновик существует.
Повтор после последующей публикации/архивации черновика может создать следующую версию:
это не постоянный журнал идемпотентности запросов.

Одна транзакция создаёт временную таблицу old→new ID и копирует version, sections,
questions, options через `INSERT ... SELECT`. Переносятся:

- все тексты, media URL, порядок, ограничения времени, баллы и competency effects;
- settings JSON целиком, включая presentation, content blocks и неизвестные поля;
- remediationQuestionId с заменой на ID вопроса копии в той же секции;
- новые ID вариантов и уникальные matching target IDs с сохранением пар и match_text;
- version/question scoring V2, SJT optionId и Forced Choice statementId с заменой ID;
- ссылки на конкретные criterion questions в composite/overall scoring.

Стабильные scale/composite/derived criterion keys и внешние normSetId сохраняются.
Публикационные даты не копируются, статус новой версии — draft, номер — max + 1.
System audit записывается в той же транзакции. Ошибка любого этапа откатывает всё.
Некорректные remediation/option references не сохраняют ссылку на исходник или чужой тест.

`builder_revision` новой версии изменяется действующими content triggers; ревизия и
receipt исходника не копируются. Новый draft не регистрируется в `builder_save_state`
самим клонированием и совместим с V1/V2 редактором. После его первой V2-записи действуют
обычные ограничения [PERF-008](28_BUILDER_INCREMENTAL_AUTOSAVE_ROLLOUT.md).

## Локальная проверка

- `npm test`: **475/475**, включая 13 новых Node tests PERF-009 с родительским тестом.
- `npm run lint`, `npm run typecheck`, `npm run build`: успешно.
- Headless Chrome: 8 сценариев builder editor и 8 builder import — успешно.
- `tests/test-version-clone-db.test.ts`: реальная миграция в PGlite, production DDL
  затронутых таблиц, публикационные guards и обе миграции builder V2; локальные заглушки
  только для auth/company окружения. Структурное сравнение всех 7 типов в обоих scope,
  legacy null scoring и V2 scoring, matching/ordering scoring, права/статусы, чужие ID,
  повтор, rollback каждой стадии вместе с аудитом, совместимость V1/V2 и verification SQL.
- `tests/test-version-clone.test.ts`: реальные actions/service с синтетическим transport;
  один RPC, серверный actor, redirects, запреты ролей, отсутствие N+1 fallback при сбое.

Последний полный Node-прогон: локальный PGlite, 5 секций / 100 вопросов / 400 вариантов,
один clone-вызов — **156 мс**. Это отдельный синтетический замер, не p95 и не staging SLA.
Content triggers по-прежнему выполняются на каждой строке. PGlite использует одно
подключение; queued calls не доказывают конкурентность реального PostgreSQL.
Browser fixtures не исполняют полноценный auth/Next.js/Supabase clone flow.

Первый sandbox-запуск build/Chrome упёрся в Windows `EPERM`/IPC access denied. Повтор с
разрешением на запуск дочерних процессов прошёл. Полные browser артефакты — локально в
игнорируемой `coverage/`; настройки приложения для обхода ошибки не менялись.

## Staging — порядок выпуска и приёмка

1. Проверить историю миграций окружения, включая обе миграции PERF-008:
   `20260908120000_builder_save_v2.sql`, `20260908140000_builder_save_v2_integration.sql`.
   Не применять уже выполненные миграции повторно.
2. После отдельного разрешения на удалённые миграции применить
   `supabase/migrations/20260909120000_atomic_test_version_clone.sql` **до deploy кода**.
3. Выполнить read-only `supabase/verification/atomic_test_version_clone.sql`:
   все `passed=true`. Проверяются service-only RPC, search_path, TEMP privilege,
   табличные права service role и включённые guards. Это не full RLS matrix.
4. Deploy приложения. Флаг `BUILDER_SAVE_V2` не переключать ради клонирования.
   Отсутствующая RPC даёт ошибку; автоматического возврата к старому clone-коду нет.
5. Для company/system published versions проверить все типы, remediation, SJT/Forced
   Choice и настройки; открыть, сохранить, preview и опубликовать полученный draft.
   Источник и исторические результаты должны оставаться неизменными.
6. Проверить через реальные сессии viewer, отозванного/неактивного участника, чужую
   компанию, platform support, подмену source/template IDs и недоступность RPC из браузера.
7. Через **два отдельных подключения** одновременно клонировать один источник: один
   полный draft и один system audit, второй запрос получает тот же draft. Проверить
   потерю ACK, конкуренцию с archive/revert и отзывом роли. При deadlock/ошибке — полный
   rollback и успешный повтор после разрешения конфликта, без частичного содержимого.
8. На 100 вопросах (5×20, 400 options и реалистичный rich text) собрать минимум 30 cold
   и 30 warm замеров отдельно. Для каждого нового clone использовать отдельный шаблон
   или штатно архивировать предыдущий тестовый draft; ответы `created=false` не включать.
   Не удалять содержимое/регистрации SQL-обходами ради повторения замеров.
9. Использовать существующую telemetry `builder.clone` и `npm run perf:summary`;
   логировать только безопасные duration/outcome/correlation поля. Проверить p95 ≤ 2 с
   на staging и отдельно click-to-visible. Auth и загрузка редактора не входят в
   `builder.clone`. Зафиксировать среду, регион, выборки и итог в baseline.

До этих проверок критерий PERF-009 «100 вопросов ≤ 2 секунд на staging» **не принят**.
`tests/fixtures/*.sql` — только локальные заглушки; не запускать их в Supabase.

## Откат

Миграция добавляет функцию, не меняет таблицы или старые writers. При сбое ограничить
доступ к операции клонирования и исправить причину; сохранить новую RPC в БД.
Rollback приложения технически возможен, но прежний clone-путь снова имеет N+1,
потерю scoring/remediation и риск частичного draft, поэтому его нельзя считать безопасным
fallback для клонирования. Не удалять уже созданные версии и не откатывать PERF-008
регистрации. Удаление RPC/downgrade/production-переключения требуют отдельного разрешения.

Следующий шаг выпуска — staging-приёмка выше. Следующая кодовая задача — PERF-010.
