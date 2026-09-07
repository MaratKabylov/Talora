import assert from "node:assert/strict";
import test from "node:test";
import { SectionPrefetchCache } from "../lib/assessment/section-prefetch.ts";
import { reconcilePrefetchedSection, type PrefetchedSection, type SectionNavigationState } from "../lib/assessment/section-prefetch-contract.ts";
import { fetchAssessmentSection } from "../lib/assessment/section-navigation.ts";
import type { PublicFlowQuestion } from "../lib/assessment/section-contract.ts";

const input = { assessmentType: "candidate" as const, token: "a".repeat(64), sessionId: "session", sectionIndex: 0 };
const question: PublicFlowQuestion = { id: "question", text: "Next text", description: null, sectionTitle: "Next", questionType: "ordering",
  orderIndex: 0, isStructured: true, isRequired: true, incorrectFeedback: null, remediationParentId: null, remediationQuestionId: null,
  minSelections: 1, maxSelections: 0, scaleMin: 1, scaleMax: 5, forcedChoiceMode: null,
  options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], matchingTargets: [] };
const content: PrefetchedSection = { versionId: "version", sectionIndex: 1,
  section: { id: "next", title: "Next", description: null, contentBlocks: [], questions: [question] } };
const answer = { answerJson: { orderedOptionIds: ["b", "a"] }, answerText: null, selectedOptionId: null, timeSpentSeconds: 8, remediationRequired: true };
const state: SectionNavigationState = { kind: "state", versionId: "version", sectionId: "next", sectionIndex: 1, reviewMode: false,
  sections: ["first", "next", "last"].map((id, orderIndex) => ({ id, title: id, orderIndex,
    questionCount: 1, visibleQuestionCount: 1, incompleteQuestionCount: 1 })),
  answers: { question: answer, outside: answer }, feedbacks: { question: "Fresh feedback" } };

test("prefetch merge uses only live answers/progress/feedback and preserves immutable cached content", () => {
  const before = JSON.stringify(content);
  const result = reconcilePrefetchedSection(content, state);
  assert.deepEqual(Object.keys(result.answers), ["question"]);
  assert.deepEqual(result.section!.questions[0].options.map(option => option.id), ["b", "a"]);
  assert.equal(result.section!.questions[0].incorrectFeedback, "Fresh feedback");
  assert.equal(result.questionOffset, 1); assert.equal(result.otherVisibleQuestionCount, 2);
  const fresh = reconcilePrefetchedSection(content, { ...state, answers: {}, sections: state.sections.map(s => ({ ...s, visibleQuestionCount: 2 })) });
  assert.deepEqual(fresh.answers, {}); assert.equal(fresh.questionOffset, 2); assert.equal(fresh.otherVisibleQuestionCount, 4);
  assert.equal(fresh.section!.questions[0].incorrectFeedback, null);
  assert.deepEqual(fresh.section!.questions[0].options, question.options);
  for (const orderedOptionIds of [["a", "a"], ["foreign", "a"], ["a"], [1, 2]]) {
    const invalid = reconcilePrefetchedSection(content, { ...state, answers: { question: { ...answer, answerJson: { orderedOptionIds } } } });
    assert.deepEqual(invalid.section!.questions[0].options, question.options);
  }
  assert.equal(JSON.stringify(content), before);
  for (const change of [{ versionId: "other" }, { sectionId: "other" }, { sectionIndex: 0 }, { sections: [] }]) {
    assert.throws(() => reconcilePrefetchedSection(content, { ...state, ...change }), /подтвердить секцию/);
  }
});

test("cache is one-entry, scoped to controller/token/session/source/target and expires in five minutes", async () => {
  let now = 0;
  const calls: RequestInit[] = [];
  const cache = new SectionPrefetchCache(async (url, init) => {
    assert.equal(url, "/api/assessment/section-prefetch"); calls.push(init!); return Response.json(content);
  }, () => now);
  await cache.start(input);
  assert.deepEqual(cache.ready(input, 1), content);
  assert.equal(calls[0].method, "POST"); assert.equal(calls[0].cache, "no-store");
  assert.deepEqual(JSON.parse(String(calls[0].body)), input);
  for (const change of [{ assessmentType: "employee" as const }, { token: "other" }, { sessionId: "other" }, { sectionIndex: 1 }]) {
    assert.equal(cache.ready({ ...input, ...change }, 1), undefined);
  }
  assert.equal(cache.ready(input, 2), undefined);
  assert.equal(new SectionPrefetchCache().ready(input, 1), undefined);
  now = 300_000; assert.equal(cache.ready(input, 1), undefined);
  await cache.start(input); cache.clear(); assert.equal(cache.ready(input, 1), undefined);
  await cache.start(input); await cache.start({ ...input, token: "other" });
  assert.equal(cache.ready(input, 1), undefined); assert.deepEqual(cache.ready({ ...input, token: "other" }, 1), content);
});

test("prefetch errors, empty/oversized/malformed data remain cache misses without retries", async () => {
  for (const response of [() => Response.json(null), () => new Response("invalid"), () => new Response("failure", { status: 503 }),
    () => Response.json({ ...content, sectionIndex: 9 }), () => Response.json({ ...content, padding: "Ж".repeat(600_000) }),
    () => new Response("{}", { headers: { "content-length": "1048577" } }), () => { throw Error("offline"); }]) {
    let count = 0;
    const cache = new SectionPrefetchCache(async () => { count++; return response(); });
    await cache.start(input); assert.equal(cache.ready(input, 1), undefined); assert.equal(count, 1);
  }
});

test("in-flight speculative reads never block navigation and stale completions cannot refill cleared cache", async () => {
  let finish!: (response: Response) => void; let signal!: AbortSignal;
  const cache = new SectionPrefetchCache(async (_url, init) => { signal = init!.signal!; return new Promise(resolve => { finish = resolve; }); });
  const pending = cache.start(input);
  assert.equal(cache.ready(input, 1), undefined);
  cache.abortPending(); assert.equal(signal.aborted, true);
  finish(Response.json(content)); await pending;
  assert.equal(cache.ready(input, 1), undefined);
  const next = cache.start(input); cache.clear(); finish(Response.json(content)); await next;
  assert.equal(cache.ready(input, 1), undefined);
});

test("cache hits send only identity hints and still require successful fresh state, with full-read rollback", async (t) => {
  const request = { ...input, sectionIndex: 1, review: false };
  const signal = new AbortController().signal;
  let response: unknown = state; let status = 200; let count = 0;
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    count++; assert.deepEqual(JSON.parse(String(init.body)), { ...request, cached: { sectionId: "next", versionId: "version" } });
    return Response.json(response, { status });
  });
  assert.deepEqual(await fetchAssessmentSection(request, signal, content), reconcilePrefetchedSection(content, state));
  status = 410; await assert.rejects(fetchAssessmentSection(request, signal, content), /недоступен/);
  status = 500; await assert.rejects(fetchAssessmentSection(request, signal, content), /Не удалось загрузить/);
  status = 200; response = { ...state, versionId: "changed" };
  await assert.rejects(fetchAssessmentSection(request, signal, content), /подтвердить секцию/);
  response = { sectionIndex: 0, answers: {} }; // V2 flag rollback or V3 canonical mismatch.
  assert.deepEqual(await fetchAssessmentSection(request, signal, content), response);
  assert.equal(count, 5);
});
