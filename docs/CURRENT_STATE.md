# Текущее состояние Talvia

Обновлено: 2026-09-27. Этап 1 `Talvia_Scoring_V2_TZ.md` технически подготовлен: код отчётов, четыре определения и четыре удалённых V2 draft-версии созданы. Опубликованные версии и исторические результаты не изменялись; новые версии не публиковались.

## Текущий этап

- **V2-определения:** `scripts/build-scoring-v2-imports.mjs` воспроизводимо строит четыре `talvia.test.v2` из read-only audit export. Готовые файлы находятся в `artifacts/talvia-scoring-v2-imports/`: Learning 4/28/121, Attention 4/32/128, Work Behavior 2/24/78, Motivation 1/27/81 (секции/вопросы/варианты).
- **Удалённые drafts:** Attention v3 `0609ee34-6882-4171-8647-2a03e54a2eed`; Motivation v3 `24b5945a-ff0c-4fdf-9701-ef2029febef7`; Learning v8 `fd88fdf5-3d28-4880-8754-7742a2232b30`; Work Behavior v4 `34c14f4f-cf51-4fdd-9242-8972f074672e`. Все четыре имеют `status=draft`, `scoring_schema_version=2.0` и ожидаемые domain/result shape.
- **Learning:** `assessment_domain=learning`, `result_shape=score`, criterion items, веса `0.8/0.2`, overall `learning_final`; сохранены 6 recovery-связей и два промежуточных блока изменения правил.
- **Attention:** `assessment_domain=attention`, overall `attention_accuracy`, 32 criterion items, четыре исходные секции, `shuffle_options=true`; время остаётся наблюдаемой метрикой и не входит в score.
- **Work Behavior:** 18 ipsative Forced Choice по шести исходным dimensions и 6 SJT с сохранёнными баллами; overall только `sjt_total`. Название показателя в отчёте — «Качество решений в рабочих ситуациях». В `docs/04_BACKLOG.md` добавлена неблокирующая задача `WB-SJT-02`.
- **Motivation:** 27 ipsative Forced Choice по девяти исходным dimensions, `result_shape=profile`, `overall_score=null`, без норм.
- **Импорт контента:** parser разрешает criterion single-choice без legacy `competency_key`, что нужно для опубликованной «Обучаемости». Опциональные `content_blocks` проходят строгую проверку ключей/позиций. Миграция `20260927100000_test_import_content_blocks.sql` применена пользователем; доступность RPC и два сохранённых Learning-блока подтверждены read-back. Защитная миграция `20260927110000_scoring_v2_import_remediation.sql` добавлена и локально проверена: будущий V2-импорт материализует `remediation_question_key` в UUID и сохраняет feedback. На удалённой БД она ещё не применена; текущий Learning v8 уже исправлен отдельно и прошёл read-back.
- **Remote import:** `scripts/import-scoring-v2-drafts.mjs` имеет явный `--execute`, проверяет migration/RPC, published source, единственность draft, counts, overall/scales, scoring models, option UUID mappings и audit. Повторный запуск идемпотентно переиспользует готовые drafts.
- **Отчёты:** мотивация использует competition ranks (`1, 1, 3, 3`) без позиционных групп; ipsative шкалы помечены `within_person_only`. Learning показывает initial/recovery/gain/post-feedback/final, Attention — correct/errors/omissions/completion/time. Profile-результаты показывают «Ответов / Полнота» без correct/incorrect и баллов.
- **Fit/recommendation:** мотивационные шкалы исключены из обычного competency `fit_score`; отсутствующие измерения не считаются нулём. Recommendation policy не менялась.

## Данные и безопасность

- Актуальный read-only экспорт создан из локального `.env.local`: `artifacts/talvia-tests-audit.zip`, 5 шаблонов / 7 версий / 21 секция / 140 вопросов / 532 варианта; обе проверки manifest — `true`.
- «Универсальная карта потенциала» не преобразовывалась и не изменялась.
- Источником новых файлов служат последние опубликованные версии, а не черновики. Legacy draft Learning v7 `af1b72f9-e7c3-4fdc-b00f-c52254d655d0` переведён в архив с platform audit event; он не удалён.
- Remote RPC импортировал Learning без шести remediation settings, несмотря на валидный JSON. Скрипт остановил приёмку, восстановил ровно 6 связей по совпавшим секции/позиции/тексту и записал отдельный `repair_system_test_v2_remediation` audit event. Финальный повторный read-back подтвердил 6/6 links/feedback без дополнительных записей.
- Production flags не менялись. Service-role credentials не сериализуются и не логируются.
- PERF-012 индексы и PERF-015 durable scoring queue остаются в ранее принятом состоянии; `ASSESSMENT_ASYNC_SCORING_V2` по умолчанию выключен.

## Проверки

- Четыре generated JSON проходят production `parseTalviaTestImportV2` и `validateQuestionsForPublication`.
- Профильная проверка V2 import/content-block/remediation migration: **6/6**; полный `npm test`: **536/536**.
- `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`, JSON schema parse, generator syntax check и `git diff --check` — успешно.
- Remote final read-back: четыре ожидаемых drafts, 9 motivation + 6 behavior dimensions, 28/32 criterion, 18 FC, 6 SJT, 6 Learning remediation links, 32 Attention shuffle settings, 2 Learning content blocks; все import/audit events найдены, published source IDs сохранили `published`.
- Визуальный admin preview в этом сеансе не выполнен: подключённая browser session отсутствует. Это не меняет database validation, но UI smoke остаётся перед публикацией.
- Production build использовал `.env.local`; ожидаемые auth-context failure-события появились только во время static page generation, сборка завершилась успешно.

## Следующий шаг

Применить `20260927110000_scoring_v2_import_remediation.sql` перед следующим V2 Learning-импортом, затем выполнить визуальный preview smoke четырёх drafts в admin UI (включая последовательное появление Learning content blocks и recovery). Публикацию выполнять только по отдельному подтверждению; до него drafts и действующие published-версии оставить без изменений.
