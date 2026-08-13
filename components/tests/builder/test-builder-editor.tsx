"use client";

import { Copy, Eye, FileInput, GripVertical, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  publishTestVersionAction as defaultPublishTestVersionAction,
} from "@/lib/tests/actions";
import {
  saveBuilderDocumentAction as defaultSaveBuilderDocumentAction,
  type BuilderDocumentInput,
  type BuilderSaveResult,
} from "@/lib/tests/builder-actions";
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_VALUES,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPE_VALUES,
  TEST_COMPETENCIES,
  type QuestionType,
} from "@/lib/tests/builder-constants";
import type {
  BuilderImportSource,
  BuilderQuestion,
  BuilderSection,
} from "@/lib/tests/builder-data";
import type { TestVersion } from "@/lib/tests/data";
import { formatTestVersionTitle } from "@/lib/tests/version-title";

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

const QUESTION_PRESETS: Array<{
  label: string;
  questionType: QuestionType;
  text: string;
}> = [
  { label: "Один выбор", questionType: "single_choice", text: "Выберите наиболее подходящий вариант." },
  { label: "Шкала", questionType: "scale", text: "Оцените утверждение по шкале." },
  { label: "Развернутый ответ", questionType: "open_text", text: "Опишите ваш подход к ситуации." },
];

function uuid() {
  return crypto.randomUUID();
}

function option(text = "Вариант ответа") {
  return {
    competencyEffects: {},
    explanation: null,
    id: uuid(),
    isCorrect: false,
    orderIndex: 1,
    points: 0,
    text,
  };
}

function question(questionType: QuestionType = "single_choice", text = "Новый вопрос"): BuilderQuestion {
  return {
    competencyKey: null,
    description: null,
    difficulty: null,
    id: uuid(),
    incorrectFeedback: null,
    isRequired: true,
    options:
      questionType === "single_choice" || questionType === "multiple_choice"
        ? [option("Вариант 1"), option("Вариант 2")]
        : [],
    orderIndex: 1,
    points: 1,
    questionType,
    remediationQuestionId: null,
    scaleMax: 5,
    scaleMin: 1,
    text,
  };
}

function section(title = "Новая секция"): BuilderSection {
  return {
    description: null,
    id: uuid(),
    orderIndex: 1,
    questions: [question()],
    timeLimitMinutes: null,
    title,
  };
}

function copyQuestion(source: BuilderQuestion): BuilderQuestion {
  return {
    ...source,
    id: uuid(),
    incorrectFeedback: null,
    isRequired: source.isRequired ?? true,
    options: source.options.map((entry) => ({ ...entry, id: uuid(), isCorrect: Boolean(entry.isCorrect) })),
    remediationQuestionId: null,
  };
}

function copySection(source: BuilderSection): BuilderSection {
  const questionIds = new Map(source.questions.map((entry) => [entry.id, uuid()]));
  return {
    ...source,
    id: uuid(),
    questions: source.questions.map((entry) => ({
      ...entry,
      id: questionIds.get(entry.id)!,
      options: entry.options.map((optionEntry) => ({
        ...optionEntry,
        id: uuid(),
        isCorrect: Boolean(optionEntry.isCorrect),
      })),
      remediationQuestionId: entry.remediationQuestionId
        ? questionIds.get(entry.remediationQuestionId) ?? null
        : null,
    })),
  };
}

function editableSections(sections: BuilderSection[]) {
  return sections.map((entry) => ({
    ...entry,
    questions: entry.questions.map((currentQuestion) => ({
      ...currentQuestion,
      incorrectFeedback: currentQuestion.incorrectFeedback ?? null,
      isRequired: currentQuestion.isRequired ?? true,
      options: currentQuestion.options.map((currentOption) => ({
        ...currentOption,
        isCorrect: Boolean(currentOption.isCorrect),
      })),
      remediationQuestionId: currentQuestion.remediationQuestionId ?? null,
    })),
  }));
}

function nullableText(text: string) {
  return text.trim() ? text : null;
}

