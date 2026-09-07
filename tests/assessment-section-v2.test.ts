import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { compileFunction } from "node:vm";
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import * as richText from "../lib/rich-text.ts";
import * as contentBlocks from "../lib/tests/content-blocks.ts";
import * as shuffle from "../lib/answers/option-shuffle.ts";
import * as structured from "../lib/structured-questions.ts";
import * as presentation from "../lib/tests/presentation-settings.ts";
import * as contract from "../lib/assessment/section-contract.ts";
import { reconcilePrefetchedSection } from "../lib/assessment/section-prefetch-contract.ts";
import type { ActiveAssessment, AssessmentQuestionPageData } from "../lib/assessment/data.ts";

const id = (n: number) => `f5000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = "a".repeat(64);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
function load<T>(path: string, dependencies: Record<string, unknown>, flag = "true"): T {
  const { outputText } = transpileModule(read(path), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX } });
  const exports = {};
  compileFunction(outputText, ["exports", "require", "process"])(exports, (specifier: string) => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency ${specifier}`);
    return dependencies[specifier];
  }, { env: { ASSESSMENT_SECTION_READ_V2: flag } });
  return exports as T;
}
const richTextServer = load<typeof import("../lib/rich-text.server.ts")>("../lib/rich-text.server.ts", {
  "server-only": {}, "sanitize-html": { __esModule: true, default: sanitizeHtml }, "@/lib/rich-text": richText,
});
const legacyOverviewReader = load<typeof import("../lib/assessment/test-overview.ts")>("../lib/assessment/test-overview.ts", {
  "server-only": {}, zod: { z }, "@/lib/rich-text.server": richTextServer,
  "@/lib/supabase/admin": { createAdminClient: () => { throw Error("Legacy overview must not call RPC"); } },
  "@/lib/observability/server-performance": {}, "@/lib/tests/presentation-settings": presentation,
});
function readerHarness(result: unknown = null, flag = "true", fail = false) {
  const calls: unknown[][] = [];
  const reader = load<typeof import("../lib/assessment/section-data.ts")>("../lib/assessment/section-data.ts", {
    "server-only": {}, zod: { z }, "@/lib/rich-text.server": richTextServer,
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (...args: unknown[]) => {
      calls.push(args); return { data: result, error: fail ? { message: `secret ${token}` } : null };
    } }) },
    "@/lib/observability/server-performance": { measureServerOperation: (_name: string, task: () => unknown) => task() },
    "@/lib/tests/content-blocks": contentBlocks, "@/lib/answers/option-shuffle": shuffle,
    "@/lib/structured-questions": structured, "./section-contract": contract,
  }, flag);
  return { ...reader, calls };
}
const request = { assessmentType: "candidate" as const, sessionId: id(7), token,
  presentationSettings: presentation.DEFAULT_TEST_PRESENTATION_SETTINGS };

function prefetchHarness(result: unknown = null, fail = false) {
  const calls: unknown[][] = [];
  const reader = load<typeof import("../lib/assessment/section-prefetch-data.ts")>("../lib/assessment/section-prefetch-data.ts", {
    "server-only": {}, zod: { z }, "./section-contract": contract, "./section-data": readerHarness(),
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (...args: unknown[]) => {
      calls.push(args); return { data: result, error: fail ? { message: `SQL ${token}` } : null };
    } }) },
    "@/lib/observability/server-performance": { measureServerOperation: (_name: string, task: () => unknown) => task() },
  });
  return { ...reader, calls };
}

