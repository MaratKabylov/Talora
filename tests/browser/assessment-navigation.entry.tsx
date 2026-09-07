import { createRoot } from "react-dom/client";
import { AssessmentTestFlow } from "../../components/assessment/assessment-test-flow";
import type { AssessmentSectionSnapshot, PublicFlowQuestion, SectionSavedAnswer } from "../../lib/assessment/section-contract";
import { setSectionActionHandler } from "./assessment-navigation-actions";
import type { SectionSaveRequest } from "../../lib/assessment/section-save-contract";

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
    root.render(<AssessmentTestFlow snapshot={snapshot(0)} assessmentType={assessmentType} token={token} sessionId={id(number)}
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

async function sectionScenario(assessmentType: "candidate" | "employee", allowBack: boolean, number: number) {
  const path = `/${assessmentType === "candidate" ? "assessment" : "employee-assessment"}/${token}/test/${id(number)}`;
  window.history.replaceState(null, "", `${path}?section=0`);
  const deadlineAt = new Date(Date.now() + 120_000).toISOString();
  const calls: Array<{ url: string; body: RequestBody }> = [];
  const saved: Record<string, SectionSavedAnswer> = {};
  let inFlightAutosaves = 0;
  let failBatch = true;
  let failSection = false;
  let legacySubmissions = 0;
  let heartbeatSchedules = 0;
  const originalSetInterval = window.setInterval;
  window.setInterval = ((...args: Parameters<typeof window.setInterval>) => {
    if (args[1] === 30_000) heartbeatSchedules++;
    return originalSetInterval(...args);
  }) as typeof window.setInterval;
  const question = (n: number, section: number): PublicFlowQuestion => ({
    id: id(100 + n), text: `Section question ${n}`, description: null, questionType: "open_text", orderIndex: n,
    sectionTitle: `Batch section ${section}`, incorrectFeedback: null, isRequired: true, isStructured: false,
    minSelections: 1, maxSelections: 0, scaleMin: 1, scaleMax: 5, forcedChoiceMode: null, remediationParentId: null,
    remediationQuestionId: null, options: [], matchingTargets: [],
  });
  const parent: PublicFlowQuestion = { ...question(0, 0), questionType: "single_choice", remediationQuestionId: id(102),
    options: [{ id: id(200), text: "Correct" }, { id: id(201), text: "Incorrect" }] };
  const sections = [[parent, question(1, 0), { ...question(2, 0), remediationParentId: id(100), isRequired: false }],
    [question(3, 1)], [question(4, 2)]];
  function snapshot(index: number): AssessmentSectionSnapshot {
    return { section: { id: id(300 + index), title: `Batch section ${index}`, description: null,
      contentBlocks: [], questions: sections[index] }, sectionIndex: index, reviewMode: false,
      sections: sections.map((questions, i) => ({ id: id(300 + i), title: `Batch section ${i}`, orderIndex: i,
        questionCount: questions.length, visibleQuestionCount: questions.length, incompleteQuestionCount: 1 })),
      answers: Object.fromEntries(sections[index].filter(q => saved[q.id]).map(q => [q.id, saved[q.id]])),
      questionOffset: index === 0 ? 0 : index + 2, otherVisibleQuestionCount: 2 };
  }
  const saveDraft = (questionId: string, draft: SectionSaveRequest["answers"][number]["answer"], finalized: boolean) => {
    saved[questionId] = { answerJson: {}, answerText: draft.answerText ?? null, selectedOptionId: draft.selectedOptionId ?? null,
      timeSpentSeconds: 1, remediationRequired: finalized && questionId === parent.id && draft.selectedOptionId === id(201) };
  };
  window.fetch = async (input, options) => {
    const url = String(input); const body = JSON.parse(options?.body as string);
    calls.push({ url, body });
    check(body.assessmentType === assessmentType && body.sessionId === id(number), "Batch scope/session stay fixed");
    if (url === "/api/assessment/section") {
      await sleep(60);
      return failSection ? new Response("unavailable", { status: 503 }) : Response.json(snapshot(body.sectionIndex));
    }
    if (url === "/api/assessment/section-save") {
      check(inFlightAutosaves === 0, "Every started autosave settles before section batch");
      const batch = body as SectionSaveRequest;
      await sleep(60);
      if (failBatch) return new Response("failure", { status: 503 });
      for (const answer of batch.answers) saveDraft(answer.questionId, answer.answer, true);
      const index = sections.findIndex((_value, i) => batch.sectionId === id(300 + i));
      const needsRemediation = index === 0 && saved[parent.id]?.remediationRequired && !saved[id(102)];
      return Response.json({ status: "active", deadlineAt, savedAt: new Date().toISOString(), sectionIndex: index,
        nextSectionIndex: batch.direction === "previous" ? Math.max(0, index - 1) : needsRemediation ? index : index + 1,
        needsRemediation: Boolean(needsRemediation) });
    }
    check(url === "/api/assessment/session-control", "Batch navigation does not fetch overview/page");
    if (body.operation === "autosave") {
      check(body.finalize !== true, "Section background autosave stays draft-only");
      inFlightAutosaves++;
      await sleep(180);
      saveDraft(body.questionId, body.answer, false);
      inFlightAutosaves--;
    }
    return Response.json({ status: "active", deadlineAt, savedAt: new Date().toISOString() });
  };
  setSectionActionHandler(data => {
    check(inFlightAutosaves === 0, "Terminal action waits for autosaves");
    check(data.get("sectionIndex") === "2" && data.get("direction") === "next", "Only last section uses legacy action");
    check(data.get(`q_${id(104)}_answerText`) === "Last answer", "Terminal form retains answer");
    legacySubmissions++;
  });
  const root = createRoot(host);
  const next = () => {
    const button = host.querySelector<HTMLButtonElement>('button[value="next"]');
    check(button && !button.disabled, "Section next button available"); button!.click();
  };
  try {
    root.render(<AssessmentTestFlow snapshot={snapshot(0)} assessmentType={assessmentType} token={token} sessionId={id(number)}
      initialDeadlineAt={deadlineAt} contextTitle="Synthetic batch assessment" testTitle="Batch navigation" description={null}
      instructions="Batch instructions" completedSessionCount={0} sessionCount={1}
      presentationSettings={{ presentationMode: "section", allowBack, captureQuestionTime: true }} />);
    await waitFor(() => host.querySelector("textarea"), "batch initial claim");
    check(host.textContent?.includes("Batch instructions"), "Section instructions are preserved");
    const timer = host.querySelector('p[aria-live="polite"]'); const initialTimer = timer?.textContent;
    host.querySelector<HTMLInputElement>(`input[value="${id(201)}"]`)!.click();
    textInput("Root answer");
    await waitFor(() => inFlightAutosaves > 0, "background autosave started");
    next(); next();
    await waitFor(() => host.textContent?.includes("Не удалось сохранить секцию"), "batch save error");
    check(host.querySelector("textarea")?.value === "Root answer", "Failed batch keeps section input");
    check(calls.filter(call => call.url === "/api/assessment/section-save").length === 1, "Batch double click submits once");
    check(!calls.some(call => call.url === "/api/assessment/section"), "No section read before batch acknowledgement");
    failBatch = false; failSection = true; next();
    await waitFor(() => host.textContent?.includes("Не удалось загрузить секцию"), "batch read error");
    check(window.location.search === "?section=0" && host.querySelector("textarea")?.value === "Root answer", "Read error retains URL/input");
    failSection = false; next();
    await waitFor(() => host.querySelectorAll("textarea").length === 2, "new remediation question appears");
    check(window.location.search === "?section=0", "Unanswered remediation keeps current section");
    const followup = host.querySelectorAll("textarea")[1];
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(followup, "Follow-up answer");
    followup.dispatchEvent(new Event("input", { bubbles: true }));
    next();
    await waitFor(() => host.textContent?.includes("Section question 3"), "batch next section");
    check(window.location.search === "?section=1", "Batch URL advances");
    check(host.querySelector("textarea")?.value === "", "New section starts without old draft");
    check(!host.textContent?.includes("Batch instructions"), "First-section instructions leave with section");
    window.history.back();
    if (allowBack) {
      await waitFor(() => host.textContent?.includes("Section question 1"), "batch browser back");
      check(host.querySelector("textarea")?.value === "Root answer", "Batch back restores saved input");
      window.history.forward();
      await waitFor(() => host.textContent?.includes("Section question 3"), "batch browser forward");
    } else {
      await waitFor(() => host.textContent?.includes("Возврат к предыдущим вопросам отключен"), "batch no-back guard");
      // The blocked Back replaced the previous entry with this section. Return to
      // the forward entry so the next Back still targets this test, not an older scenario.
      window.history.forward();
      await sleep(100);
    }
    textInput("Next answer");
    window.history.back();
    await waitFor(() => host.textContent?.includes("Подтвердите текущий ответ"), "batch dirty history guard");
    check(window.location.search === "?section=1", "Dirty batch restores current URL");
    next();
    await waitFor(() => host.textContent?.includes("Section question 4"), "batch last section");
    await sleep(1100);
    check(timer === host.querySelector('p[aria-live="polite"]') && timer?.textContent !== initialTimer, "Batch timer stays mounted/counts down");
    check(calls.filter(call => call.body.operation === "claim").length === 1, "Batch never re-claims session");
    check(heartbeatSchedules === 1, "Batch never reschedules heartbeat");
    check(new Set(calls.filter(call => call.body.clientId).map(call => `${call.body.clientId}:${call.body.deviceId}`)).size === 1, "Batch identity stable");
    check(performance.getEntriesByType("navigation").length === 1, "Batch does not reload document");
    textInput("Last answer"); next(); next();
    await waitFor(() => legacySubmissions === 1, "terminal action handoff");
    check(legacySubmissions === 1, "Terminal action submitted only once");
    logs.push(`PASS section ${assessmentType}, allowBack=${allowBack}: autosave drain, batch/read failures, remediation, history, timer, terminal handoff`);
  } finally { root.unmount(); setSectionActionHandler(null); window.setInterval = originalSetInterval; }
}

void (async () => {
  let number = 1;
  for (const scope of ["candidate", "employee"] as const) for (const allowBack of [true, false]) await scenario(scope, allowBack, number++);
  for (const scope of ["candidate", "employee"] as const) for (const allowBack of [true, false]) await sectionScenario(scope, allowBack, number++);
  result.textContent = `PASS: 8 browser scenarios\n${logs.join("\n")}`;
  result.dataset.status = "passed";
})().catch(error => {
  result.textContent = `FAIL: ${error instanceof Error ? error.stack : String(error)}\n${logs.join("\n")}`;
  result.dataset.status = "failed";
});
