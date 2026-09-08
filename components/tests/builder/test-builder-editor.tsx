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
import { copySection, editableSections, section } from "./builder-document";
import { serializeBuilderDocument } from "@/lib/tests/builder-serialize";
import { createBuilderSaveController } from "@/lib/tests/builder-save-controller";
import type { BuilderPublishRequest, BuilderV2PublishAction, BuilderV2SaveAction } from "@/lib/tests/builder-delta";
import { useBuilderActions } from "./use-builder-actions";
import { useQuestionDrag } from "./use-question-drag";
import { SectionEditor } from "./section-editor";

type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error" | "conflict";

export function TestBuilderEditor({
  imports,
  loadImportAction,
  initialSections,
  publishAction = defaultPublishTestVersionAction,
  saveAction = defaultSaveBuilderDocumentAction,
  saveV2,
  templateId,
  previewPath,
  version: initialVersion,
}: {
  imports: BuilderImportSource[];
  loadImportAction: BuilderImportAction;
  initialSections: BuilderSection[];
  publishAction?: (formData: FormData) => Promise<void>;
  saveAction?: (input: unknown) => Promise<BuilderSaveResult>;
  saveV2?: { revision: string; saveAction: BuilderV2SaveAction; publishAction: BuilderV2PublishAction; returnPath: string };
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
  const [editSequence, setEditSequence] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [publicationUncertain, setPublicationUncertain] = useState(false);
  const publicationPending = useRef<BuilderPublishRequest | null>(null);
  const publicationInFlight = useRef(false);
  const [controller] = useState(() => saveV2 ? createBuilderSaveController({
    initial: serializeBuilderDocument(sections, version, templateId, initialVersion.id, versionTitle),
    revision: saveV2.revision,
    save: async input => {
      const startedAt = performance.now();
      try {
        const result = await saveV2.saveAction(input);
        reportClientOperation("builder.autosave", performance.now() - startedAt, result.ok ? "success" : "failure");
        return result;
      } catch (error) {
        reportClientOperation("builder.autosave", performance.now() - startedAt, "failure");
        throw error;
      }
    },
    onState: state => { setStatus(state.status); setFeedback(state.message); },
  }) : null);
  const markChanged = useCallback(() => {
    revision.current += 1;
    setEditSequence(value => value + 1);
    if (controller) controller.changed();
    else { setStatus("dirty"); setFeedback(""); }
  }, [controller]);
  useEffect(() => {
    controller?.resume();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (controller?.hasUnsaved() || publicationPending.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { controller?.dispose(); window.removeEventListener("beforeunload", beforeUnload); };
  }, [controller]);

  const updateSections = useCallback(
    (update: (current: BuilderSection[]) => BuilderSection[]) => {
      if (publicationInFlight.current || publicationPending.current) return;
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
    const input = serializeBuilderDocument(currentSections, currentVersion, templateId, initialVersion.id, versionTitle);

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
    if (controller) return controller.flush(() => serializeBuilderDocument(sectionsRef.current, versionRef.current, templateId, initialVersion.id, versionTitle));
    while (savedRevision.current < revision.current) {
      if (!(await saveOnce())) return false;
    }
    return true;
  }, [controller, initialVersion.id, saveOnce, templateId, versionTitle]);

  useEffect(() => {
    if (status !== "dirty" || publishing || publicationPending.current) return;
    const timer = window.setTimeout(() => void save(), controller ? 2000 : 1200);
    return () => window.clearTimeout(timer);
  }, [controller, editSequence, publishing, save, status]);

  function downloadLocalChanges() {
    const document = serializeBuilderDocument(sectionsRef.current, versionRef.current, templateId, initialVersion.id, versionTitle);
    const url = URL.createObjectURL(new Blob([JSON.stringify({ schemaVersion: "talvia.builder.recovery.v1",
      revision: controller?.revision(), document }, null, 2)], { type: "application/json" }));
    const link = window.document.createElement("a"); link.href = url; link.download = `builder-local-${initialVersion.id}.json`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function publishV2() {
    if (!saveV2 || !controller || publicationInFlight.current) return;
    publicationInFlight.current = true; setPublishing(true);
    try {
      if (!publicationPending.current) {
        if (!(await save())) return;
        publicationPending.current = { templateId, versionId: initialVersion.id,
          expectedRevision: controller.revision(), requestId: crypto.randomUUID() };
        setPublicationUncertain(true);
      }
      const result = await saveV2.publishAction(publicationPending.current);
      if (result.ok) {
        publicationPending.current = null;
        setPublicationUncertain(false);
        window.location.assign(saveV2.returnPath); return;
      }
      if (result.code === "invalid" || result.code === "conflict") {
        publicationPending.current = null; setPublicationUncertain(false);
      }
      setStatus(result.code === "conflict" ? "conflict" : "error");
      setFeedback(result.error);
    } catch {
      setStatus("error"); setFeedback("Нет подтверждения публикации. Повторите публикацию; локальные данные сохранены в редакторе.");
    } finally { publicationInFlight.current = false; setPublishing(false); }
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
          <p aria-live="polite" className={status === "error" || status === "conflict" ? "text-destructive" : "text-muted-foreground"}>
            {status === "saving"
              ? "Сохраняем..."
              : status === "dirty"
                ? "Есть несохраненные изменения"
                : feedback || "Автосохранение включено"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={status === "saving" || publishing || publicationUncertain || status === "conflict"} onClick={() => void openPreview()} type="button" variant="outline">
            <Eye /> Предпросмотр
          </Button>
          <Button disabled={status === "saving" || publishing || publicationUncertain || status === "conflict"} onClick={() => void save()} type="button" variant="outline">
            <Save /> Сохранить
          </Button>
          {saveV2 ? <>
            <Button type="button" variant="outline" onClick={downloadLocalChanges}>Скачать локальные изменения</Button>
            <Button type="button" disabled={publishing || status === "conflict"} onClick={() => void publishV2()}>
              {publishing ? "Публикуем…" : publicationUncertain ? "Повторить публикацию" : "Опубликовать"}
            </Button>
          </> : <form action={publishAction}>
            <input name="templateId" type="hidden" value={templateId} />
            <input name="versionId" type="hidden" value={initialVersion.id} />
            <Button
              disabled={status === "dirty" || status === "saving" || status === "error"}
              type="submit"
            >
              Опубликовать
            </Button>
          </form>}
        </div>
      </div>

      <fieldset disabled={publishing || publicationUncertain || status === "conflict"}
        inert={publishing || publicationUncertain || status === "conflict"} className="min-w-0">
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

      </fieldset>
    </div>
  );
}