function rawSectionFixture() {
  const options = [30, 31, 32].map((n, index) => ({ id: id(n), text: `option-${n}`, order_index: index,
    match_target_id: id(n + 10), match_text: `target-${n}`, is_correct: n === 30, points: 5 }));
  return { sections: [{ id: id(10), title: "First", orderIndex: 0, questionCount: 4, visibleQuestionCount: 3, incompleteQuestionCount: 2 }],
    sectionIndex: 0, reviewMode: false,
    section: { id: id(10), title: "First", description: null, settings_json: {}, questions: [
      { id: id(20), text: "Choice", description: null, order_index: 0, question_type: "single_choice",
        settings_json: { shuffleOptions: true, remediationQuestionId: id(21), incorrectFeedback: "hint", points: 100 }, answer_options: options },
      { id: id(21), text: "Retry", description: null, order_index: 1, question_type: "open_text", settings_json: {}, answer_options: [] },
      { id: id(22), text: "Order", description: null, order_index: 2, question_type: "ordering", settings_json: { structuredResponseVersion: 1, orderingScoringMode: "exact" }, answer_options: options },
      { id: id(23), text: "Match", description: null, order_index: 3, question_type: "matching", settings_json: { structuredResponseVersion: 1, matchingScoringMode: "per_pair" }, answer_options: options },
    ] },
    answers: { [id(20)]: { answerJson: { points: 99, correctOptionIds: [id(30)] }, answerText: null,
      selectedOptionId: id(31), timeSpentSeconds: 2, remediationRequired: true },
      [id(90)]: { answerJson: {}, answerText: "OTHER SECTION PRIVATE ANSWER", selectedOptionId: null, timeSpentSeconds: null, remediationRequired: false } },
  };
}

test("section presenter hides scoring fields, option-target associations and out-of-section answers", () => {
  const { presentAssessmentSection } = readerHarness();
  const result = presentAssessmentSection(rawSectionFixture(), id(7));
  assert.deepEqual(Object.keys(result.answers), [id(20)]);
  assert.deepEqual(result.answers[id(20)].answerJson, {});
  assert.equal(result.answers[id(20)].remediationRequired, true);
  assert.equal(result.section!.questions[0].incorrectFeedback, "hint");
  assert.equal(result.section!.questions[1].remediationParentId, id(20));
  const serialized = JSON.stringify(result);
  for (const key of ["is_correct", "isCorrect", "points", "correctOptionIds", "match_target_id", "matchingScoringMode", "orderingScoringMode", "settings_json", "OTHER SECTION PRIVATE ANSWER"]) {
    assert.ok(!serialized.includes(key), key);
  }
  assert.ok(result.section!.questions.every(question => question.options.every(option => Object.keys(option).sort().join() === "id,text")));
});

test("section presenter preserves V1 deterministic shuffle and restores saved ordering", async () => {
  const raw = rawSectionFixture();
  const records = raw.section.questions;
  const answers = Object.entries(raw.answers).map(([question_id, answer]) => ({ question_id, answer_json: answer.answerJson,
    answer_text: answer.answerText, selected_option_id: answer.selectedOptionId, time_spent_seconds: answer.timeSpentSeconds,
    is_correct: answer.remediationRequired ? false : null }));
  // Execute the REAL legacy reader/presenter with only the Supabase transport stubbed.
  const legacy = load<typeof import("../lib/assessment/data.ts")>("../lib/assessment/data.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => ({ from: (table: string) => ({ select: () => ({ eq: async () => ({ error: null,
      data: table === "test_sections" ? [{ ...raw.section, order_index: 0 }] : answers }) }) }) }) },
    "@/lib/observability/server-performance": { measureServerOperation: (_name: string, task: () => unknown) => task() },
    "@/lib/rich-text.server": richTextServer, "@/lib/answers/option-shuffle": shuffle,
    "@/lib/tests/content-blocks": contentBlocks, "@/lib/tests/presentation-settings": presentation, "@/lib/structured-questions": structured,
  });
  const assessment = { availability: "active", sessions: [{ id: id(7), test: { versionId: id(3) } }] } as ActiveAssessment;
  const original = await legacy.getAssessmentQuestionPageData(token, id(7), assessment);
  const { presentAssessmentSection } = readerHarness();
  const result = presentAssessmentSection(raw, id(7));
  for (const question of result.section!.questions) {
    const previous = original!.questions.find(entry => entry.id === question.id)!;
    assert.deepEqual(question.options, previous.options);
    assert.deepEqual(question.matchingTargets, previous.matchingTargets);
  }
  const restored = structured.createDeterministicShuffledIds(records[2].answer_options.map(option => option.id), "saved-order");
  const withSaved = { ...raw, answers: { ...raw.answers, [id(22)]: { answerJson: { orderedOptionIds: restored }, answerText: null,
    selectedOptionId: null, timeSpentSeconds: 8, remediationRequired: false } } };
  assert.deepEqual(presentAssessmentSection(withSaved, id(7)).section!.questions[2].options.map(option => option.id), restored);
});

