import { createRoot } from "react-dom/client";
import { AssessmentTestFlow } from "../../components/assessment/assessment-test-flow";
import type { AssessmentSectionSnapshot, PublicFlowQuestion, SectionSavedAnswer } from "../../lib/assessment/section-contract";
import { setSectionActionHandler } from "./assessment-navigation-actions";
import { routerTransitions } from "./assessment-navigation-router";
import { AssessmentCompletionRecovery } from "../../components/assessment/completion-recovery";
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
  sessionId: string; questionId?: string; answer?: { answerText?: string }; sectionIndex?: number; review?: boolean; finalize?: boolean;
  cached?: { sectionId: string; versionId: string } };

function transitionResponse(snapshot: AssessmentSectionSnapshot, cached: RequestBody["cached"]) {
  if (!cached || cached.sectionId !== snapshot.section?.id || cached.versionId !== id(900)) return Response.json(snapshot);
  return Response.json({ kind: "state", versionId: id(900), sectionId: snapshot.section.id, sectionIndex: snapshot.sectionIndex,
    sections: snapshot.sections, answers: snapshot.answers, feedbacks: {}, reviewMode: snapshot.reviewMode });
}

async function scenario(assessmentType: "candidate" | "employee", allowBack: boolean, number: number, prefetch = false) {
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
    if (url === "/api/assessment/section-prefetch") {
      check(prefetch, "Prefetch disabled means no speculative requests");
      const index = body.sectionIndex! + 1;
      return Response.json({ versionId: id(900), sectionIndex: index, section: { id: id(30 + index),
        title: `Section ${index + 1}`, description: null, contentBlocks: [], questions: [questions[index]] } });
    }
    if (url === "/api/assessment/section") {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, sectionDelay);
        options?.signal?.addEventListener("abort", () => { clearTimeout(timer); aborted++; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
      });
      return failSection ? new Response("unavailable", { status: 503 })
        : transitionResponse(snapshot(body.sectionIndex!, body.review), body.cached);
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
      instructions={null} completedSessionCount={0} sessionCount={1} sectionPrefetchEnabled={prefetch}
      presentationSettings={{ presentationMode: "one_question", allowBack, captureQuestionTime: true }} />);
    await waitFor(() => host.querySelector("textarea"), "initial claim and question");
    if (prefetch) {
      await waitFor(() => calls.some(call => call.url === "/api/assessment/section-prefetch"), "static lookahead");
      await sleep(30);
      check(!host.textContent?.includes("Question 2"), "Prefetch never displays next content before save/state ACK");
    }
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
    if (prefetch) check(calls.some(call => call.url === "/api/assessment/section" && call.body.cached?.sectionId === id(31)), "Forward transition revalidates cached identity");
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
    logs.push(`PASS ${assessmentType}, allowBack=${allowBack}, prefetch=${prefetch}: save/load errors, double click, history, timer/identity, abort`);
    result.textContent = logs.join("\n");
  } finally { root.unmount(); window.setInterval = originalSetInterval; }
}

async function sectionScenario(assessmentType: "candidate" | "employee", allowBack: boolean, number: number, prefetch = false) {
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
    if (url === "/api/assessment/section-prefetch") {
      check(prefetch, "Section prefetch gated");
      const index = body.sectionIndex + 1;
      return Response.json({ versionId: id(900), sectionIndex: index, section: snapshot(index).section });
    }
    if (url === "/api/assessment/section") {
      await sleep(60);
      return failSection ? new Response("unavailable", { status: 503 }) : transitionResponse(snapshot(body.sectionIndex), body.cached);
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
      instructions="Batch instructions" completedSessionCount={0} sessionCount={1} sectionPrefetchEnabled={prefetch}
      presentationSettings={{ presentationMode: "section", allowBack, captureQuestionTime: true }} />);
    await waitFor(() => host.querySelector("textarea"), "batch initial claim");
    if (prefetch) {
      await waitFor(() => calls.some(call => call.url === "/api/assessment/section-prefetch"), "batch static lookahead");
      await sleep(30);
      check(!host.textContent?.includes("Section question 3"), "Batch preview not displayed before ACK");
    }
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
    if (prefetch) {
      const prefetchCount = calls.filter(call => call.url === "/api/assessment/section-prefetch").length;
      await waitFor(() => calls.filter(call => call.url === "/api/assessment/section-prefetch").length > prefetchCount, "fresh lookahead after remediation refresh");
      await sleep(30);
    }
    const followup = host.querySelectorAll("textarea")[1];
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(followup, "Follow-up answer");
    followup.dispatchEvent(new Event("input", { bubbles: true }));
    next();
    await waitFor(() => host.textContent?.includes("Section question 3"), "batch next section");
    check(window.location.search === "?section=1", "Batch URL advances");
    check(host.querySelector("textarea")?.value === "", "New section starts without old draft");
    if (prefetch) check(calls.some(call => call.url === "/api/assessment/section" && call.body.cached?.sectionId === id(301)), "Batch transition validates cached next section");
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
    logs.push(`PASS section ${assessmentType}, allowBack=${allowBack}, prefetch=${prefetch}: autosave drain, batch/read failures, remediation, history, timer, terminal handoff`);
  } finally { root.unmount(); setSectionActionHandler(null); window.setInterval = originalSetInterval; }
}