export function TestBuilderEditor({
  imports,
  initialSections,
  publishAction = defaultPublishTestVersionAction,
  saveAction = defaultSaveBuilderDocumentAction,
  templateId,
  previewPath,
  version: initialVersion,
}: {
  imports: BuilderImportSource[];
  initialSections: BuilderSection[];
  publishAction?: (formData: FormData) => Promise<void>;
  saveAction?: (input: unknown) => Promise<BuilderSaveResult>;
  templateId: string;
  previewPath: string;
  version: TestVersion;
}) {
  const versionTitle = formatTestVersionTitle(initialVersion.versionNumber);
  const [sections, setSections] = useState<BuilderSection[]>(() => editableSections(initialSections));
  const [version, setVersion] = useState({
    description: initialVersion.description ?? "",
    durationMinutes: initialVersion.durationMinutes?.toString() ?? "",
    instructions: initialVersion.instructions ?? "",
    scoringType: initialVersion.scoringType,
  });
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [feedback, setFeedback] = useState("");
  const [importId, setImportId] = useState(imports[0]?.id ?? "");
  const revision = useRef(0);
  const dragQuestion = useRef<{ index: number; sectionId: string } | null>(null);

  const markChanged = useCallback(() => {
    revision.current += 1;
    setStatus("dirty");
    setFeedback("");
  }, []);

  const updateSections = useCallback(
    (update: (current: BuilderSection[]) => BuilderSection[]) => {
      setSections((current) => update(current));
      markChanged();
    },
    [markChanged],
  );

  const updateVersion = (
    field: "description" | "durationMinutes" | "instructions",
    value: string,
  ) => {
    setVersion((current) => ({ ...current, [field]: value }));
    markChanged();
  };

  const save = useCallback(async () => {
    const requestedRevision = revision.current;
    setStatus("saving");
    const input: BuilderDocumentInput = {
      sections: sections.map((currentSection) => ({
        description: nullableText(currentSection.description ?? ""),
        id: currentSection.id,
        questions: currentSection.questions.map((currentQuestion) => ({
          competencyKey: currentQuestion.competencyKey,
          description: nullableText(currentQuestion.description ?? ""),
          difficulty: currentQuestion.difficulty,
          id: currentQuestion.id,
          incorrectFeedback: nullableText(currentQuestion.incorrectFeedback ?? ""),
          isRequired: currentQuestion.isRequired,
          options: currentQuestion.options.map((currentOption) => ({
            competencyEffects: currentOption.competencyEffects,
            explanation: nullableText(currentOption.explanation ?? ""),
            id: currentOption.id,
            isCorrect: Boolean(currentOption.isCorrect),
            points: Number(currentOption.points) || 0,
            text: currentOption.text,
          })),
          points: Number(currentQuestion.points) || 0,
          questionType: currentQuestion.questionType,
          remediationQuestionId: currentQuestion.remediationQuestionId,
          scaleMax: Number(currentQuestion.scaleMax) || 5,
          scaleMin: Number(currentQuestion.scaleMin) || 1,
          text: currentQuestion.text,
        })),
        timeLimitMinutes: currentSection.timeLimitMinutes,
        title: currentSection.title,
      })),
      templateId,
      version: {
        description: nullableText(version.description),
        durationMinutes: version.durationMinutes ? Number(version.durationMinutes) : null,
        instructions: nullableText(version.instructions),
        scoringType: version.scoringType,
        title: versionTitle,
      },
      versionId: initialVersion.id,
    };

    const result = await saveAction(input);
    if (!result.ok) {
      setStatus("error");
      setFeedback(result.error ?? "Не удалось сохранить изменения.");
      return false;
    }

    if (revision.current === requestedRevision) {
      setStatus("saved");
      setFeedback(
        `Сохранено ${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(
          new Date(result.savedAt ?? Date.now()),
        )}`,
      );
    } else {
      setStatus("dirty");
    }
    return true;
  }, [initialVersion.id, saveAction, sections, templateId, version, versionTitle]);

  useEffect(() => {
    if (status !== "dirty") return;
    const timer = window.setTimeout(() => void save(), 1200);
    return () => window.clearTimeout(timer);
  }, [save, status]);

  function patchSection(sectionId: string, patch: Partial<BuilderSection>) {
    updateSections((current) =>
      current.map((entry) => (entry.id === sectionId ? { ...entry, ...patch } : entry)),
    );
  }

  function patchQuestion(sectionId: string, questionId: string, patch: Partial<BuilderQuestion>) {
    updateSections((current) =>
      current.map((entry) =>
        entry.id === sectionId
          ? {
              ...entry,
              questions: entry.questions.map((currentQuestion) =>
                currentQuestion.id === questionId ? { ...currentQuestion, ...patch } : currentQuestion,
              ),
            }
          : entry,
      ),
    );
  }

  function addQuestionAfter(sectionId: string, questionId: string) {
    const newQuestion = question("single_choice", "Повторный вопрос");

    updateSections((current) =>
      current.map((entry) => {
        if (entry.id !== sectionId) return entry;

        const questionIndex = entry.questions.findIndex(
          (currentQuestion) => currentQuestion.id === questionId,
        );
        if (questionIndex === -1) return entry;

        return {
          ...entry,
          questions: [
            ...entry.questions.slice(0, questionIndex + 1),
            newQuestion,
            ...entry.questions.slice(questionIndex + 1),
          ],
        };
      }),
    );
  }

  function patchOption(
    sectionId: string,
    questionId: string,
    optionId: string,
    patch: Partial<BuilderQuestion["options"][number]>,
  ) {
    updateSections((current) =>
      current.map((entry) =>
        entry.id === sectionId
          ? {
              ...entry,
              questions: entry.questions.map((currentQuestion) =>
                currentQuestion.id === questionId
                  ? {
                      ...currentQuestion,
                      options: currentQuestion.options.map((currentOption) =>
                        currentOption.id === optionId ? { ...currentOption, ...patch } : currentOption,
                      ),
                    }
                  : currentQuestion,
              ),
            }
          : entry,
      ),
    );
  }

  function importSections() {
    const source = imports.find((entry) => entry.id === importId);
    if (!source) return;
    updateSections((current) => [...current, ...source.sections.map(copySection)]);
  }

  async function openPreview() {
    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      setStatus("error");
      setFeedback("Браузер заблокировал новую вкладку. Разрешите всплывающие окна и повторите.");
      return;
    }

    previewWindow.document.title = "Подготавливаем предпросмотр";
    previewWindow.document.body.textContent = "Сохраняем изменения и открываем предпросмотр…";
    const saved = await save();
    if (!saved) {
      previewWindow.close();
      return;
    }

    previewWindow.opener = null;
    previewWindow.location.href = previewPath;
  }

  return (
    <div className="space-y-5">
      <div className="sticky top-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur">
        <div className="text-sm">
          <p className="font-medium">Черновик v{initialVersion.versionNumber}</p>
          <p className={status === "error" ? "text-destructive" : "text-muted-foreground"}>
            {status === "saving"
              ? "Сохраняем..."
              : status === "dirty"
                ? "Есть несохраненные изменения"
                : feedback || "Автосохранение включено"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={status === "saving"} onClick={() => void openPreview()} type="button" variant="outline">
            <Eye /> Предпросмотр
          </Button>
          <Button disabled={status === "saving"} onClick={() => void save()} type="button" variant="outline">
            <Save /> Сохранить
          </Button>
          <form action={publishAction}>
            <input name="templateId" type="hidden" value={templateId} />
            <input name="versionId" type="hidden" value={initialVersion.id} />
            <Button
              disabled={status === "dirty" || status === "saving" || status === "error"}
              type="submit"
            >
              Опубликовать
            </Button>
          </form>
        </div>
      </div>

      <div>
        <div className="space-y-5">
          <div className="rounded-xl border-t-8 border-t-primary bg-card p-6 shadow-sm">
            <Input
              aria-readonly
              className="h-auto border-0 bg-muted/40 px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
              readOnly
              value={versionTitle}
            />
            <RichTextEditor
              className="mt-3"
              id="builder-version-description"
              onChange={(value) => updateVersion("description", value)}
              placeholder="Описание теста"
              value={version.description}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Input
                min="1"
                onChange={(event) => updateVersion("durationMinutes", event.target.value)}
                placeholder="Длительность, минут"
                type="number"
                value={version.durationMinutes}
              />
              <Select
                onChange={(event) => {
                  setVersion((current) => ({
                    ...current,
                    scoringType: event.target.value as TestVersion["scoringType"],
                  }));
                  markChanged();
                }}
                value={version.scoringType}
              >
                <option value="points">Баллы</option>
                <option value="competency_profile">Профиль компетенций</option>
                <option value="manual">Ручная оценка</option>
                <option value="mixed">Смешанная</option>
              </Select>
            </div>
            <RichTextEditor
              className="mt-3"
              id="builder-version-instructions"
              onChange={(value) => updateVersion("instructions", value)}
              placeholder="Инструкция кандидату"
              value={version.instructions}
            />
          </div>

          {sections.map((currentSection, sectionIndex) => (
            <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm" key={currentSection.id}>
              <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 p-4">
                <div className="min-w-0 flex-1 space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-primary">
                    Секция {sectionIndex + 1} из {sections.length}
                  </p>
                  <Input
                    className="border-0 bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
                    onChange={(event) => patchSection(currentSection.id, { title: event.target.value })}
                    value={currentSection.title}
                  />
                  <RichTextEditor
                    id={`builder-section-${currentSection.id}-description`}
                    onChange={(value) => patchSection(currentSection.id, { description: value })}
                    placeholder="Описание или инструкция для секции"
                    value={currentSection.description ?? ""}
                  />
                  <Input
                    className="max-w-56 bg-background"
                    min="1"
                    onChange={(event) =>
                      patchSection(currentSection.id, {
                        timeLimitMinutes: event.target.value ? Number(event.target.value) : null,
                      })
                    }
                    placeholder="Лимит времени, минут"
                    type="number"
                    value={currentSection.timeLimitMinutes ?? ""}
                  />
                </div>
                <div className="flex gap-1">
                  <Button
                    aria-label="Дублировать секцию"
                    onClick={() =>
                      updateSections((current) => [
                        ...current.slice(0, sectionIndex + 1),
                        copySection(currentSection),
                        ...current.slice(sectionIndex + 1),
                      ])
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Copy />
                  </Button>
                  <Button
                    aria-label="Удалить секцию"
                    onClick={() =>
                      updateSections((current) => current.filter((entry) => entry.id !== currentSection.id))
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>

              {currentSection.questions.map((currentQuestion, questionIndex) => (
                <article
                  className="rounded-lg border bg-background p-4 transition-shadow hover:shadow-sm"
                  key={currentQuestion.id}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    const source = dragQuestion.current;
                    if (!source || source.sectionId !== currentSection.id || source.index === questionIndex) return;
                    updateSections((current) =>
                      current.map((entry) => {
                        if (entry.id !== currentSection.id) return entry;
                        const reordered = [...entry.questions];
                        const [moved] = reordered.splice(source.index, 1);
                        reordered.splice(questionIndex, 0, moved);
                        return { ...entry, questions: reordered };
                      }),
                    );
                    dragQuestion.current = null;
                  }}
                >
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <div
                      className="flex cursor-grab items-center gap-2 text-xs text-muted-foreground"
                      draggable
                      onDragStart={() => {
                        dragQuestion.current = { index: questionIndex, sectionId: currentSection.id };
                      }}
                    >
                      <GripVertical className="cursor-grab" />
                      Вопрос {questionIndex + 1}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        aria-label="Дублировать вопрос"
                        onClick={() =>
                          updateSections((current) =>
                            current.map((entry) =>
                              entry.id === currentSection.id
                                ? {
                                    ...entry,
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
                              entry.id === currentSection.id
                                ? {
                                    ...entry,
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
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_13rem]">
                    <Textarea
                      className="min-h-16 text-base"
                      onChange={(event) =>
                        patchQuestion(currentSection.id, currentQuestion.id, { text: event.target.value })
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
                        patchQuestion(currentSection.id, currentQuestion.id, {
                          options: needsOptions ? [option("Вариант 1"), option("Вариант 2")] : currentQuestion.options,
                          questionType,
                          ...(questionType === "single_choice"
                            ? {}
                            : { incorrectFeedback: null, remediationQuestionId: null }),
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
                      patchQuestion(currentSection.id, currentQuestion.id, { description: value })
                    }
                    placeholder="Пояснение к вопросу (необязательно)"
                    value={currentQuestion.description ?? ""}
                  />

                  {currentQuestion.questionType === "single_choice" ? (
                    <div className="mt-4 space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
                      <div>
                        <p className="text-sm font-medium">Если допущена ошибка</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Покажем объяснение и откроем выбранный повторный вопрос. Он должен находиться ниже в этой секции.
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Select
                          aria-label="Повторный вопрос после ошибки"
                          className="min-w-0 flex-1"
                          onChange={(event) =>
                            patchQuestion(currentSection.id, currentQuestion.id, {
                              ...(event.target.value ? {} : { incorrectFeedback: null }),
                              remediationQuestionId: event.target.value || null,
                            })
                          }
                          value={currentQuestion.remediationQuestionId ?? ""}
                        >
                          <option value="">
                            {currentSection.questions.length > questionIndex + 1
                              ? "Не использовать ветку"
                              : "Нет вопросов ниже"}
                          </option>
                          {currentSection.questions.slice(questionIndex + 1).map((candidate, offset) => (
                            <option key={candidate.id} value={candidate.id}>
                              Вопрос {questionIndex + offset + 2}: {candidate.text.slice(0, 90)}
                            </option>
                          ))}
                        </Select>
                        <Button
                          onClick={() => addQuestionAfter(currentSection.id, currentQuestion.id)}
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
                          patchQuestion(currentSection.id, currentQuestion.id, {
                            incorrectFeedback: event.target.value,
                          })
                        }
                        placeholder="Например: Слово собирается из трёх признаков…"
                        value={currentQuestion.incorrectFeedback ?? ""}
                      />
                    </div>
                  ) : null}

                  {currentQuestion.questionType === "scale" ? (
                    <div className="mt-4 grid max-w-sm grid-cols-2 gap-3">
                      <Input
                        min="1"
                        onChange={(event) =>
                          patchQuestion(currentSection.id, currentQuestion.id, {
                            scaleMin: Number(event.target.value),
                          })
                        }
                        type="number"
                        value={currentQuestion.scaleMin}
                      />
                      <Input
                        min="2"
                        onChange={(event) =>
                          patchQuestion(currentSection.id, currentQuestion.id, {
                            scaleMax: Number(event.target.value),
                          })
                        }
                        type="number"
                        value={currentQuestion.scaleMax}
                      />
                    </div>
                  ) : currentQuestion.questionType !== "open_text" ? (
                    <div className="mt-4 space-y-2">
                      {currentQuestion.options.map((currentOption) => {
                        const competencyEffect = Object.entries(currentOption.competencyEffects)[0];
                        return (
                        <div className="space-y-2 rounded-md bg-muted/30 p-2" key={currentOption.id}>
                          <div className="grid gap-2 md:grid-cols-[1fr_6rem_auto_auto]">
                            <Input
                              onChange={(event) =>
                                patchOption(currentSection.id, currentQuestion.id, currentOption.id, {
                                  text: event.target.value,
                                })
                              }
                              value={currentOption.text}
                            />
                            <Input
                              min="0"
                              onChange={(event) =>
                                patchOption(currentSection.id, currentQuestion.id, currentOption.id, {
                                  points: Number(event.target.value),
                                })
                              }
                              step="0.01"
                              type="number"
                              value={currentOption.points}
                            />
                            <label className="flex items-center gap-2 px-2 text-sm">
                              <input
                                checked={Boolean(currentOption.isCorrect)}
                                className="size-4 accent-primary"
                                onChange={(event) =>
                                  patchOption(currentSection.id, currentQuestion.id, currentOption.id, {
                                    isCorrect: event.target.checked,
                                  })
                                }
                                type="checkbox"
                              />
                              Верный
                            </label>
                            <Button
                              aria-label="Удалить вариант"
                              onClick={() =>
                                patchQuestion(currentSection.id, currentQuestion.id, {
                                  options: currentQuestion.options.filter(
                                    (entryOption) => entryOption.id !== currentOption.id,
                                  ),
                                })
                              }
                              size="sm"
                              type="button"
                              variant="ghost"
                            >
                              <Trash2 />
                            </Button>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-[1fr_8rem_1fr]">
                            <Select
                              onChange={(event) => {
                                const key = event.target.value;
                                patchOption(currentSection.id, currentQuestion.id, currentOption.id, {
                                  competencyEffects: key
                                    ? { [key]: Number(competencyEffect?.[1]) || 0 }
                                    : {},
                                });
                              }}
                              value={competencyEffect?.[0] ?? ""}
                            >
                              <option value="">Без эффекта компетенции</option>
                              {TEST_COMPETENCIES.map((competency) => (
                                <option key={competency.key} value={competency.key}>
                                  {competency.label}
                                </option>
                              ))}
                            </Select>
                            <Input
                              disabled={!competencyEffect}
                              onChange={(event) =>
                                competencyEffect
                                  ? patchOption(currentSection.id, currentQuestion.id, currentOption.id, {
                                      competencyEffects: {
                                        [competencyEffect[0]]: Number(event.target.value) || 0,
                                      },
                                    })
                                  : undefined
                              }
                              placeholder="Эффект"
                              step="0.01"
                              type="number"
                              value={competencyEffect?.[1] ?? ""}
                            />
                            <Input
                              onChange={(event) =>
                                patchOption(currentSection.id, currentQuestion.id, currentOption.id, {
                                  explanation: event.target.value,
                                })
                              }
                              placeholder="Комментарий для HR"
                              value={currentOption.explanation ?? ""}
                            />
                          </div>
                        </div>
                      )})}
                      <Button
                        onClick={() =>
                          patchQuestion(currentSection.id, currentQuestion.id, {
                            options: [...currentQuestion.options, option(`Вариант ${currentQuestion.options.length + 1}`)],
                          })
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Plus /> Добавить вариант
                      </Button>
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
                    <Select
                      onChange={(event) =>
                        patchQuestion(currentSection.id, currentQuestion.id, {
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
                    <Select
                      onChange={(event) =>
                        patchQuestion(currentSection.id, currentQuestion.id, {
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
                    <Input
                      min="0"
                      onChange={(event) =>
                        patchQuestion(currentSection.id, currentQuestion.id, {
                          points: Number(event.target.value),
                        })
                      }
                      placeholder="Макс. баллы"
                      step="0.01"
                      type="number"
                      value={currentQuestion.points}
                    />
                  </div>
                  <label className="mt-4 flex items-center gap-2 text-sm">
                    <input
                      checked={currentQuestion.isRequired}
                      className="size-4 accent-primary"
                      onChange={(event) =>
                        patchQuestion(currentSection.id, currentQuestion.id, {
                          isRequired: event.target.checked,
                        })
                      }
                      type="checkbox"
                    />
                    Обязательный вопрос
                  </label>
                </article>
              ))}

              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button
                  onClick={() =>
                    patchSection(currentSection.id, {
                      questions: [...currentSection.questions, question()],
                    })
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Plus /> Вопрос
                </Button>
                {QUESTION_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    onClick={() =>
                      patchSection(currentSection.id, {
                        questions: [
                          ...currentSection.questions,
                          question(preset.questionType, preset.text),
                        ],
                      })
                    }
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </section>
          ))}

          <div className="rounded-xl border border-dashed bg-card p-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => updateSections((current) => [...current, section()])} type="button">
                <Plus /> Добавить секцию
              </Button>
              {imports.length > 0 ? (
                <>
                  <Select className="max-w-xs" onChange={(event) => setImportId(event.target.value)} value={importId}>
                    {imports.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.title} / v{source.versionNumber}
                      </option>
                    ))}
                  </Select>
                  <Button onClick={importSections} type="button" variant="outline">
                    <FileInput /> Импортировать секции
                  </Button>
                </>
              ) : null}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Вопросы можно перетаскивать только внутри секции. Импорт добавляет копии секций в текущий черновик.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
