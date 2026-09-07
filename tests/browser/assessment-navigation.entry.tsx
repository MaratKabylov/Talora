import { createRoot } from "react-dom/client";
import { OneQuestionTestFlow } from "../../components/assessment/one-question-test-flow";
import type { AssessmentSectionSnapshot, PublicFlowQuestion, SectionSavedAnswer } from "../../lib/assessment/section-contract";

const id = (n: number) => `f8000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = "a".repeat(64);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function check(value: unknown, message: string) { if (!value) throw Error(message); }
async function waitFor(checkValue: () => unknown, label: string) {
  for (let i = 0; i < 100; i++) { if (checkValue()) return; await sleep(30); }
  throw Error(`Timed out: ${label}`);
}
const host = document.getElementById("root")!;
const result = document.getElementById("result")!;
const logs: string[] = [];
function textInput(value: string) {
  const input = host.querySelector("textarea")!;
  check(input, "Question textarea exists");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function submit() {
  const button = host.querySelector<HTMLButtonElement>('button[type="submit"]');
  check(button && !button.disabled, "Submit is available"); button!.click();
}
type RequestBody = { operation?: string; assessmentType: string; clientId?: string; deviceId?: string;
  sessionId: string; questionId?: string; answer?: { answerText?: string }; sectionIndex?: number; review?: boolean; finalize?: boolean };

async function scenario(assessmentType: "candidate" | "employee", allowBack: boolean, number: number) {
  const path = `/${assessmentType === "candidate" ? "assessment" : "employee-assessment"}/${token}/test/${id(number)}`;
  window.history.replaceState(null, "", `${path}?section=0`);
  const saved: Record<string, SectionSavedAnswer> = {};
  const calls: Array<{ url: string; body: RequestBody }> = [];
  let failSave = true;
  let failSection = false;
  let aborted = 0;
  let sectionDelay = 70;
  let heartbeatSchedules = 0;
  const originalSetInterval = window.setInterval;
  window.setInterval = ((...args: Parameters<typeof window.setInterval>) => {
    if (args[1] === 30_000) heartbeatSchedules++;
    return originalSetInterval(...args);
  }) as typeof window.setInterval;
  const deadlineAt = new Date(Date.now() + 120_000).toISOString();
  const questions: PublicFlowQuestion[] = [0, 1, 2].map(index => ({
    id: id(20 + index), text: `Question ${index + 1}`, description: null, questionType: "open_text",
    orderIndex: 0, sectionTitle: `Section ${index + 1}`, incorrectFeedback: null, isRequired: true,
    isStructured: false, minSelections: 1, maxSelections: 0, scaleMin: 1, scaleMax: 5,
    forcedChoiceMode: null, remediationParentId: null, remediationQuestionId: null, options: [], matchingTargets: [],
  }));
  function snapshot(requested: number, reviewMode = false): AssessmentSectionSnapshot {
    const firstIncomplete = questions.findIndex(question => !saved[question.id]);
    const sectionIndex = reviewMode && allowBack ? requested : firstIncomplete < 0 ? requested : firstIncomplete;
    const question = questions[sectionIndex];
    return { section: { id: id(30 + sectionIndex), title: `Section ${sectionIndex + 1}`, description: null,
      contentBlocks: [], questions: [question] },
      sections: questions.map((entry, index) => ({ id: id(30 + index), title: `Section ${index + 1}`, orderIndex: index,
        questionCount: 1, visibleQuestionCount: 1, incompleteQuestionCount: saved[entry.id] ? 0 : 1 })),
      answers: saved[question.id] ? { [question.id]: saved[question.id] } : {},
      sectionIndex, reviewMode: reviewMode && allowBack, questionOffset: sectionIndex, otherVisibleQuestionCount: 2 };
  }
  window.fetch = async (input, options) => {
    const url = String(input);
    const body = JSON.parse(options?.body as string) as RequestBody;
    calls.push({ url, body });
    check(body.assessmentType === assessmentType && body.sessionId === id(number), "Scope/session never change");
    if (url === "/api/assessment/section") {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, sectionDelay);
        options?.signal?.addEventListener("abort", () => { clearTimeout(timer); aborted++; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
      return failSection ? new Response("unavailable", { status: 503 })
        : Response.json(snapshot(body.sectionIndex!, body.review));
    }
    check(url === "/api/assessment/session-control", "No full page/overview fetch during navigation");
    if (body.operation === "autosave") {
      check(body.finalize === true, "One-question saves are explicit finalizations only");
      await sleep(40);
      if (failSave) return Response.json({ error: "Synthetic save failure" }, { status: 503 });
      saved[body.questionId!] = { answerJson: {}, answerText: body.answer?.answerText ?? null,
        selectedOptionId: null, remediationRequired: false, timeSpentSeconds: 1 };
    }
    check(body.operation !== "complete", "Do not complete while another section remains");
    return Response.json({ status: "active", deadlineAt, savedAt: new Date().toISOString() });
  };
  const root = createRoot(host);
  try {
    root.render(<OneQuestionTestFlow snapshot={snapshot(0)} assessmentType={assessmentType} token={token} sessionId={id(number)}
      initialDeadlineAt={deadlineAt} contextTitle="Synthetic assessment" testTitle="Navigation test" description={null}
      instructions={null} completedSessionCount={0} sessionCount={1}
      presentationSettings={{ presentationMode: "one_question", allowBack, captureQuestionTime: true }} />);
    await waitFor(() => host.querySelector("textarea"), "initial claim and question");
    check(calls.filter(call => call.body.operation === "claim").length === 1, "Exactly one initial claim");
    const controlPanel = host.querySelector('p[aria-live="polite"]');
    const initialTimer = controlPanel?.textContent;
    textInput("First persisted answer");
    await sleep(30);
    submit();
    await waitFor(() => host.textContent?.includes("Synthetic save failure"), "save error");
    check(host.querySelector("textarea")?.value === "First persisted answer", "Failed save retains input");
    check(calls.every(call => call.url !== "/api/assessment/section"), "No navigation before save acknowledgement");
    failSave = false;
    failSection = true;
    submit();
    await waitFor(() => host.textContent?.includes("Не удалось загрузить секцию"), "section error");
    check(host.querySelector("textarea")?.value === "First persisted answer", "Failed navigation retains input");
    check(window.location.search === "?section=0", "Failed navigation retains URL");
    failSection = false;
    const saveCount = calls.filter(call => call.body.operation === "autosave").length;
    const button = host.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.click(); button.click();
    await waitFor(() => host.textContent?.includes("Question 2"), "next section");
    check(calls.filter(call => call.body.operation === "autosave").length === saveCount + 1, "Double click submits once");
    check(window.location.search === "?section=1", "Successful transition updates URL");
    check(host.textContent?.includes("секция 2 из 3"), "Header progress updates");
    check(host.querySelector("textarea")?.value === "", "Other section does not reuse old draft");
    await sleep(1100);
    check(controlPanel === host.querySelector('p[aria-live="polite"]'), "Timer DOM stays mounted");
    check(initialTimer !== controlPanel?.textContent, "Countdown continues instead of restarting");
    check(calls.filter(call => call.body.operation === "claim").length === 1, "No re-claim on section transition");
    window.history.back();
    if (allowBack) {
      await waitFor(() => host.textContent?.includes("Question 1"), "browser back");
      check(host.querySelector("textarea")?.value === "First persisted answer", "Back restores saved answer");
      window.history.forward();
      await waitFor(() => host.textContent?.includes("Question 2"), "browser forward");
      textInput("Unsaved second answer");
      window.history.back();
      await waitFor(() => host.textContent?.includes("Подтвердите текущий ответ"), "unsaved history guard");
      check(window.location.search === "?section=1", "Blocked history restores canonical URL");
      check(host.querySelector("textarea")?.value === "Unsaved second answer", "Blocked history retains draft");
    } else {
      await waitFor(() => host.textContent?.includes("Возврат к предыдущим вопросам отключен"), "no-back history guard");
      check(window.location.search === "?section=1", "No-back history restores current URL");
      check(host.textContent?.includes("Question 2"), "No-back history does not expose prior question");
      textInput("Second answer");
    }
    const identities = calls.filter(call => call.body.clientId).map(call => `${call.body.clientId}:${call.body.deviceId}`);
    check(new Set(identities).size === 1, "Client/device identity stays stable");
    check(heartbeatSchedules === 1, "Section/history transitions never restart the heartbeat interval");
    check(performance.getEntriesByType("navigation").length === 1, "One document navigation only");
    sectionDelay = 800;
    submit();
    await waitFor(() => host.textContent?.includes("Загружаем секцию"), "in-flight transition");
    root.unmount();
    await sleep(50);
    check(aborted === 1, "Unmount aborts in-flight section read");
    logs.push(`PASS ${assessmentType}, allowBack=${allowBack}: save errors, load errors, double click, history, timer/identity, abort`);
    result.textContent = logs.join("\n");
  } finally { root.unmount(); window.setInterval = originalSetInterval; }
}

void (async () => {
  let number = 1;
  for (const scope of ["candidate", "employee"] as const) for (const allowBack of [true, false]) await scenario(scope, allowBack, number++);
  result.textContent = `PASS: 4 browser scenarios\n${logs.join("\n")}`;
  result.dataset.status = "passed";
})().catch(error => {
  result.textContent = `FAIL: ${error instanceof Error ? error.stack : String(error)}\n${logs.join("\n")}`;
  result.dataset.status = "failed";
});