async function completionScenario(assessmentType: "candidate" | "employee", mode: "one_question" | "section" | "empty", last: boolean, number: number) {
  const path = `/${assessmentType === "candidate" ? "assessment" : "employee-assessment"}/${token}`;
  window.history.replaceState(null, "", `${path}/test/${id(number)}`);
  routerTransitions.length = 0;
  const deadlineAt = new Date(Date.now() + 120_000).toISOString();
  const question: PublicFlowQuestion = { id: id(801), text: "Final question", description: null, sectionTitle: "Last", questionType: "open_text",
    orderIndex: 0, isRequired: true, isStructured: false, incorrectFeedback: null, remediationParentId: null, remediationQuestionId: null,
    options: [], matchingTargets: [], minSelections: 1, maxSelections: 0, scaleMin: 1, scaleMax: 5, forcedChoiceMode: null };
  const snapshot: AssessmentSectionSnapshot = { section: mode === "empty" ? null : { id: id(802), title: "Last", description: null, contentBlocks: [], questions: [question] },
    sections: mode === "empty" ? [] : [{ id: id(802), title: "Last", orderIndex: 0, questionCount: 1, visibleQuestionCount: 1, incompleteQuestionCount: 1 }],
    sectionIndex: 0, reviewMode: false, answers: {}, questionOffset: 0, otherVisibleQuestionCount: 0 };
  let saved = mode === "empty"; let writes = 0; let completes = 0; let controlCalls = 0;
  const heartbeats: Array<() => void> = [];
  const originalSetInterval = window.setInterval;
  window.setInterval = ((...args: Parameters<typeof window.setInterval>) => {
    const callback = args[0]; if (args[1] === 30_000 && typeof callback === "function") heartbeats.push(() => callback());
    return originalSetInterval(...args);
  }) as typeof window.setInterval;
  const destination = last ? `${path}/complete` : `${path}/test/${id(number + 1000)}`;
  window.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body));
    check(body.assessmentType === assessmentType && body.sessionId === id(number), "Completion scope/session stable");
    if (url === "/api/assessment/complete") {
      completes++;
      check(saved, "Completion must follow acknowledged save"); check(!body.answers && !body.answer, "Completion carries no answers");
      await sleep(60);
      if (completes === 1) return new Response("synthetic failure after SQL commit", { status: 503 });
      if (completes === 2) return Response.json({ status: "processing" });
      return Response.json({ status: "redirect", redirectTo: destination });
    }
    if (url === "/api/assessment/section-save") {
      check(mode === "section", "Only section mode batches"); writes++; saved = true;
      return Response.json({ status: "active", deadlineAt, savedAt: new Date().toISOString(), sectionIndex: 0, nextSectionIndex: 0, needsRemediation: false });
    }
    check(url === "/api/assessment/session-control", "No full read, legacy action or overview on completion");
    controlCalls++;
    check(body.operation !== "complete", "V2 never uses legacy completion");
    if (body.operation === "autosave") { check(mode === "one_question" && body.finalize === true, "Expected finalized save"); writes++; saved = true; }
    return Response.json({ status: "active", deadlineAt, savedAt: new Date().toISOString() });
  };
  const root = createRoot(host);
  try {
    root.render(<AssessmentTestFlow snapshot={snapshot} assessmentType={assessmentType} token={token} sessionId={id(number)}
      initialDeadlineAt={deadlineAt} contextTitle="Synthetic completion" testTitle="Finish" description={null} instructions={null}
      completedSessionCount={0} sessionCount={last ? 1 : 2} completionEnabled
      presentationSettings={{ presentationMode: mode === "empty" ? "section" : mode, allowBack: true, captureQuestionTime: true }} />);
    await waitFor(() => host.querySelector('button[type="submit"]'), "completion claim");
    if (mode !== "empty") textInput("Final saved answer");
    submit(); submit();
    await waitFor(() => host.textContent?.includes("Не удалось завершить тест"), "completion transport error");
    check(completes === 1 && routerTransitions.length === 0, "Double click finishes once and does not navigate on error");
    check(writes === (mode === "empty" ? 0 : 1), "No duplicate last-answer batch");
    if (mode !== "empty") check(host.querySelector("textarea")?.value === "Final saved answer", "Failed completion preserves visible saved input");
    const beforeControl = controlCalls;
    window.dispatchEvent(new Event("online")); for (const heartbeat of heartbeats) heartbeat(); await sleep(40);
    check(controlCalls === beforeControl, "No heartbeat/autosave redirects race with pending completion");
    const retry = () => { const button = Array.from(host.querySelectorAll("button")).find(b => b.textContent === "Повторить завершение")!; check(button && !button.disabled, "Retry available"); button.click(); };
    retry(); await waitFor(() => routerTransitions.length === 1, "automatic scoring poll and soft terminal router transition");
    check(routerTransitions[0] === destination, "Server destination is used");
    check(writes === (mode === "empty" ? 0 : 1) && completes === 3, "Polling only repeats completion, not answers");
    check(performance.getEntriesByType("navigation").length === 1, "No document navigation");
    logs.push(`PASS completion ${assessmentType}, ${mode}, last=${last}: ACK, retry + automatic scoring poll, no duplicate writes, router replace`);
  } finally { root.unmount(); window.setInterval = originalSetInterval; }
}