test("section rich text and content blocks retain server-side sanitization", () => {
  const raw = rawSectionFixture();
  const dangerous = `${richText.RICH_TEXT_PREFIX}<p onclick="steal()">Readable</p><script>steal()</script>`;
  const payload = { ...raw, section: { ...raw.section, description: dangerous,
    settings_json: { contentBlocks: [{ id: id(70), title: "Instruction", description: dangerous, orderIndex: 0, positionIndex: 0 }] },
    questions: raw.section.questions.map(question => ({ ...question, description: dangerous })),
  } };
  const result = readerHarness().presentAssessmentSection(payload, id(7));
  assert.equal(result.section?.contentBlocks.length, 1);
  const json = JSON.stringify(result);
  assert.ok(json.includes("Readable"));
  assert.ok(!json.includes("steal"));
  assert.ok(!json.includes("onclick"));
});

test("both real test pages use the section reader and pass only its bounded DTO to the client", async () => {
  const require = createRequire(import.meta.url);
  const jsxRuntime = require("react/jsx-runtime");
  const sectionSnapshot = readerHarness().presentAssessmentSection(rawSectionFixture(), id(7));
  const Session = () => null;
  const Unavailable = () => null;
  type Element = { type: unknown; props?: Record<string, unknown>; key?: string };
  const findSession = (node: unknown): Element | undefined => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.map(findSession).find(Boolean);
    const element = node as Element;
    if (element.type === Session) return element;
    return findSession(element.props?.children);
  };
  for (const scope of ["candidate", "employee"] as const) {
    let fullReads = 0; let scopedReads = 0;
    let status = "in_progress";
    const overview = () => ({ availability: "active", consentGivenAt: "2026-09-06T00:00:00Z", companyName: "Company",
      candidate: { email: "private@example.invalid" }, job: { title: "Job" }, assessment: { title: "Assessment" },
      sessions: [{ id: id(7), status, deadlineAt: null, test: { title: "Test", description: null, instructions: null,
        presentationSettings: presentation.DEFAULT_TEST_PRESENTATION_SETTINGS } }] });
    const page = load<{ default: (props: unknown) => Promise<Element> }>(
      scope === "candidate" ? "../app/assessment/[token]/test/[sessionId]/page.tsx" : "../app/employee-assessment/[token]/test/[sessionId]/page.tsx", {
        "react/jsx-runtime": jsxRuntime,
        "next/navigation": { redirect: (path: string) => { throw Error(`redirect:${path}`); } },
        "@/components/assessment/assessment-shell": { AssessmentShell: () => null, AssessmentUnavailable: Unavailable },
        "@/components/assessment/candidate-test-session": { AssessmentTestSession: Session },
        "@/components/assessment/test-taking-guard": { TestTakingGuard: () => null },
        "@/components/feedback-message": { FeedbackMessage: () => null }, "@/components/ui/rich-text-content": { RichTextContent: () => null },
        "@/lib/assessment/data": { getAssessmentByToken: overview, getAssessmentQuestionPageData: () => { fullReads++; throw Error("Must not read full content"); } },
        "@/lib/employee-assessments/public-data": { getEmployeeAssessmentByToken: overview, getEmployeeAssessmentQuestionPageData: () => { fullReads++; throw Error("Must not read full content"); } },
        "@/lib/assessment/section-data": { getAssessmentSectionSnapshot: (input: { assessmentType: string; requestedIndex: string }) => {
          assert.equal(input.assessmentType, scope); assert.equal(input.requestedIndex, "0"); scopedReads++; return sectionSnapshot;
        } },
        "@/lib/assessment/test-overview": legacyOverviewReader,
    "@/components/assessment/assessment-test-flow": { AssessmentTestFlow: () => null },
      });
    const props = { params: Promise.resolve({ token, sessionId: id(7) }), searchParams: Promise.resolve({ section: "0" }) };
    const element = await page.default(props);
    const session = findSession(element);
    assert.ok(session);
    assert.deepEqual(session.props?.answers, sectionSnapshot.answers);
    assert.deepEqual(session.props?.section, sectionSnapshot.section);
    assert.ok(!JSON.stringify(session.props).includes("private@example.invalid"));
    assert.equal(scopedReads, 1); assert.equal(fullReads, 0);
    status = "completed";
    await assert.rejects(page.default(props), /redirect:.*\/complete/);
    assert.equal(scopedReads, 1); // Terminal pages no longer load question content.
  }
});

