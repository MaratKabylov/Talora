"use client";

import { memo, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DIFFICULTY_LABELS, DIFFICULTY_VALUES, QUESTION_TYPE_LABELS, QUESTION_TYPE_VALUES, TEST_COMPETENCIES, type QuestionType } from "@/lib/tests/builder-constants";
import type { BuilderQuestion } from "@/lib/tests/builder-data";
import { copyQuestion, option } from "./builder-document";
import type { BuilderEditorActions } from "./use-builder-actions";
import type { QuestionDragHandlers } from "./use-question-drag";
import { OptionEditor, type OptionDragHandlers } from "./option-editor";

export const QuestionEditor = memo(function QuestionEditor({ currentQuestion, questionIndex, sectionId, questionTitlesJson, isQuestionCollapsed, toggleQuestion, isDragging, dropBefore, dropAfter, actions, dragHandlers }: {
  currentQuestion: BuilderQuestion; questionIndex: number; sectionId: string; questionTitlesJson: string;
  isQuestionCollapsed: boolean; toggleQuestion: (id: string) => void; isDragging: boolean; dropBefore: boolean; dropAfter: boolean;
  actions: BuilderEditorActions; dragHandlers: QuestionDragHandlers;
}) {
  const { patchQuestion, updateSections, addQuestionAfter } = actions;
  const { finishQuestionDrag, startQuestionPointerDrag, continueQuestionPointerDrag, completeQuestionPointerDrag } = dragHandlers;
  const questionTitles: Array<{ id: string; text: string }> = useMemo(() => JSON.parse(questionTitlesJson), [questionTitlesJson]);
  const [remediationEnabled, setRemediationEnabled] = useState(() => Boolean(currentQuestion.remediationQuestionId || currentQuestion.incorrectFeedback));
  const [draggingOptionId, setDraggingOptionId] = useState<string | null>(null);
  const optionDragId = useRef<string | null>(null);
  const questionId = currentQuestion.id;
  const optionDragHandlers = useMemo<OptionDragHandlers>(() => ({
    start(id) { optionDragId.current = id; setDraggingOptionId(id); },
    finish() { optionDragId.current = null; setDraggingOptionId(null); },
    drop(index) {
      if (optionDragId.current) actions.moveOption(sectionId, questionId, optionDragId.current, index);
      optionDragId.current = null; setDraggingOptionId(null);
    },
  }), [actions, sectionId, questionId]);
  return (
    <article
      className={`rounded-lg border bg-background p-4 transition-all hover:shadow-sm ${isDragging ? "opacity-50" : ""
        } ${dropBefore ? "border-t-4 border-t-primary" : ""} ${dropAfter ? "border-b-4 border-b-primary" : ""
        }`}
      data-question-drop-index={questionIndex}
      data-question-section-id={sectionId}
      data-builder-question-id={currentQuestion.id}
      style={{ contentVisibility: "auto", containIntrinsicBlockSize: isQuestionCollapsed ? "auto 64px" : "auto 640px" }}
    >
      <div
        className={`flex items-center justify-between gap-2 ${isQuestionCollapsed ? "" : "mb-4"
          }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            aria-label="Переместить вопрос"
            type="button"
            className="flex touch-none select-none shrink-0 cursor-grab items-center rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
            onPointerCancel={finishQuestionDrag}
            onPointerDown={(event) =>
              startQuestionPointerDrag(
                event,
                sectionId,
                currentQuestion.id,
              )
            }
            onPointerMove={continueQuestionPointerDrag}
            onPointerUp={completeQuestionPointerDrag}
            title="Перетащить вопрос. Стрелки вверх/вниз — переместить внутри секции."
            onKeyDown={event => {
              if (event.key === "Escape") finishQuestionDrag();
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              actions.moveQuestion({ sectionId, questionId: currentQuestion.id }, sectionId,
                questionIndex + (event.key === "ArrowUp" ? -1 : 2));
            }}
          >
            <GripVertical />
          </button>
          <button
            aria-controls={`builder-question-${currentQuestion.id}-body`}
            aria-expanded={!isQuestionCollapsed}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            onClick={() => toggleQuestion(currentQuestion.id)}
            type="button"
          >
            {isQuestionCollapsed ? <ChevronRight /> : <ChevronDown />}
            <span className="shrink-0 font-medium">Вопрос {questionIndex + 1}</span>
            <span className="truncate text-foreground">
              {currentQuestion.text || "Без текста"}
            </span>
            {isQuestionCollapsed ? (
              <span className="hidden shrink-0 rounded-full bg-muted px-2 py-0.5 sm:inline">
                {QUESTION_TYPE_LABELS[currentQuestion.questionType]}
              </span>
            ) : null}
          </button>
        </div>
        <div className="flex gap-1">
          <Button
            aria-label="Дублировать вопрос"
            onClick={() =>
              updateSections((current) =>
                current.map((entry) =>
                  entry.id === sectionId
                    ? {
                      ...entry,
                      contentBlocks: entry.contentBlocks.map((block) => ({
                        ...block,
                        positionIndex:
                          block.positionIndex >= questionIndex + 1
                            ? block.positionIndex + 1
                            : block.positionIndex,
                      })),
                      questions: [
                        ...entry.questions.slice(0, questionIndex + 1),
                        copyQuestion(currentQuestion),
                        ...entry.questions.slice(questionIndex + 1),
                      ],
                    }
                    : entry,
                ),
              )
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            <Copy />
          </Button>
          <Button
            aria-label="Удалить вопрос"
            onClick={() =>
              updateSections((current) =>
                current.map((entry) =>
                  entry.id === sectionId
                    ? {
                      ...entry,
                      contentBlocks: entry.contentBlocks.map((block) => ({
                        ...block,
                        positionIndex:
                          block.positionIndex > questionIndex
                            ? Math.max(0, block.positionIndex - 1)
                            : block.positionIndex,
                      })),
                      questions: entry.questions
                        .filter((entryQuestion) => entryQuestion.id !== currentQuestion.id)
                        .map((entryQuestion) =>
                          entryQuestion.remediationQuestionId === currentQuestion.id
                            ? {
                              ...entryQuestion,
                              incorrectFeedback: null,
                              remediationQuestionId: null,
                            }
                            : entryQuestion,
                        ),
                    }
                    : entry,
                ),
              )
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      {!isQuestionCollapsed ? (
        <div id={`builder-question-${currentQuestion.id}-body`}>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_13rem]">
            <Textarea
              className="min-h-16 text-base"
              onChange={(event) =>
                patchQuestion(sectionId, currentQuestion.id, { text: event.target.value })
              }
              value={currentQuestion.text}
            />
            <Select
              onChange={(event) => {
                const questionType = event.target.value as QuestionType;
                const needsOptions =
                  questionType !== "scale" &&
                  questionType !== "open_text" &&
                  currentQuestion.options.length === 0;
                const forcedChoiceOptions =
                  questionType === "forced_choice"
                    ? [
                      ...currentQuestion.options.map((entry) => ({
                        ...entry,
                        isCorrect: false,
                        points: 0,
                      })),
                      ...Array.from(
                        { length: Math.max(0, 3 - currentQuestion.options.length) },
                        (_, index) =>
                          option(`Утверждение ${currentQuestion.options.length + index + 1}`),
                      ),
                    ]
                    : null;
                const structuredOptions =
                  questionType === "matching"
                    ? (currentQuestion.options.length > 0
                      ? currentQuestion.options
                      : [option("Элемент 1"), option("Элемент 2")]
                    ).map((entry, index) => ({
                      ...entry,
                      competencyEffects: {},
                      explanation: null,
                      isCorrect: false,
                      matchText: entry.matchText ?? `Соответствие ${index + 1}`,
                      points: 0,
                    }))
                    : questionType === "ordering"
                      ? (currentQuestion.options.length > 0
                        ? currentQuestion.options
                        : [option("Элемент 1"), option("Элемент 2")]
                      ).map((entry) => ({
                        ...entry,
                        competencyEffects: {},
                        explanation: null,
                        isCorrect: false,
                        matchText: null,
                        points: 0,
                      }))
                      : null;
                if (questionType !== "single_choice") {
                  setRemediationEnabled(false);
                }
                patchQuestion(sectionId, currentQuestion.id, {
                  competencyKey:
                    questionType === "forced_choice" ? null : currentQuestion.competencyKey,
                  options:
                    forcedChoiceOptions ??
                    structuredOptions ??
                    (needsOptions
                      ? [option("Вариант 1"), option("Вариант 2")]
                      : currentQuestion.options),
                  points: questionType === "forced_choice" ? 0 : currentQuestion.points,
                  questionType,
                  isStructured:
                    questionType === "ordering" || questionType === "matching",
                  ...(questionType === "single_choice"
                    ? {}
                    : { incorrectFeedback: null, remediationQuestionId: null }),
                  ...(
                    questionType === "single_choice" ||
                      questionType === "multiple_choice"
                      ? {}
                      : { shuffleOptions: false }
                  ),
                });
              }}
              value={currentQuestion.questionType}
            >
              {QUESTION_TYPE_VALUES.map((type) => (
                <option key={type} value={type}>
                  {QUESTION_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </div>
          <RichTextEditor
            className="mt-3"
            id={`builder-question-${currentQuestion.id}-description`}
            onChange={(value) =>
              patchQuestion(sectionId, currentQuestion.id, { description: value })
            }
            placeholder="Пояснение к вопросу (необязательно)"
            value={currentQuestion.description ?? ""}
          />

          {currentQuestion.questionType === "single_choice" ? (
            <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5">
              <label className="flex cursor-pointer items-start gap-3 p-4">
                <input
                  aria-controls={`builder-question-${currentQuestion.id}-remediation`}
                  checked={remediationEnabled}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  onChange={(event) => {
                    const isEnabled = event.target.checked;
                    setRemediationEnabled(isEnabled);
                    if (!isEnabled) {
                      patchQuestion(sectionId, currentQuestion.id, {
                        incorrectFeedback: null,
                        remediationQuestionId: null,
                      });
                    }
                  }}
                  type="checkbox"
                />
                <span>
                  <span className="block text-sm font-medium">Если допущена ошибка</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Покажем объяснение и откроем выбранный повторный вопрос.
                  </span>
                </span>
              </label>
              {remediationEnabled ? (
                <div
                  className="space-y-3 border-t border-primary/15 px-4 pb-4 pt-3"
                  id={`builder-question-${currentQuestion.id}-remediation`}
                >
                  <p className="text-xs text-muted-foreground">
                    Повторный вопрос должен находиться ниже в этой секции.
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Select
                      aria-label="Повторный вопрос после ошибки"
                      className="min-w-0 flex-1"
                      onChange={(event) =>
                        patchQuestion(sectionId, currentQuestion.id, {
                          ...(event.target.value ? {} : { incorrectFeedback: null }),
                          remediationQuestionId: event.target.value || null,
                        })
                      }
                      value={currentQuestion.remediationQuestionId ?? ""}
                    >
                      <option value="">
                        {questionTitles.length > questionIndex + 1
                          ? "Выберите повторный вопрос"
                          : "Нет вопросов ниже"}
                      </option>
                      {questionTitles.slice(questionIndex + 1).map((candidate, offset) => (
                        <option key={candidate.id} value={candidate.id}>
                          Вопрос {questionIndex + offset + 2}: {candidate.text.slice(0, 90)}
                        </option>
                      ))}
                    </Select>
                    <Button
                      onClick={() => addQuestionAfter(sectionId, currentQuestion.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Plus /> Создать повторный вопрос
                    </Button>
                  </div>
                  <Textarea
                    disabled={!currentQuestion.remediationQuestionId}
                    onChange={(event) =>
                      patchQuestion(sectionId, currentQuestion.id, {
                        incorrectFeedback: event.target.value,
                      })
                    }
                    placeholder="Например: Слово собирается из трёх признаков…"
                    value={currentQuestion.incorrectFeedback ?? ""}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {currentQuestion.questionType === "single_choice" ||
            currentQuestion.questionType === "multiple_choice" ? (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/20 p-4">
              <input
                checked={currentQuestion.shuffleOptions}
                className="mt-0.5 size-4 shrink-0 accent-primary"
                onChange={(event) =>
                  patchQuestion(sectionId, currentQuestion.id, {
                    shuffleOptions: event.target.checked,
                  })
                }
                type="checkbox"
              />
              <span>
                <span className="block text-sm font-medium">
                  Перемешивать варианты ответов
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Порядок будет стабильным в рамках одной попытки и разным между попытками.
                </span>
              </span>
            </label>
          ) : null}

          {currentQuestion.questionType === "scale" ? (
            <div className="mt-4 grid max-w-sm grid-cols-2 gap-3">
              <Input
                min="1"
                onChange={(event) =>
                  patchQuestion(sectionId, currentQuestion.id, {
                    scaleMin: Number(event.target.value),
                  })
                }
                type="number"
                value={currentQuestion.scaleMin}
              />
              <Input
                min="2"
                onChange={(event) =>
                  patchQuestion(sectionId, currentQuestion.id, {
                    scaleMax: Number(event.target.value),
                  })
                }
                type="number"
                value={currentQuestion.scaleMax}
              />
            </div>
          ) : currentQuestion.questionType === "ordering" ||
            currentQuestion.questionType === "matching" ? (
            <div className="mt-4 space-y-3">
              {!currentQuestion.isStructured ? (
                <div className="flex flex-col gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    Это legacy-вопрос с текстовым ответом. Переведите его в интерактивный формат в текущем черновике.
                  </span>
                  <Button
                    onClick={() =>
                      patchQuestion(sectionId, currentQuestion.id, {
                        isStructured: true,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Перевести
                  </Button>
                </div>
              ) : null}
              <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-[1fr_16rem] sm:items-end">
                <p className="text-sm text-muted-foreground">
                  {currentQuestion.questionType === "ordering"
                    ? "Расположите элементы ниже в правильном порядке. Кандидат увидит перемешанный список."
                    : "Каждая строка задаёт правильную пару. Правые варианты будут перемешаны."}
                </p>
                <div className="space-y-1">
                  <Label htmlFor={`builder-question-${currentQuestion.id}-structured-scoring`}>
                    Начисление баллов
                  </Label>
                  <Select
                    id={`builder-question-${currentQuestion.id}-structured-scoring`}
                    onChange={(event) =>
                      currentQuestion.questionType === "ordering"
                        ? patchQuestion(sectionId, currentQuestion.id, {
                          orderingScoringMode: event.target.value as BuilderQuestion["orderingScoringMode"],
                        })
                        : patchQuestion(sectionId, currentQuestion.id, {
                          matchingScoringMode: event.target.value as BuilderQuestion["matchingScoringMode"],
                        })
                    }
                    value={
                      currentQuestion.questionType === "ordering"
                        ? currentQuestion.orderingScoringMode
                        : currentQuestion.matchingScoringMode
                    }
                  >
                    <option value={currentQuestion.questionType === "ordering" ? "pairwise" : "per_pair"}>
                      Частичный балл
                    </option>
                    <option value="exact">Только полное совпадение</option>
                  </Select>
                </div>
              </div>
              {currentQuestion.questionType === "matching" ? (
                <div className="hidden grid-cols-[2rem_1fr_1fr_auto] gap-2 px-2 text-xs font-medium text-muted-foreground md:grid">
                  <span />
                  <span>Левый элемент</span>
                  <span>Правильное соответствие</span>
                  <span />
                </div>
              ) : null}
              {currentQuestion.options.map((currentOption, optionIndex) => (
                <OptionEditor key={currentOption.id} currentOption={currentOption} optionIndex={optionIndex}
                  optionCount={currentQuestion.options.length} questionType={currentQuestion.questionType}
                  sectionId={sectionId} questionId={currentQuestion.id} actions={actions}
                  isDragging={draggingOptionId === currentOption.id} dragHandlers={optionDragHandlers} />
              ))}
              <Button
                onClick={() =>
                  patchQuestion(sectionId, currentQuestion.id, {
                    isStructured: true,
                    options: [
                      ...currentQuestion.options,
                      {
                        ...option(
                          currentQuestion.questionType === "matching"
                            ? `Элемент ${currentQuestion.options.length + 1}`
                            : `Элемент ${currentQuestion.options.length + 1}`,
                        ),
                        matchText:
                          currentQuestion.questionType === "matching"
                            ? `Соответствие ${currentQuestion.options.length + 1}`
                            : null,
                      },
                    ],
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus />
                {currentQuestion.questionType === "matching" ? "Добавить пару" : "Добавить элемент"}
              </Button>
            </div>
          ) : currentQuestion.questionType !== "open_text" ? (
            <div className="mt-4 space-y-2">
              {currentQuestion.questionType === "forced_choice" ? (
                <p className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
                  Режим MOST / LEAST. Для каждого утверждения выберите компетенцию;
                  правильных ответов и баллов за правильность здесь нет.
                </p>
              ) : null}
              {currentQuestion.options.map((currentOption, optionIndex) => (
                <OptionEditor key={currentOption.id} currentOption={currentOption} optionIndex={optionIndex}
                  optionCount={currentQuestion.options.length} questionType={currentQuestion.questionType}
                  sectionId={sectionId} questionId={currentQuestion.id} actions={actions}
                  isDragging={draggingOptionId === currentOption.id} dragHandlers={optionDragHandlers} />
              ))}
              <Button
                onClick={() =>
                  patchQuestion(sectionId, currentQuestion.id, {
                    options: [
                      ...currentQuestion.options,
                      option(
                        `${currentQuestion.questionType === "forced_choice" ? "Утверждение" : "Вариант"} ${currentQuestion.options.length + 1}`,
                      ),
                    ],
                  })
                }
                size="sm"
                type="button"
                variant="outline"
              >
                <Plus />
                {currentQuestion.questionType === "forced_choice"
                  ? "Добавить утверждение"
                  : "Добавить вариант"}
              </Button>
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
            {currentQuestion.questionType !== "forced_choice" ? (
              <Select
                onChange={(event) =>
                  patchQuestion(sectionId, currentQuestion.id, {
                    competencyKey: (event.target.value || null) as BuilderQuestion["competencyKey"],
                  })
                }
                value={currentQuestion.competencyKey ?? ""}
              >
                <option value="">Без компетенции</option>
                {TEST_COMPETENCIES.map((competency) => (
                  <option key={competency.key} value={competency.key}>
                    {competency.label}
                  </option>
                ))}
              </Select>
            ) : null}
            <Select
              onChange={(event) =>
                patchQuestion(sectionId, currentQuestion.id, {
                  difficulty: (event.target.value || null) as BuilderQuestion["difficulty"],
                })
              }
              value={currentQuestion.difficulty ?? ""}
            >
              <option value="">Без сложности</option>
              {DIFFICULTY_VALUES.map((difficulty) => (
                <option key={difficulty} value={difficulty}>
                  {DIFFICULTY_LABELS[difficulty]}
                </option>
              ))}
            </Select>
            {currentQuestion.questionType !== "forced_choice" ? (
              <Input
                min="0"
                onChange={(event) =>
                  patchQuestion(sectionId, currentQuestion.id, {
                    points: Number(event.target.value),
                  })
                }
                placeholder="Макс. баллы"
                step="0.01"
                type="number"
                value={currentQuestion.points}
              />
            ) : null}
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm">
            <input
              checked={currentQuestion.isRequired}
              className="size-4 accent-primary"
              onChange={(event) =>
                patchQuestion(sectionId, currentQuestion.id, {
                  isRequired: event.target.checked,
                })
              }
              type="checkbox"
            />
            Обязательный вопрос
          </label>
        </div>
      ) : null}
    </article>

  );
});