async function recoveryScenario(assessmentType: "candidate" | "employee", number: number) {
  routerTransitions.length = 0; let calls = 0;
  window.fetch = async (_url, options) => {
    calls++; const body = JSON.parse(String(options?.body)); check(body.assessmentType === assessmentType && body.sessionId === id(number), "Recovery is scoped");
    return calls === 1 ? Response.json({ status: "processing" }) : Response.json({ status: "redirect",
      redirectTo: `/${assessmentType === "employee" ? "employee-assessment" : "assessment"}/${token}/complete` });
  };
  const root = createRoot(host);
  try {
    root.render(<AssessmentCompletionRecovery assessmentType={assessmentType} token={token} sessionId={id(number)} />);
    await waitFor(() => host.querySelector("button"), "recovery screen"); check(calls === 0, "Recovery never runs scoring during render");
    host.querySelector("button")!.click(); host.querySelector("button")!.click();
    await waitFor(() => routerTransitions.length === 1, "automatic recovery poll and redirect");
    check(calls === 2, "Recovery double click is guarded and polling is bounded");
    logs.push(`PASS recovery ${assessmentType}: explicit POST, automatic pending poll, no claim/answer writes`);
  } finally { root.unmount(); }
}

void (async () => {
  let number = 1;
  for (const prefetch of [false, true]) {
    for (const scope of ["candidate", "employee"] as const) for (const allowBack of [true, false]) await scenario(scope, allowBack, number++, prefetch);
    for (const scope of ["candidate", "employee"] as const) for (const allowBack of [true, false]) await sectionScenario(scope, allowBack, number++, prefetch);
  }
  for (const scope of ["candidate", "employee"] as const) {
    for (const mode of ["one_question", "section", "empty"] as const) for (const last of [false, true]) await completionScenario(scope, mode, last, number++);
    await recoveryScenario(scope, number++);
  }
  result.textContent = `PASS: 30 browser scenarios\n${logs.join("\n")}`;
  result.dataset.status = "passed";
})().catch(error => {
  result.textContent = `FAIL: ${error instanceof Error ? error.stack : String(error)}\n${logs.join("\n")}`;
  result.dataset.status = "failed";
});