test("section reader uses one RPC, supports both scopes, and fails closed without legacy fallback", async () => {
  for (const assessmentType of ["candidate", "employee"] as const) {
    const harness = readerHarness(rawSectionFixture());
    const result = await harness.getAssessmentSectionSnapshot({ ...request, assessmentType, requestedIndex: "2", review: "1" }, async () => { throw Error("Must not load full content"); });
    assert.equal(result?.section?.id, id(10));
    assert.deepEqual(harness.calls, [["read_assessment_section_v2", { p_scope: assessmentType, p_token: token,
      p_session_id: id(7), p_section_index: 2, p_review: true }]]);
  }
  for (const [raw, fail] of [[{}, false], [null, true]] as const) {
    const harness = readerHarness(raw, "true", fail);
    await assert.rejects(harness.getAssessmentSectionSnapshot(request, async () => { throw Error("No fallback"); }), error => !String(error).includes(token));
    assert.equal(harness.calls.length, 1);
  }
  const invalid = readerHarness();
  assert.equal(await invalid.getAssessmentSectionSnapshot({ ...request, sessionId: "invalid" }, async () => null), null);
  assert.deepEqual(invalid.calls, []);
  assert.equal(await readerHarness(null).getAssessmentSectionSnapshot(request, async () => null), null);
});

test("flag-off projection keeps legacy selection but sends only the selected section answers", async () => {
  const raw = rawSectionFixture();
  const mapped = readerHarness().presentAssessmentSection(raw, id(7));
  const section = mapped.section!;
  const legacyData = { sections: [{ ...section, questions: section.questions.map(question => ({ ...question, matchingScoringMode: "per_pair", orderingScoringMode: "pairwise" })) },
    { ...section, id: id(11), questions: [{ ...section.questions[1], id: id(90), remediationParentId: null, matchingScoringMode: "per_pair", orderingScoringMode: "pairwise" }] }],
    answers: { [id(20)]: { ...mapped.answers[id(20)], isCorrect: false }, [id(90)]: { ...mapped.answers[id(20)], answerText: "private other answer", isCorrect: null } },
  } as unknown as AssessmentQuestionPageData;
  const off = readerHarness(null, "false");
  const result = await off.getAssessmentSectionSnapshot(request, async () => legacyData);
  assert.deepEqual(off.calls, []);
  assert.deepEqual(Object.keys(result!.answers), [id(20)]);
  assert.ok(!JSON.stringify(result).includes("private other answer"));
  assert.ok(!JSON.stringify(result).includes('"isCorrect"'));
  assert.equal(result!.otherVisibleQuestionCount, 1);
  for (const value of [undefined, "-1", "NaN", "1.2", "Infinity"]) assert.equal(contract.requestedSectionIndex(value), 0);
});

