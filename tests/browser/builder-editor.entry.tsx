import { createRoot } from "react-dom/client";
import { TestBuilderEditor } from "../../components/tests/builder/test-builder-editor";
import type { BuilderQuestion, BuilderSection } from "../../lib/tests/builder-data";
import type { BuilderDocumentInput } from "../../lib/tests/builder-actions";
import { DEFAULT_TEST_PRESENTATION_SETTINGS } from "../../lib/tests/presentation-settings";
import type { BuilderSaveRequest, BuilderV2PublishAction, BuilderV2SaveAction, BuilderPublishRequest, BuilderV2Result } from "../../lib/tests/builder-delta";

const id = (n: number) => `fe000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const host = document.getElementById("root")!;
const result = document.getElementById("result")!;
const baseline = new URLSearchParams(location.search).has("baseline");
const manual = new URLSearchParams(location.search).has("manual");
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function check(value: unknown, label: string): asserts value { if (!value) throw Error(label); }
async function waitFor(fn: () => unknown, label: string) {
  for (let i = 0; i < 200; i++) { if (fn()) return; await sleep(20); }
  throw Error(`Timed out: ${label}`);
}
let renders: string[] = [];
let profiles: Array<{ id: string; phase: string; actual: number }> = [];
Object.assign(globalThis, {
  __builderRenderProbe: (id: string) => renders.push(id),
  __builderProfile: (id: string, phase: string, actual: number) => profiles.push({ id, phase, actual }),
});
function question(n: number): BuilderQuestion {
  return { id: id(n), text: `Question ${n}`, competencyKey: null, description: null, difficulty: null,
    incorrectFeedback: null, isRequired: true, isStructured: false, matchingScoringMode: "per_pair",
    orderingScoringMode: "pairwise", orderIndex: n, points: 1, questionType: "single_choice",
    remediationQuestionId: null, scaleMin: 1, scaleMax: 5, shuffleOptions: false,
    options: [1, 2, 3, 4].map(k => ({ id: id(n * 10 + k), text: `Option ${n}-${k}`, matchText: null,
      orderIndex: k, isCorrect: k === 1, points: k === 1 ? 1 : 0, competencyEffects: {}, explanation: null })) };
}
function section(n: number, size: number): BuilderSection {
  return { id: id(1000 + n), title: `Section ${n}`, description: null, orderIndex: n,
    timeLimitMinutes: null, contentBlocks: [], questions: Array.from({ length: size }, (_, k) => question(n * 100 + k + 1)) };
}
function button(label: string, root: ParentNode = host) {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
  check(found, `Missing button: ${label}`); return found;
}
function inputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const saveRequests: BuilderDocumentInput[] = [];
const loadImportAction = async () => ({ ok: false as const, error: "Not used" });
const saveAction = async (input: unknown) => {
  const document = structuredClone(input) as BuilderDocumentInput;
  saveRequests.push(document);
  if (manual) {
    result.dataset.status = "saved";
    result.textContent = JSON.stringify({
      sections: document.sections.map(currentSection => ({
        id: currentSection.id,
        questionIds: currentSection.questions.map(currentQuestion => currentQuestion.id),
      })),
    });
  }
  return { ok: true, savedAt: new Date().toISOString() };
};
function mount(sections: BuilderSection[], saveV2?: { revision: string; saveAction: BuilderV2SaveAction; publishAction: BuilderV2PublishAction; returnPath: string }) {
  const root = createRoot(host);
  root.render(<TestBuilderEditor imports={[]} loadImportAction={loadImportAction} initialSections={sections}
    templateId={id(1)} previewPath="/synthetic/preview" saveAction={saveAction} saveV2={saveV2} publishAction={async () => { throw Error("Unexpected publish"); }}
    version={{ id: id(2), versionNumber: 2, status: "draft", title: "v2", description: null, instructions: null,
      durationMinutes: 10, scoringType: "points", createdAt: "2026-09-08T00:00:00Z", publishedAt: null,
      presentationSettings: DEFAULT_TEST_PRESENTATION_SETTINGS }} />);
  return root;
}
async function profileLargeEditor() {
  const root = mount([section(1, 50), section(2, 50)]);
  await waitFor(() => host.querySelectorAll("[aria-expanded]").length === 100, "100 question headers");
  const initialNodes = host.querySelectorAll("*").length;
  const initialExpanded = host.querySelectorAll('[aria-expanded="true"]').length;
  const mountMs = profiles.find(p => p.id === "TestBuilderEditor:root" && p.phase === "mount")?.actual;
  if (!baseline) check(initialExpanded === 1, "Only the first question is initially expanded");
  const collapsedButtons = [...host.querySelectorAll<HTMLButtonElement>('[aria-expanded="false"]')];
  collapsedButtons.forEach(b => b.click());
  await waitFor(() => host.querySelectorAll('[aria-expanded="true"]').length === 100, "expand all for like-for-like profiling");
  const durations: number[] = [];
  for (let n = 0; n < 10; n++) {
    renders = []; profiles = [];
    const input = [...host.querySelectorAll<HTMLInputElement>("input")].find(i => i.value.startsWith("Option 101-1"))!;
    check(input, "First option exists"); inputValue(input, `Option 101-1 edited ${n}`);
    await waitFor(() => renders.length > 0, "edit commit");
    durations.push(profiles.find(p => p.id === "TestBuilderEditor:root")?.actual ?? 0);
    if (!baseline) {
      check(renders.filter(x => x.startsWith("QuestionEditor:")).join() === `QuestionEditor:${id(101)}`, "Only edited question renders");
      check(renders.filter(x => x.startsWith("OptionEditor:")).join() === `OptionEditor:${id(1011)}`, "Only edited option renders");
      check(!renders.includes(`SectionEditor:${id(1002)}`), "Unrelated section skipped");
      check(profiles.some(p => p.id === `QuestionEditor:${id(101)}`), "React Profiler records the edited question");
    }
  }
  button("Сохранить").click(); await waitFor(() => saveRequests.length > 0, "save latest edit");
  check(saveRequests.at(-1)!.sections[0].questions[0].options[0].text === "Option 101-1 edited 9", "Latest edit serialized");
  const summary = { baseline, initialNodes, initialExpanded, mountMs, editActualMs: durations,
    lastRendered: [...renders], note: "Development React Profiler, synthetic input; not INP or staging p95" };
  root.unmount(); return summary;
}

function selectValue(select: HTMLSelectElement, value: string) {
  select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
}
function questionNode(questionId: string) {
  const node = host.querySelector<HTMLElement>(`[data-builder-question-id="${questionId}"]`);
  check(node, `Question exists: ${questionId}`); return node;
}
async function saveDocument() {
  await waitFor(() => !button("Сохранить").disabled, "save available");
  const before = saveRequests.length; button("Сохранить").click();
  await waitFor(() => saveRequests.length > before, "save document");
  await waitFor(() => !button("Сохранить").disabled, "save settled");
  return saveRequests.at(-1)!;
}
async function crudScenario() {
  const initial = section(1, 3); initial.questions[0].remediationQuestionId = initial.questions[2].id;
  initial.questions[0].incorrectFeedback = "Retry";
  const root = mount([initial, section(2, 1)]);
  await waitFor(() => host.querySelectorAll("section").length === 2, "CRUD mounted");
  const first = host.querySelector("section")!;
  const original = questionNode(id(101));
  button("Дублировать вопрос", original).click();
  await waitFor(() => first.querySelectorAll("[data-builder-question-id]").length === 4, "question copied");
  let saved = await saveDocument(); const copyId = saved.sections[0].questions[1].id;
  check(copyId !== id(101) && saved.sections[0].questions[1].remediationQuestionId === null, "Question copy has independent IDs/links");
  check(saved.sections[0].questions[1].options[0].id !== initial.questions[0].options[0].id, "Option copy ID differs");
  button("Удалить вопрос", questionNode(copyId)).click();
  await waitFor(() => first.querySelectorAll("[data-builder-question-id]").length === 3, "question deleted");
  button("Дублировать секцию", first).click();
  await waitFor(() => host.querySelectorAll("section").length === 3, "section copied");
  saved = await saveDocument();
  check(saved.sections[1].questions[0].remediationQuestionId === saved.sections[1].questions[2].id, "Section copy remaps remediation");
  button("Удалить секцию", host.querySelectorAll("section")[1]).click();
  await waitFor(() => host.querySelectorAll("section").length === 2, "section deleted");
  button("Название и описание", first).click();
  await waitFor(() => first.querySelector('[aria-label="Название блока"]'), "block created");
  const block = first.querySelector('[aria-label="Название блока"]')!.closest("article")!;
  inputValue(block.querySelector("input")!, "Block title");
  button("Дублировать блок", block).click();
  await waitFor(() => first.querySelectorAll('[aria-label="Название блока"]').length === 2, "block copied");
  button("Удалить блок", first.querySelectorAll('[aria-label="Название блока"]')[1].closest("article")!).click();
  button("Forced Choice", first).click();
  await waitFor(() => first.querySelectorAll("[data-builder-question-id]").length === 4, "preset created");
  saved = await saveDocument();
  check(saved.sections[0].contentBlocks.length === 1 && saved.sections[0].contentBlocks[0].title === "Block title", "Block edits persisted");
  check(saved.sections[0].questions[3].questionType === "forced_choice" && saved.sections[0].questions[3].options.length === 3, "Forced choice preset intact");
  button("Удалить вопрос", questionNode(id(103))).click();
  saved = await saveDocument();
  check(saved.sections[0].questions[0].remediationQuestionId === null && saved.sections[0].questions[0].incorrectFeedback === null, "Deletion clears incoming remediation");
  button("Добавить секцию").click(); await waitFor(() => host.querySelectorAll("section").length === 3, "new section");
  saved = await saveDocument(); check(saved.sections[2].questions.length === 1, "New section keeps default question");
  root.unmount(); return "create/copy/delete questions, sections, blocks and presets";
}

async function typesScenario() {
  const root = mount([section(1, 2)]); await waitFor(() => host.querySelector("[data-builder-question-id]"), "types mounted");
  const first = questionNode(id(101)); const typeSelect = first.querySelector("select")!;
  selectValue(typeSelect, "matching"); await waitFor(() => first.querySelector('[aria-label="Правильное соответствие 1"]'), "matching fields");
  inputValue(first.querySelector<HTMLInputElement>('[aria-label="Правильное соответствие 1"]')!, "Edited target");
  const option = first.querySelector<HTMLElement>('[data-builder-option-id]')!;
  renders = []; button("Переместить ниже", option).click();
  let saved = await saveDocument();
  check(saved.sections[0].questions[0].options[1].matchText === "Edited target", "Movement preserves latest option edit");
  selectValue(typeSelect, "ordering"); await waitFor(() => first.querySelector('[aria-label="Элемент 1"]'), "ordering fields");
  const orderingId = first.querySelector<HTMLElement>('[data-builder-option-id]')!.dataset.builderOptionId;
  first.querySelector<HTMLElement>('[aria-label="Перетащить элемент"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  saved = await saveDocument(); check(saved.sections[0].questions[0].options[1].id === orderingId, "Keyboard option movement");
  check(saved.sections[0].questions[0].options.every(o => o.matchText === null), "Ordering clears matching targets");
  selectValue(typeSelect, "forced_choice"); await sleep(30);
  const forcedOption = first.querySelector<HTMLElement>('[data-builder-option-id]')!;
  selectValue(forcedOption.querySelector("select")!, "learning_ability");
  saved = await saveDocument();
  check(saved.sections[0].questions[0].points === 0 && saved.sections[0].questions[0].options[0].competencyEffects.learning_ability === 1, "Forced choice effects remain editable");
  for (const type of ["scale", "open_text", "multiple_choice", "single_choice"]) {
    selectValue(typeSelect, type); await sleep(25); saved = await saveDocument();
    check(saved.sections[0].questions[0].questionType === type, `Type ${type} saved`);
  }
  const remediationToggle = first.querySelector<HTMLInputElement>('input[aria-controls$="-remediation"]')!;
  remediationToggle.click(); await waitFor(() => first.querySelector('[aria-label="Повторный вопрос после ошибки"]'), "remediation enabled");
  selectValue(first.querySelector('[aria-label="Повторный вопрос после ошибки"]')!, id(102));
  const second = questionNode(id(102)); button(second.querySelector("[aria-expanded]")!.textContent!.trim(), second).click();
  await waitFor(() => second.querySelector("textarea"), "second question expanded");
  inputValue(second.querySelector("textarea")!, "Renamed follow-up");
  await waitFor(() => first.querySelector('[aria-label="Повторный вопрос после ошибки"]')?.textContent?.includes("Renamed follow-up"), "Memo does not stale remediation labels");
  const textarea = first.querySelector<HTMLTextAreaElement>('textarea[placeholder^="Например"]')!;
  inputValue(textarea, "New feedback"); saved = await saveDocument();
  check(saved.sections[0].questions[0].remediationQuestionId === id(102) && saved.sections[0].questions[0].incorrectFeedback === "New feedback", "Remediation persisted");
  const collapse = first.querySelector<HTMLButtonElement>("[aria-expanded]")!; collapse.click(); await sleep(20); collapse.click(); await sleep(20);
  check(first.querySelector<HTMLTextAreaElement>('textarea[placeholder^="Например"]')!.value === "New feedback", "Collapse preserves controlled state");
  root.unmount(); return "all question types, latest option callbacks, keyboard options, remediation labels and collapse";
}

async function dragScenario() {
  const root = mount([section(1, 3), section(2, 1)]);
  await waitFor(() => host.querySelector("[data-builder-question-id]"), "drag mounted");
  const handle = button("Переместить вопрос", questionNode(id(101)));
  handle.focus(); handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  let saved = await saveDocument(); check(saved.sections[0].questions[1].id === id(101), "Keyboard question reorders");
  check(document.activeElement === handle, "Keyboard focus remains on moved question handle");
  const originalPoint = document.elementFromPoint;
  const setCapture = HTMLElement.prototype.setPointerCapture;
  const hasCapture = HTMLElement.prototype.hasPointerCapture;
  const releaseCapture = HTMLElement.prototype.releasePointerCapture;
  const end = host.querySelectorAll<HTMLElement>('[data-question-drop-end="true"]')[1];
  // Synthetic pointer dispatch has no native active pointer. Capture/hit testing are fixture-only.
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.hasPointerCapture = () => true;
  HTMLElement.prototype.releasePointerCapture = () => {};
  document.elementFromPoint = () => end;
  const pointer = (type: string, x: number) => handle.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId: 7, isPrimary: true, button: 0, clientX: x, clientY: 200,
  }));
  try {
    pointer("pointerdown", 10); pointer("pointermove", 40); await sleep(30);
    const before = saveRequests.length; renders = [];
    for (let n = 0; n < 25; n++) pointer("pointermove", 40 + n);
    await sleep(30);
    check(!renders.some(r => r.startsWith("SectionEditor:") || r.startsWith("QuestionEditor:")), "Repeated pointer movement over same target skips editor subtrees");
    check(saveRequests.length === before && !host.textContent?.includes("Есть несохраненные изменения"), "Pointer movement never dirties document");
    pointer("pointerup", 65); await sleep(30); saved = await saveDocument();
    check(saved.sections[0].questions.length === 2 && saved.sections[1].questions[1].id === id(101), "Pointer drop moves between sections");
  } finally {
    document.elementFromPoint = originalPoint; HTMLElement.prototype.setPointerCapture = setCapture;
    HTMLElement.prototype.hasPointerCapture = hasCapture; HTMLElement.prototype.releasePointerCapture = releaseCapture;
    root.unmount();
  }
  return "keyboard question movement, stable drag target, cross-section pointer drop";
}
const v2Ack = (revision: string): BuilderV2Result => ({ ok: true, revision, savedAt: new Date().toISOString() });
const invalidPublish: BuilderV2PublishAction = async () => ({ ok: false, code: "invalid", error: "Synthetic publication checked" });
const firstOptionInput = () => [...host.querySelectorAll<HTMLInputElement>("input")].find(i => i.value.startsWith("Option 101-1"))!;
async function v2DebounceScenario() {
  const requests: BuilderSaveRequest[] = [];
  const root = mount([section(1, 50), section(2, 50)], { revision: "7", returnPath: "/synthetic/published",
    saveAction: async input => { requests.push(structuredClone(input)); return v2Ack("8"); }, publishAction: invalidPublish });
  await waitFor(() => firstOptionInput(), "V2 mounted");
  inputValue(firstOptionInput(), "Option 101-1 first"); await sleep(700);
  inputValue(firstOptionInput(), "Option 101-1 latest"); await sleep(1500);
  check(requests.length === 0, "Debounce restarts after last input, not first");
  await waitFor(() => requests.length === 1, "debounced V2 save");
  const patch = requests[0].delta;
  check(patch.options.length === 1 && patch.questions.length === 0 && patch.sections.length === 0 && patch.version === null, "100-question document sends one option");
  check(patch.options[0].text === "Option 101-1 latest", "Latest option is saved");
  await waitFor(() => host.textContent?.includes("Все изменения сохранены"), "V2 ACK");
  root.unmount(); return "V2 2s trailing debounce + sparse payload for 100 questions";
}
async function v2PublishFlushScenario() {
  const saved: BuilderSaveRequest[] = [], published: BuilderPublishRequest[] = [];
  let release!: (value: BuilderV2Result) => void;
  const pending = new Promise<BuilderV2Result>(resolve => { release = resolve; });
  const root = mount([section(1, 2)], { revision: "7", returnPath: "/synthetic/published",
    saveAction: async input => { saved.push(input); return pending; },
    publishAction: async input => { published.push(input); return invalidPublish(input); } });
  await waitFor(() => firstOptionInput(), "publish mounted"); inputValue(firstOptionInput(), "Option 101-1 flush");
  button("Опубликовать").click(); await waitFor(() => saved.length === 1, "flush started");
  check(published.length === 0 && host.querySelector("fieldset")?.disabled, "Publish waits for ACK and locks editor");
  release(v2Ack("8")); await waitFor(() => published.length === 1, "publish after flush");
  check(published[0].expectedRevision === "8", "Publishes confirmed revision");
  check(saved[0].delta.options[0].text === "Option 101-1 flush", "Pending edit flushed before publish");
  await waitFor(() => host.textContent?.includes("Synthetic publication checked"), "validation error visible");
  check(!host.querySelector("fieldset")?.disabled, "Validation error permits correction");
  root.unmount(); return "V2 publish flush + editor lock + validation recovery";
}
async function v2ConflictScenario() {
  const requests: BuilderSaveRequest[] = [];
  const root = mount([section(1, 1)], { revision: "7", returnPath: "/synthetic/published",
    saveAction: async input => { requests.push(input); return { ok: false, code: "conflict", error: "Synthetic revision conflict" }; }, publishAction: invalidPublish });
  await waitFor(() => firstOptionInput(), "conflict mounted"); inputValue(firstOptionInput(), "Option 101-1 local recovery");
  button("Сохранить").click(); await waitFor(() => host.textContent?.includes("Synthetic revision conflict"), "conflict visible");
  check(requests.length === 1 && button("Сохранить").disabled && button("Опубликовать").disabled, "Conflict freezes writes");
  check(firstOptionInput().value === "Option 101-1 local recovery", "Conflict retains local edit");
  let exported: Blob | null = null;
  const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL, click = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = blob => { exported = blob as Blob; return "blob:synthetic"; };
  URL.revokeObjectURL = () => {}; HTMLAnchorElement.prototype.click = () => {};
  try {
    button("Скачать локальные изменения").click();
    check(exported, "Recovery export created");
    const recovery = JSON.parse(await (exported as Blob).text());
    check(recovery.document.sections[0].questions[0].options[0].text === "Option 101-1 local recovery", "Recovery contains latest local value");
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    check(unload.defaultPrevented, "Unsaved changes protect closing/reloading");
  } finally { URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl; HTMLAnchorElement.prototype.click = click; root.unmount(); }
  return "V2 conflict preserves local document + recovery export + beforeunload";
}
async function v2LostPublishScenario() {
  const publications: BuilderPublishRequest[] = [];
  const root = mount([section(1, 1)], { revision: "7", returnPath: "/synthetic/published",
    saveAction: async () => { throw Error("Unexpected save"); }, publishAction: async input => {
      publications.push(structuredClone(input)); if (publications.length === 1) throw Error("Lost publication ACK"); return invalidPublish(input);
    } });
  await waitFor(() => firstOptionInput(), "lost publish mounted"); button("Опубликовать").click();
  await waitFor(() => host.textContent?.includes("Нет подтверждения публикации"), "lost publish feedback");
  check(host.querySelector("fieldset")?.disabled, "Unknown publication outcome freezes edits");
  button("Повторить публикацию").click(); await waitFor(() => publications.length === 2, "publish retry");
  check(JSON.stringify(publications[0]) === JSON.stringify(publications[1]), "Publish retry preserves exact identity and revision");
  await waitFor(() => host.textContent?.includes("Synthetic publication checked"), "retry settled");
  root.unmount(); return "V2 lost publish ACK retains request identity and freezes edits";
}
void (async () => {
  try {
    if (manual) {
      mount([section(1, 3), section(2, 1)]);
      await waitFor(() => host.querySelectorAll("[data-builder-question-id]").length === 4, "manual fixture mounted");
      result.dataset.status = "ready";
      result.textContent = "READY: drag question 101 to the end of section 1 and save";
      return;
    }
    const summary = await profileLargeEditor();
    const scenarios = baseline ? [] : [await crudScenario(), await typesScenario(), await dragScenario(),
      await v2DebounceScenario(), await v2PublishFlushScenario(), await v2ConflictScenario(), await v2LostPublishScenario()];
    result.dataset.status = "passed"; result.textContent = JSON.stringify({ ...summary, scenarios });
  } catch (error) { result.dataset.status = "failed"; result.textContent = String(error); }
})();
