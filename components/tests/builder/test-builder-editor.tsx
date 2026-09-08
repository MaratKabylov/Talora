"use client";

import { Eye, Plus, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Select } from "@/components/ui/select";
import { reportClientOperation } from "@/lib/observability/client-performance";
import {
  publishTestVersionAction as defaultPublishTestVersionAction,
} from "@/lib/tests/actions";
import {
  saveBuilderDocumentAction as defaultSaveBuilderDocumentAction,
  type BuilderDocumentInput,
  type BuilderSaveResult,
} from "@/lib/tests/builder-actions";
import type {
  BuilderImportSource,
  BuilderSection,
} from "@/lib/tests/builder-data";
import type { TestVersion } from "@/lib/tests/data";
import { formatTestVersionTitle } from "@/lib/tests/version-title";
import type { BuilderImportAction } from "@/lib/tests/builder-import-contract";
import { BuilderImportPicker } from "./builder-import-picker";
import { copySection, editableSections, nullableText, section } from "./builder-document";
import { useBuilderActions } from "./use-builder-actions";
import { useQuestionDrag } from "./use-question-drag";
import { SectionEditor } from "./section-editor";

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export function TestBuilderEditor({
  imports,
  loadImportAction,
  initialSections,
  publishAction = defaultPublishTestVersionAction,
  saveAction = defaultSaveBuilderDocumentAction,
  templateId,
  previewPath,
  version: initialVersion,
}: {
  imports: BuilderImportSource[];
  loadImportAction: BuilderImportAction;
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
    presentationSettings: initialVersion.presentationSettings,
    scoringType: initialVersion.scoringType,
  });
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [feedback, setFeedback] = useState("");
  const revision = useRef(0);
  const savedRevision = useRef(0);
  const sectionsRef = useRef(sections);
  const versionRef = useRef(version);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const markChanged = useCallback(() => {
    revision.current += 1;
    setStatus("dirty");
    setFeedback("");
  }, []);

  const updateSections = useCallback(
    (update: (current: BuilderSection[]) => BuilderSection[]) => {
      const nextSections = update(sectionsRef.current);
      if (nextSections === sectionsRef.current) return;
      sectionsRef.current = nextSections;
      setSections(nextSections);
      markChanged();
    },
    [markChanged],
  );

  const actions = useBuilderActions(updateSections);
  const drag = useQuestionDrag(actions.moveQuestion);
  const [initialExpandedQuestionId] = useState(() => initialSections.flatMap(section => section.questions)[0]?.id);

  const updateVersion = (
    field: "description" | "durationMinutes" | "instructions",
    value: string,
  ) => {
    const nextVersion = { ...versionRef.current, [field]: value };
    versionRef.current = nextVersion;
    setVersion(nextVersion);
    markChanged();
  };

  const updatePresentationSettings = (
    patch: Partial<TestVersion["presentationSettings"]>,
  ) => {
    const nextVersion = {
      ...versionRef.current,
      presentationSettings: {
        ...versionRef.current.presentationSettings,
        ...patch,
      },
    };
    versionRef.current = nextVersion;
    setVersion(nextVersion);
    markChanged();
  };

  const saveOnce = useCallback(async () => {
    if (saveInFlight.current) return saveInFlight.current;

    const requestedRevision = revision.current;
    const currentSections = sectionsRef.current;
    const currentVersion = versionRef.current;
    setStatus("saving");
    const input: BuilderDocumentInput = {
      sections: currentSections.map((currentSection) => ({
        contentBlocks: currentSection.contentBlocks.map((block, orderIndex) => ({
          ...block,
          description: nullableText(block.description ?? ""),
          orderIndex: orderIndex + 1,
          positionIndex: Math.min(
            Math.max(block.positionIndex, 0),
            currentSection.questions.length,
          ),
        })),
        description: nullableText(currentSection.description ?? ""),
        id: currentSection.id,
        questions: currentSection.questions.map((currentQuestion) => ({
          competencyKey: currentQuestion.competencyKey,
          description: nullableText(currentQuestion.description ?? ""),
          difficulty: currentQuestion.difficulty,
          id: currentQuestion.id,
          incorrectFeedback: nullableText(currentQuestion.incorrectFeedback ?? ""),
          isRequired: currentQuestion.isRequired,
          isStructured: currentQuestion.isStructured,
          options: currentQuestion.options.map((currentOption) => ({
            competencyEffects: currentOption.competencyEffects,
            explanation: nullableText(currentOption.explanation ?? ""),
            id: currentOption.id,
            isCorrect: Boolean(currentOption.isCorrect),
            matchText: nullableText(currentOption.matchText ?? ""),
            points: Number(currentOption.points) || 0,
            text: currentOption.text,
          })),
          points: Number(currentQuestion.points) || 0,
          questionType: currentQuestion.questionType,
          matchingScoringMode: currentQuestion.matchingScoringMode,
          orderingScoringMode: currentQuestion.orderingScoringMode,
          remediationQuestionId: currentQuestion.remediationQuestionId,
          scaleMax: Number(currentQuestion.scaleMax) || 5,
          scaleMin: Number(currentQuestion.scaleMin) || 1,
          shuffleOptions: currentQuestion.shuffleOptions,
          text: currentQuestion.text,
        })),
        timeLimitMinutes: currentSection.timeLimitMinutes,
        title: currentSection.title,
      })),
      templateId,
      version: {
        description: nullableText(currentVersion.description),
        durationMinutes: currentVersion.durationMinutes ? Number(currentVersion.durationMinutes) : null,
        instructions: nullableText(currentVersion.instructions),
        presentationSettings: currentVersion.presentationSettings,
        scoringType: currentVersion.scoringType,
        title: versionTitle,
      },
      versionId: initialVersion.id,
    };

    const request = (async () => {
      const startedAt = performance.now();
      try {
        const result = await saveAction(input);
        if (!result.ok) {
          reportClientOperation("builder.autosave", performance.now() - startedAt, "failure");
          setStatus("error");
          setFeedback(result.error ?? "Не удалось сохранить изменения.");
          return false;
        }

        reportClientOperation("builder.autosave", performance.now() - startedAt, "success");
        savedRevision.current = requestedRevision;
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
      } catch {
        reportClientOperation("builder.autosave", performance.now() - startedAt, "failure");
        setStatus("error");
        setFeedback("Не удалось сохранить изменения. Проверьте соединение и повторите попытку.");
        return false;
      }
    })();

    saveInFlight.current = request;
    void request.finally(() => {
      if (saveInFlight.current === request) {
        saveInFlight.current = null;
      }
    });
    return request;
  }, [initialVersion.id, saveAction, templateId, versionTitle]);

  const save = useCallback(async () => {
    while (savedRevision.current < revision.current) {
      if (!(await saveOnce())) return false;
    }
    return true;
  }, [saveOnce]);

  useEffect(() => {
    if (status !== "dirty") return;
    const timer = window.setTimeout(() => void save(), 1200);
    return () => window.clearTimeout(timer);
  }, [save, status]);

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
                  const nextVersion = {
                    ...versionRef.current,
                    scoringType: event.target.value as TestVersion["scoringType"],
                  };
                  versionRef.current = nextVersion;
                  setVersion(nextVersion);
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
            <div className="mt-4 space-y-4 rounded-lg border bg-muted/20 p-4">
              <div className="space-y-2">
                <Label htmlFor="builder-presentation-mode">Показывать вопросы</Label>
                <Select
                  id="builder-presentation-mode"
                  onChange={(event) =>
                    updatePresentationSettings({
                      presentationMode: event.target.value as TestVersion["presentationSettings"]["presentationMode"],
                    })
                  }
                  value={version.presentationSettings.presentationMode}
                >
                  <option value="section">Все вопросы секции</option>
                  <option value="one_question">По одному вопросу</option>
                </Select>
              </div>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  checked={version.presentationSettings.captureQuestionTime}
                  className="mt-0.5 size-4 accent-primary"
                  onChange={(event) =>
                    updatePresentationSettings({ captureQuestionTime: event.target.checked })
                  }
                  type="checkbox"
                />
                <span>Записывать время ответа на каждый вопрос</span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  checked={version.presentationSettings.allowBack}
                  className="mt-0.5 size-4 accent-primary"
                  onChange={(event) =>
                    updatePresentationSettings({ allowBack: event.target.checked })
                  }
                  type="checkbox"
                />
                <span>Разрешать возврат к предыдущим вопросам</span>
              </label>
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
            <SectionEditor key={currentSection.id} currentSection={currentSection} sectionIndex={sectionIndex}
              sectionCount={sections.length} initialExpandedQuestionId={initialExpandedQuestionId}
              actions={actions} dragHandlers={drag.handlers} draggingQuestionId={drag.draggingQuestionId}
              dropIndex={drag.questionDropTarget?.sectionId === currentSection.id ? drag.questionDropTarget.index : null} />
          ))}

          <div className="rounded-xl border border-dashed bg-card p-4">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => updateSections((current) => [...current, section()])} type="button">
                <Plus /> Добавить секцию
              </Button>
              <BuilderImportPicker
                key={`${templateId}:${initialVersion.id}`}
                sources={imports} templateId={templateId} versionId={initialVersion.id}
                loadAction={loadImportAction}
                onImport={sourceSections => updateSections(current => [...current, ...sourceSections.map(copySection)])}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Сверните вопросы и перетаскивайте их за ручку внутри секции или между секциями. Импорт добавляет копии секций в текущий черновик.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