test("prefetch presenters retain sanitization/shuffle but exclude premature answers, feedback and scoring", async () => {
  const raw = rawSectionFixture();
  const reader = prefetchHarness();
  const content = reader.presentPrefetchedSection({ kind: "content", versionId: id(3), sectionIndex: 1,
    section: raw.section, answers: raw.answers }, id(7));
  const empty = readerHarness().presentAssessmentSection({ ...raw, answers: {} }, id(7));
  assert.deepEqual(content.section, empty.section);
  const serialized = JSON.stringify(content);
  for (const value of ["hint", "points", "is_correct", "match_target_id", "correctOptionIds", "answers", "orderingScoringMode", "matchingScoringMode"]) {
    assert.ok(!serialized.includes(value), value);
  }
  const rawState = { kind: "state", versionId: id(3), sectionId: id(10),
    sectionIndex: 0, reviewMode: false, sections: raw.sections, answers: {
      [id(20)]: { ...raw.answers[id(20)], questionType: "single_choice", isStructured: false, incorrectFeedback: "hint", isCorrect: false },
      [id(22)]: { answerJson: { orderedOptionIds: [id(32), id(31), id(30)], points: 100, correctOptionIds: [id(30)] },
        answerText: null, selectedOptionId: null, timeSpentSeconds: 5, remediationRequired: false,
        questionType: "ordering", isStructured: true, incorrectFeedback: "MUST NOT EXPOSE" },
    } };
  const state = reader.presentSectionNavigationState(rawState);
  assert.deepEqual(state.answers[id(20)].answerJson, {});
  assert.deepEqual(state.answers[id(22)].answerJson, { orderedOptionIds: [id(32), id(31), id(30)] });
  assert.deepEqual(state.feedbacks, { [id(20)]: "hint" });
  assert.ok(!JSON.stringify(state).includes("isCorrect"));
  assert.ok(!JSON.stringify(state).includes("questionType"));
  for (const assessmentType of ["candidate", "employee"] as const) {
    const harness = prefetchHarness(null);
    assert.equal(await harness.prefetchAssessmentSection({ ...request, assessmentType, sectionIndex: 0 }), null);
    assert.deepEqual(harness.calls, [["read_assessment_section_navigation_v3", { p_scope: assessmentType, p_token: token,
      p_session_id: id(7), p_section_index: 0, p_review: false, p_mode: "prefetch", p_cached_section_id: null, p_cached_version_id: null }]]);
  }
  for (const result of [{ kind: "full", snapshot: raw }, rawState]) {
    const harness = prefetchHarness(result);
    const expected = "snapshot" in result ? readerHarness().presentAssessmentSection(raw, id(7)) : state;
    assert.deepEqual(await harness.readAssessmentSectionTransition({ ...request, sectionIndex: 0 }, { sectionId: id(10), versionId: id(3) }), expected);
    assert.equal(harness.calls.length, 1);
  }
  await assert.rejects(prefetchHarness(rawState).readAssessmentSectionTransition({ ...request, sectionIndex: 0 }, { sectionId: id(11), versionId: id(3) }));
  await assert.rejects(prefetchHarness(null, true).prefetchAssessmentSection({ ...request, sectionIndex: 0 }), error => !String(error).includes(token));
  await assert.rejects(prefetchHarness({}).prefetchAssessmentSection({ ...request, sectionIndex: 0 }));
});

