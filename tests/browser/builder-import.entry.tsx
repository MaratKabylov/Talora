import { createRoot } from "react-dom/client";
import { BuilderImportPicker } from "../../components/tests/builder/builder-import-picker";
import { TestBuilderEditor } from "../../components/tests/builder/test-builder-editor";
import type { BuilderImportSource, BuilderQuestion, BuilderSection } from "../../lib/tests/builder-data";
import type { BuilderImportAction, BuilderImportResult } from "../../lib/tests/builder-import-contract";
import type { BuilderDocumentInput } from "../../lib/tests/builder-actions";
import { DEFAULT_TEST_PRESENTATION_SETTINGS } from "../../lib/tests/presentation-settings";

const id = (n: number) => `fd000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const host = document.getElementById("root")!;
const result = document.getElementById("result")!;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function check(value: unknown, label: string): asserts value { if (!value) throw Error(label); }
async function waitFor(fn: () => unknown, label: string) {
  for (let i = 0; i < 100; i++) { if (fn()) return; await sleep(20); }
  throw Error(`Timed out: ${label}`);
}
function button(label: string) {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === label);
  check(found, `Missing button: ${label}`); return found;
}
const sources: BuilderImportSource[] = [1, 2].map(n => ({ templateId: id(n + 10), versionId: id(n + 20),
  templateTitle: `Source ${n}`, versionNumber: n, questionCount: 2 }));
function question(n: number): BuilderQuestion {
  return { id: id(n), text: `Imported question ${n}`, competencyKey: "learning_ability", description: null,
    difficulty: "easy", incorrectFeedback: n === 40 ? "Try again" : null, isRequired: n !== 41,
    isStructured: false, matchingScoringMode: "per_pair", orderingScoringMode: "pairwise", orderIndex: n - 39,
    points: 2, questionType: "single_choice", remediationQuestionId: n === 40 ? id(41) : null,
    scaleMin: 1, scaleMax: 5, shuffleOptions: true,
    options: [1, 2].map(k => ({ id: id(n * 10 + k), text: `Option ${k}`, matchText: null, orderIndex: k,
      isCorrect: k === 1, points: k === 1 ? 2 : 0, competencyEffects: { learning_ability: 1 }, explanation: "Because" })) };
}
const sourceSections: BuilderSection[] = [{ id: id(30), title: "Imported section", description: "Description", orderIndex: 1,
  timeLimitMinutes: 3, questions: [question(40), question(41)],
  contentBlocks: [{ id: id(50), title: "Instructions", description: "Content", orderIndex: 1, positionIndex: 0 }] }];
function deferred() {
  let resolve!: (result: BuilderImportResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<BuilderImportResult>((res, rej) => { resolve = res; reject = rej; });
  return { resolve, reject, promise };
}
function selectSource(index: number) {
  const select = host.querySelector<HTMLSelectElement>("select")!;
  select.value = sources[index].versionId;
  select.dispatchEvent(new Event("change", { bubbles: true }));
}
const logs: string[] = [];
async function pickerScenario(kind: "retry" | "stale" | "unmount" | "empty" | "mismatch" | "large") {
  const root = createRoot(host); let calls = 0; let imports = 0;
  const pending: ReturnType<typeof deferred>[] = [];
  const action: BuilderImportAction = () => { calls++; const request = deferred(); pending.push(request); return request.promise; };
  root.render(<BuilderImportPicker sources={sources} templateId={id(1)} versionId={id(2)} loadAction={action}
    onImport={() => { imports++; }} />);
  await waitFor(() => host.querySelector("select"), "picker mounted");
  await sleep(40);
  check(calls === 0 && button("Импортировать секции").disabled, "No eager request/import");
  button("Загрузить источник").click(); button("Загрузить источник").click();
  await waitFor(() => calls === 1, "explicit one request");
  check(imports === 0, "Load does not mutate draft");
  if (kind === "unmount") {
    root.unmount(); pending[0].resolve({ ok: true, versionId: sources[0].versionId, sections: sourceSections });
    await sleep(40); check(imports === 0 && !host.textContent, "Late unmounted request ignored");
    logs.push(kind); return;
  }
  if (kind === "stale") {
    selectSource(1); await sleep(20);
    button("Загрузить источник").click(); await waitFor(() => calls === 2, "new selection loads");
    pending[1].resolve({ ok: true, versionId: sources[1].versionId, sections: sourceSections });
    await waitFor(() => !button("Импортировать секции").disabled, "new response ready");
    pending[0].reject(Error("late old error")); await sleep(30);
    check(!host.querySelector('[role="alert"]') && !button("Импортировать секции").disabled, "Stale response cannot overwrite selection");
  } else if (kind === "retry") {
    pending[0].resolve({ ok: false, error: "Synthetic failure" });
    await waitFor(() => host.querySelector('[role="alert"]'), "load error");
    button("Повторить загрузку").click(); await waitFor(() => calls === 2, "manual retry");
    pending[1].reject(Error("network")); await waitFor(() => host.textContent?.includes("Повторите попытку"), "network failure");
    button("Повторить загрузку").click(); await waitFor(() => calls === 3, "second retry");
    pending[2].resolve({ ok: true, versionId: sources[0].versionId, sections: sourceSections });
  } else if (kind === "mismatch") {
    pending[0].resolve({ ok: true, versionId: sources[1].versionId, sections: sourceSections });
    await waitFor(() => host.querySelector('[role="alert"]'), "wrong version rejected");
    check(button("Импортировать секции").disabled && imports === 0, "Cannot import wrong response");
    root.unmount(); logs.push(kind); return;
  } else {
    pending[0].resolve({ ok: true, versionId: sources[0].versionId,
      sections: kind === "empty" ? [] : [{ ...sourceSections[0], questions: Array.from({ length: 300 }, (_, n) => question(n + 1000)) }] });
    if (kind === "empty") {
      await waitFor(() => host.textContent?.includes("Загружено секций: 0"), "empty source");
      check(button("Импортировать секции").disabled, "Empty source cannot dirty the document");
      root.unmount(); logs.push(kind); return;
    }
  }
  await waitFor(() => !button("Импортировать секции").disabled, "loaded source");
  check(imports === 0, "Loading/retry never appends");
  const importButton = button("Импортировать секции"); importButton.click(); importButton.click();
  await waitFor(() => imports === 1, "one append");
  check(button("Импортировать секции").disabled, "Consumed source released, explicit reload required");
  root.unmount(); logs.push(kind);
}

async function editorScenario(scope: "company" | "system") {
  const root = createRoot(host); const pending = deferred(); const saves: BuilderDocumentInput[] = []; let loads = 0;
  root.render(<TestBuilderEditor imports={sources} loadImportAction={async input => {
    loads++; check(input.sourceVersionId === sources[0].versionId, "Selected version requested"); return pending.promise;
  }} initialSections={[{ id: id(60), title: "Existing section", description: null, orderIndex: 1,
    contentBlocks: [], questions: [], timeLimitMinutes: null }]} templateId={id(1)} previewPath={`/${scope}/preview`}
    version={{ id: id(2), versionNumber: 2, status: "draft", title: "v2", description: null, instructions: null,
      durationMinutes: 10, scoringType: "points", createdAt: "2026-09-08T00:00:00Z", publishedAt: null,
      presentationSettings: DEFAULT_TEST_PRESENTATION_SETTINGS }}
    saveAction={async input => { saves.push(structuredClone(input) as BuilderDocumentInput); return { ok: true, savedAt: new Date().toISOString() }; }}
    publishAction={async () => { throw Error("Unexpected publish"); }} />);
  await waitFor(() => host.querySelector("section input"), "editor mounted");
  check(loads === 0 && saves.length === 0, "Editor opening neither loads source nor saves");
  button("Загрузить источник").click(); await waitFor(() => loads === 1, "source requested");
  const titleInput = host.querySelector<HTMLInputElement>("section input")!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(titleInput, "Edited while loading");
  titleInput.dispatchEvent(new Event("input", { bubbles: true }));
  pending.resolve({ ok: true, versionId: sources[0].versionId, sections: sourceSections });
  await waitFor(() => !button("Импортировать секции").disabled, "source ready");
  check(host.querySelectorAll("section").length === 1 && titleInput.value === "Edited while loading", "Load preserved original edit");
  button("Импортировать секции").click(); await waitFor(() => host.querySelectorAll("section").length === 2, "sections appended");
  button("Сохранить").click(); await waitFor(() => saves.length > 0, "document saved");
  const document = saves.at(-1)!;
  check(document.sections[0].title === "Edited while loading", "Save retains concurrent local edit");
  const imported = document.sections[1];
  check(imported.id !== sourceSections[0].id && imported.title === sourceSections[0].title, "Section copied with new ID");
  check(imported.contentBlocks[0].id !== id(50) && imported.contentBlocks[0].description === "Content", "Content block copied");
  check(imported.questions[0].id !== id(40) && imported.questions[0].remediationQuestionId === imported.questions[1].id, "Remediation ID remapped");
  check(imported.questions[0].incorrectFeedback === "Try again" && imported.questions[1].isRequired === false, "Feedback and optional remediation preserved");
  check(imported.questions[0].options[0].id !== id(401) && imported.questions[0].options[0].points === 2, "Options copied with scoring preserved");
  check(sourceSections[0].questions[0].remediationQuestionId === id(41), "Source never mutated");
  root.unmount(); logs.push(`editor-${scope}`);
}

void (async () => {
  try {
    for (const kind of ["retry", "stale", "unmount", "empty", "mismatch", "large"] as const) await pickerScenario(kind);
    for (const scope of ["company", "system"] as const) await editorScenario(scope);
    result.dataset.status = "passed"; result.textContent = `PASS ${logs.length} builder browser scenarios\n${logs.join("\n")}`;
  } catch (error) { result.dataset.status = "failed"; result.textContent = String(error); }
})();
