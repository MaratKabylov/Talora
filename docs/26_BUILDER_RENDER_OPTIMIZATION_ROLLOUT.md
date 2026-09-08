# PERF-007: перерисовки конструктора

## Результат — 08.09.2026

Company и admin используют общие memoized `SectionEditor`, `QuestionEditor`, `OptionEditor`.
Изменение одного варианта больше не вызывает рендер остальных вопросов и вариантов.
Правки работают через стабильные callbacks и актуальный документ; внутренние состояния
collapse/remediation/option drag не обновляют весь редактор.

При открытии раскрыт только первый вопрос документа. Остальные открываются по заголовку
или кнопке «Развернуть вопросы» секции. Сворачивание не удаляет значения из документа.
Новые вопросы внутри существующей секции открываются сразу; скопированные/импортированные
секции начинают со свернутых вопросов. Ленивый импорт PERF-006 сохранен.

Вне viewport применяется `content-visibility: auto`. Данные и элементы остаются в DOM;
браузер может пропустить отрисовку содержимого до его появления. Используется intrinsic
block size 64/640 px для свернутой/раскрытой карточки с запоминанием измеренного размера.
Свойство не заменяет React memo и не является windowing. Поведение accessibility/focus
для auto описано в [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility#accessibility).
Неподдерживаемый CSS браузер проигнорирует; функциональность не зависит от этой оптимизации.

Pointer drag не меняет документ на каждом движении: только подсветку новой позиции, затем
один move на drop. Повтор движения над той же позицией не рендерит Section/QuestionEditor.
Вопрос можно двигать внутри секции стрелками ↑/↓ с фокусом на ручке «Переместить вопрос».
У structured options стрелки работают на ручке и остаются обычные кнопки вверх/вниз.

## Что не менялось

- Серверные actions сохранения и публикации, Supabase/RLS, права доступа и scoring.
- Формат BuilderDocument, UUID копий, перенос remediation внутри секции.
- Правила сброса remediation при копировании отдельного вопроса/перемещении между секциями.
- Полный autosave документа с прежним debounce. Dirty patches, revision lock и атомарная
  save RPC относятся к следующему PERF-008 и здесь не реализованы.
- Содержимое существующих draft/published версий; удаленная БД и реальные env не изменялись.

## Локальное подтверждение

`npm test`: 426 тестов. `npm run typecheck`, `npm run lint`, `npm run build` проходят.

`npm run test:browser:builder-editor` запускает fixture на `http://127.0.0.1:4320`.
Открыть ее в отдельном Chrome профиле и дождаться `data-status="passed"` у `#result`.
JSON содержит mount/edit samples, render IDs и три функциональных сценария; вместе с
100-question profile это четыре сценария. Вкладываются test-only React Profiler/probes;
production bundle не содержит эту инструментализацию.

Подтверждено на 100 вопросах / 400 вариантах:

- Из 100 вопросов сначала раскрыт один; DOM 31 705 → 3 589 элементов.
- Ввод в option при всех раскрытых вопросах рендерит только измененные question/option
  и их родительские root/section. Соседние узлы пропускаются.
- Один сравнительный прогон: React edit actualDuration 53,3–109,8 → 3,8–5,8 мс.
- CRUD секций/вопросов/content blocks, пресеты, все семь типов вопросов, structured options,
  feedback/remediation labels, сохранение после collapse, latest-state callback и keyboard move.
- Отсутствие dirty/save при движении pointer над одним target; cross-section drop сохраняется.
- `npm run test:browser:builder-import` повторно проходит прежние 8 component сценариев импорта.

Это development React, синтетический транспорт/input и отдельная fixture без production
stylesheet. Это **не замер INP**, не production benchmark и не полный Next/Supabase E2E.
В pointer сценарии setPointerCapture/hit testing подменены для программных событий.
Mount samples не повторялись 30+ раз. Подробные raw значения: раздел 19 в
`docs/17_PERFORMANCE_BASELINE.md`.

## Приемка на staging

1. Развернуть приложение обычным способом и открыть редакторы заново. Миграция и новый
   feature flag **не нужны**. Assessment-флаги предыдущих этапов не менять.
2. Подготовить компании/admin draft из 100+ вопросов / 400+ options с длинными rich text,
   всеми типами, content blocks и remediation. Сначала убедиться, что открыт один вопрос.
3. В React Profiler записать ввод в текст/баллы/effects варианта. Другие вопросы не должны
   рендериться; переименование вопроса вправе обновить remediation-списки с его названием.
4. Проверить свертывание, «развернуть/свернуть все», ввод во время autosave, сохранение,
   reload и preview; сравнить итоговый документ с исходными правками.
5. Проверить create/copy/delete/move каждого типа, варианты, content blocks и remediation:
   IDs копий новые, нужные ссылки перенесены, после удаления/перемещения нет invalid links.
6. Проверить mouse/touch drag между секциями, автопрокрутку у краев, pointer cancel и
   перенос через длинные карточки. При scroll/expand у intrinsic placeholder не должно
   быть неприемлемых скачков, обрезанных редакторов или неверной drop position.
7. Проверить клавиатуру: Tab/focus, toggle, стрелки на ручке, сохранение фокуса после move.
   Проверить screen reader и видимость/focus offscreen controls в целевых браузерах.
8. Записать реальные пользовательские взаимодействия в production-сборке на целевых
   устройствах: INP ≤ 200 мс по плану, минимум 30 cold/warm сессий и одинаковый dataset.
   Отдельно смотреть long tasks при раскрытии всей секции, rich text, scroll и autosave.
   Пока это не выполнено, performance acceptance PERF-007 не закрыт.

## Откат

Сохранить открытые черновики, вернуть предыдущую версию приложения и перезагрузить страницы.
Schema/data rollback не нужен; сохраненные правки остаются обычным BuilderDocument.
Не удалять версии/секции и не сбрасывать опубликованные тесты ради отката.

Следующий кодовый шаг — PERF-008: инкрементальное атомарное сохранение с revision conflict.