test("section RPC bounds payload size and enforces scoped read-only access in PostgreSQL", async (t) => {
  const db = new PGlite();
  try {
    for (const path of ["./fixtures/session-control-v2.sql", "./fixtures/assessment-answer-v2.sql", "./fixtures/assessment-section-v2.sql",
      "../supabase/migrations/20260811120000_assessment_integrity_controls.sql",
      "../supabase/migrations/20260827170000_employee_assessment_integrity_controls.sql",
      "../supabase/migrations/20260906140000_assessment_section_read_v2.sql",
      "../supabase/migrations/20260907170000_assessment_section_prefetch_v3.sql"]) await db.exec(read(path));
    for (const scope of ["candidate", "employee"] as const) {
      const employee = scope === "employee";
      const sessions = employee ? "employee_assessment_sessions" : "test_sessions";
      const invites = employee ? "employee_assessment_invitations" : "invitations";
      const owners = employee ? "employee_assessment_participants" : "candidate_applications";
      const owner = employee ? "participant_id" : "application_id";
      const answers = employee ? "employee_assessment_answers" : "candidate_answers";
      const snapshot = async (index = 0, review = false, override: { token?: string; session?: string; scope?: string } = {}) => {
        const result = await db.query<{ data: unknown }>("select public.read_assessment_section_v2($1,$2,$3,$4,$5) as data",
          [override.scope ?? scope, override.token ?? token, override.session ?? id(7), index, review]);
        return result.rows[0].data;
      };
      const presented = async (index = 0, review = false) => readerHarness().presentAssessmentSection(await snapshot(index, review), id(7));
      const navigation = async (index = 0, mode = "prefetch", cachedSection = id(11), cachedVersion = id(3), review = false,
        override: { token?: string; session?: string; scope?: string } = {}) => {
        const result = await db.query<{ data: Record<string, unknown> | null }>(
          "select public.read_assessment_section_navigation_v3($1,$2,$3,$4,$5,$6,$7,$8) as data",
          [override.scope ?? scope, override.token ?? token, override.session ?? id(7), index, review, mode, cachedSection, cachedVersion]);
        return result.rows[0].data;
      };
      const setPresentation = async (settings: Record<string, unknown>) => { await db.query("update public.test_versions set settings_json = $1 where id = $2", [JSON.stringify(settings), id(3)]); };
      const save = async (questionId: string, correct: boolean | null = null) => {
        await db.query(`insert into public.${answers} (session_id,question_id,answer_json,answer_text,is_correct)
          values ($1,$2,'{}','saved answer',$3) on conflict (session_id,question_id) do update set is_correct = excluded.is_correct`, [id(7), questionId, correct]);
      };
      const scenario = async (name: string, run: () => Promise<void>) => {
        await t.test(`${scope}: ${name}`, async () => {
          await db.exec("savepoint scenario");
          try { await run(); } finally { await db.exec("rollback to savepoint scenario"); }
        });
      };
      await db.exec("begin");
      await db.query("insert into public.companies values ($1),($2)", [id(1), id(2)]);
      await db.query(`insert into public.${owners} (id,company_id) values ($1,$2),($3,$4)`, [id(6), id(1), id(66), id(2)]);
      await db.query(`insert into public.${invites} (id,company_id,${owner},token,status,consent_given_at)
        values ($1,$2,$3,$4,'started',now())`, [id(8), id(1), id(6), token]);
      await db.query("insert into public.test_versions (id,duration_minutes,status) values ($1,30,'published'),($2,30,'published')", [id(3), id(4)]);
      for (const [section, version, order] of [[10, 3, 0], [11, 3, 1], [12, 3, 2], [19, 4, 0]]) await db.query(
        "insert into public.test_sections (id,test_version_id,order_index,title) values ($1,$2,$3,$4)", [id(section), id(version), order, `Section ${section}`]);
      await db.query("insert into public.questions (id,section_id,question_type,order_index,settings_json) values ($1,$4,'single_choice',0,$6),($2,$4,'open_text',1,'{}'),($3,$5,'open_text',0,'{}')",
        [id(20), id(21), id(22), id(10), id(11), JSON.stringify({ remediationQuestionId: id(21), incorrectFeedback: "hint", points: 100 })]);
      await db.query("insert into public.answer_options (id,question_id,is_correct,text) values ($1,$3,true,'Right'),($2,$3,false,'Wrong')", [id(30), id(31), id(20)]);
      await db.query(`insert into public.${sessions} (id,${owner},test_version_id,status,started_at) values ($1,$2,$3,'in_progress',now()),($4,$5,$3,'in_progress',now())`, [id(7), id(6), id(3), id(77), id(66)]);

      await scenario("returns current content and per-section counts, without other answers or keys", async () => {
        await save(id(22));
        const result = await presented();
        assert.equal(result.section?.id, id(10));
        assert.equal(result.sections.length, 3);
        assert.deepEqual(result.sections.map(section => section.questionCount), [2, 1, 0]);
        assert.deepEqual(result.sections.map(section => section.visibleQuestionCount), [1, 1, 0]);
        assert.deepEqual(result.answers, {});
        assert.equal(result.otherVisibleQuestionCount, 1);
        assert.ok(!JSON.stringify(result).includes('"isCorrect"'));
        assert.ok(!JSON.stringify(result).includes('"is_correct"'));
        assert.ok(!JSON.stringify(result).includes('"points"'));
        assert.ok(!JSON.stringify(result).includes("hint"));
        const second = await presented(1);
        assert.equal(second.questionOffset, 1);
        assert.equal(second.answers[id(22)].answerText, "saved answer");
        assert.deepEqual(second, await presented(1));
      });
      await scenario("V3 prefetch is one static lookahead, never advances answers/lease and cannot chain in one-question", async () => {
        await setPresentation({ presentationMode: "one_question", allowBack: false });
        const before = await db.exec(`select * from public.${sessions} order by id; select * from public.${answers}; select * from public.${invites}`);
        const raw = await navigation();
        assert.equal(raw?.kind, "content"); assert.equal(raw?.sectionIndex, 1);
        const preview = prefetchHarness().presentPrefetchedSection(raw, id(7));
        assert.equal(preview.section.id, id(11));
        assert.deepEqual(Object.keys(preview).sort(), ["section", "sectionIndex", "versionId"]);
        for (const key of ["answers", "hint", "is_correct", "incompleteQuestionCount", "points"]) assert.ok(!JSON.stringify(raw).includes(key), key);
        assert.equal(await navigation(1), null); assert.equal(await navigation(0, "prefetch", id(11), id(3), true), null);
        assert.deepEqual(await db.exec(`select * from public.${sessions} order by id; select * from public.${answers}; select * from public.${invites}`), before);
        await save(id(20), true);
        assert.equal(await navigation(0), null);
        assert.equal((await navigation(1))?.sectionIndex, 2);
        assert.equal(await navigation(2), null);
      });
      await scenario("V3 hit equals fresh V2 including changed answers, remediation and deleted drafts", async () => {
        const harness = prefetchHarness();
        const preview = harness.presentPrefetchedSection(await navigation(), id(7));
        await save(id(22));
        const raw = await navigation(1, "navigate");
        assert.equal(raw?.kind, "state");
        assert.ok(!Object.hasOwn(raw!, "section"));
        assert.deepEqual(reconcilePrefetchedSection(preview, harness.presentSectionNavigationState(raw)), await presented(1));
        await db.query(`delete from public.${answers} where question_id = $1`, [id(22)]);
        const deleted = reconcilePrefetchedSection(preview, harness.presentSectionNavigationState(await navigation(1, "navigate")));
        assert.deepEqual(deleted, await presented(1)); assert.deepEqual(deleted.answers, {});
        // Cache identity/canonical mismatch stays in the same RPC and uses the real V2 snapshot.
        await setPresentation({ presentationMode: "one_question", allowBack: false });
        await save(id(20), false);
        const mismatch = await navigation(1, "navigate");
        assert.equal(mismatch?.kind, "full"); assert.deepEqual(mismatch?.snapshot, await snapshot(1));
        assert.equal((await navigation(1, "navigate", id(11), id(4)))?.kind, "full");
        await setPresentation({ presentationMode: "one_question", allowBack: true });
        const review = await navigation(0, "navigate", id(10), id(3), true);
        assert.equal(review?.kind, "state"); assert.equal(review?.reviewMode, true);
        assert.equal(harness.presentSectionNavigationState(review).feedbacks[id(20)], "hint");
      });
      await scenario("V3 cache-hit payload does not grow with static text/options", async () => {
        const before = JSON.stringify(await navigation(1, "navigate"));
        await db.query("update public.questions set text = repeat('STATIC CONTENT ', 5000) where id = $1", [id(22)]);
        await db.query("insert into public.answer_options (id,question_id,text) select gen_random_uuid(),$1,repeat('OPTION TEXT ',100) from generate_series(1,100)", [id(22)]);
        assert.equal(JSON.stringify(await navigation(1, "navigate")), before);
        assert.ok(JSON.stringify(await navigation()).length > 100_000);
      });
      await scenario("V3 rechecks token/tenant/consent/deadline/terminal/version status for both reads", async () => {
        for (const mode of ["prefetch", "navigate"]) {
          for (const override of [{ token: "bad" }, { token: "b".repeat(64) }, { session: id(77) }, { session: id(99) }, { scope: "invalid" }, { scope: employee ? "candidate" : "employee" }]) {
            assert.equal(await navigation(0, mode, id(10), id(3), false, override), null);
          }
          for (const [table, field] of [[invites, "status = 'cancelled'"], [invites, "status = 'completed'"],
            [invites, "consent_given_at = null"], [invites, "expires_at = now() - interval '1 second'"], [invites, `company_id = '${id(2)}'`],
            [sessions, "status = 'completed'"], [sessions, "deadline_at = now() - interval '1 second'"], ["test_versions", "status = 'draft'"]]) {
            await db.exec("savepoint prefetch_denied"); await db.exec(`update public.${table} set ${field}`);
            assert.equal(await navigation(0, mode, id(10)), null, `${mode}: ${field}`);
            await db.exec("rollback to savepoint prefetch_denied");
          }
        }
        assert.equal(await navigation(-1), null); assert.equal(await navigation(0, "invalid"), null);
      });
      await scenario("V3 is stable, service-only and deploy verification is read-only", async () => {
        await db.exec("set local role service_role"); assert.ok(await navigation()); await db.exec("reset role");
        for (const role of ["anon", "authenticated"]) {
          await db.exec("savepoint prefetch_role"); await db.exec(`set local role ${role}`);
          await assert.rejects(navigation(), /permission denied/); await db.exec("rollback to savepoint prefetch_role");
        }
        const result = await db.exec(read("../supabase/verification/assessment_section_prefetch_v3.sql"));
        assert.deepEqual(result[0].rows, [{ signature: "public.read_assessment_section_navigation_v3(text,text,uuid,integer,boolean,text,uuid,uuid)",
          installed: true, permissions_ok: true, stable_snapshot: true }]);
      });
      await scenario("one-question resumes first incomplete visible section, preserving review rules", async () => {
        await setPresentation({ presentationMode: "one_question", allowBack: true });
        assert.equal((await presented(2)).sectionIndex, 0);
        await save(id(20), true);
        assert.equal((await presented()).sectionIndex, 1);
        assert.equal((await presented(0, true)).sectionIndex, 0);
        await setPresentation({ presentationMode: "one_question", allowBack: false });
        assert.equal((await presented(0, true)).sectionIndex, 1);
        await save(id(20), false);
        const retry = await presented(2);
        assert.equal(retry.sectionIndex, 0);
        assert.equal(retry.sections[0].visibleQuestionCount, 2);
        assert.equal(retry.answers[id(20)].remediationRequired, true);
        assert.equal(retry.section!.questions[0].incorrectFeedback, "hint");
        await save(id(21));
        assert.equal((await presented()).sectionIndex, 1);
      });
      await scenario("handles empty sections, empty tests and out-of-bounds requested indexes", async () => {
        assert.equal((await presented(-7)).sectionIndex, 0);
        assert.equal((await presented(99999)).section?.id, id(12));
        assert.deepEqual((await presented(2)).section?.questions, []);
        await db.query(`update public.${sessions} set test_version_id = $1 where id = $2`, [id(4), id(7)]);
        await db.query("delete from public.test_sections where id = $1", [id(19)]);
        const empty = await presented();
        assert.equal(empty.section, null);
        assert.deepEqual(empty.sections, []);
      });
      await scenario("adding 1000 questions elsewhere changes only aggregate counts", async () => {
        const before = JSON.stringify(await snapshot());
        await db.query("insert into public.questions (id,section_id,text) select gen_random_uuid(),$1,repeat('OUTSIDE CONTENT ',200) from generate_series(1,1000)", [id(11)]);
        const after = JSON.stringify(await snapshot());
        assert.ok(Math.abs(after.length - before.length) < 20, `${before.length} -> ${after.length}`);
        assert.ok(!after.includes("OUTSIDE CONTENT"));
        assert.equal((await presented()).sections[1].questionCount, 1001);
      });
      await scenario("rejects foreign scope/session/company, bad tokens, revoked consent and terminal states", async () => {
        for (const override of [{ token: "bad" }, { token: "b".repeat(64) }, { session: id(77) }, { session: id(99) }, { scope: "invalid" }, { scope: employee ? "candidate" : "employee" }]) {
          assert.equal(await snapshot(0, false, override), null);
        }
        for (const field of ["status = 'cancelled'", "status = 'completed'", "status = 'expired'", "consent_given_at = null", "expires_at = now() - interval '1 second'", `company_id = '${id(2)}'`]) {
          await db.exec("savepoint rejected");
          await db.exec(`update public.${invites} set ${field}`);
          assert.equal(await snapshot(), null);
          await db.exec("rollback to savepoint rejected");
        }
        await db.exec(`update public.${sessions} set status = 'completed'`);
        assert.equal(await snapshot(), null);
      });
      await scenario("read has no writes and only service_role can execute it", async () => {
        const before = await db.exec(`select * from public.${sessions} order by id; select * from public.${invites}`);
        await db.exec("set local role service_role");
        assert.ok(await snapshot());
        await db.exec("reset role");
        assert.deepEqual(await db.exec(`select * from public.${sessions} order by id; select * from public.${invites}`), before);
        for (const role of ["anon", "authenticated"]) {
          await db.exec("savepoint role_test"); await db.exec(`set local role ${role}`);
          await assert.rejects(snapshot(), /permission denied/);
          await db.exec("rollback to savepoint role_test");
        }
        const fn = await db.query<{ proconfig: string[]; provolatile: string; prosecdef: boolean }>(
          "select proconfig, provolatile, prosecdef from pg_proc where oid = 'public.read_assessment_section_v2(text,text,uuid,integer,boolean)'::regprocedure");
        assert.deepEqual(fn.rows[0], { proconfig: ['search_path=""'], provolatile: "s", prosecdef: true });
        const verification = await db.exec(read("../supabase/verification/assessment_section_read_v2.sql"));
        assert.deepEqual(verification[0].rows, [{
          signature: "public.read_assessment_section_v2(text,text,uuid,integer,boolean)",
          installed: true, permissions_ok: true, stable_snapshot: true,
        }]);
      });
      await db.exec("rollback");
    }
  } finally { await db.close(); }
});
