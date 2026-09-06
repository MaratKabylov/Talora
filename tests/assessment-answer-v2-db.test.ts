import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileFunction } from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { z } from "zod";
import * as forcedChoice from "../lib/forced-choice.ts";
import * as multipleChoice from "../lib/answers/multiple-choice.ts";
import * as presentation from "../lib/tests/presentation-settings.ts";
import * as structured from "../lib/structured-questions.ts";
import type { AssessmentAnswerDraft } from "../lib/assessment/session-control.ts";

const id = (n: number) => `f4000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = "a".repeat(64);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = (name: string) => read(`../supabase/migrations/${name}.sql`);

async function database() {
  const db = new PGlite();
  try {
    await db.exec(read("./fixtures/session-control-v2.sql"));
    await db.exec(read("./fixtures/assessment-answer-v2.sql"));
    await db.exec(migration("20260811120000_assessment_integrity_controls"));
    // Execute the actual existing answer validators/triggers, not replacements.
    const fc = migration("20260819160000_forced_choice_support");
    await db.exec(fc.slice(fc.indexOf("create or replace function public.validate_forced_choice_answer_payload("),
      fc.indexOf("create or replace function public.validate_candidate_answer_assignment()")));
    const mc = migration("20260822120000_multiple_choice_support");
    await db.exec(mc.slice(mc.indexOf("create or replace function public.validate_multiple_choice_answer_payload(")));
    await db.exec(migration("20260827170000_employee_assessment_integrity_controls"));
    await db.exec(migration("20260906120000_assessment_session_lease_v2"));
    await db.exec(migration("20260906130000_assessment_answer_v2"));
    return db;
  } catch (error) { await db.close(); throw error; }
}

function v1Normalizer() {
  const dependencies: Record<string, unknown> = {
    "node:crypto": crypto, zod: { z }, "@/lib/supabase/admin": {},
    "@/lib/forced-choice": forcedChoice, "@/lib/answers/multiple-choice": multipleChoice,
    "@/lib/tests/presentation-settings": presentation, "@/lib/structured-questions": structured,
    "./session-control-v2": {}, "./completion": {}, "./data": {},
    "@/lib/employee-assessments/completion": {}, "@/lib/employee-assessments/public-data": {},
  };
  const { outputText } = transpileModule(read("../lib/assessment/session-control.ts"), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  });
  // Expose the real private V1 normalizer only inside this test VM.
  const exports = {} as { normalize: (access: unknown, questionId: string, draft: AssessmentAnswerDraft, finalize: boolean) => Promise<unknown> };
  compileFunction(`${outputText}\nexports.normalize = answerRowForDraft;`, ["exports", "require"])(exports, (specifier: string) => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency ${specifier}`);
    return dependencies[specifier];
  });
  return (questionType: string, settings: Record<string, unknown>, draft: AssessmentAnswerDraft, finalize: boolean) => {
    const admin = { from: (table: string) => {
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({ error: null, data: table === "questions" ? {
          id: id(10), section_id: id(5), question_type: questionType, settings_json: settings,
          answer_options: [20, 21, 22].map(n => ({ id: id(n), match_target_id: id(n + 10), is_correct: n === 20 })),
        } : { id: id(5) } }),
      };
      return query;
    } };
    return exports.normalize({ admin, session: { test_version_id: id(3) } }, id(10), draft, finalize);
  };
}

test("SQL answer normalization matches the real V1 code on all answer types", async (t) => {
  const db = await database();
  const normalize = v1Normalizer();
  type Example = { name: string; type: string; draft: AssessmentAnswerDraft; settings?: Record<string, unknown>; finalize?: boolean };
  const examples: Example[] = [
    { name: "single empty", type: "single_choice", draft: {} },
    { name: "single valid", type: "single_choice", draft: { selectedOptionId: id(20) } },
    { name: "single foreign", type: "single_choice", draft: { selectedOptionId: id(99) } },
    { name: "single uppercase stays case-sensitive", type: "single_choice", draft: { selectedOptionId: id(20).toUpperCase() } },
    { name: "multiple empty draft", type: "multiple_choice", draft: { selectedOptionIds: [] } },
    { name: "multiple empty required", type: "multiple_choice", draft: {}, finalize: true },
    { name: "multiple optional skip", type: "multiple_choice", draft: {}, settings: { required: false }, finalize: true },
    { name: "multiple canonical order and duplicates", type: "multiple_choice", draft: { selectedOptionIds: [id(22), id(20), id(20)] } },
    { name: "multiple foreign", type: "multiple_choice", draft: { selectedOptionIds: [id(99)] } },
    { name: "multiple malformed UUID", type: "multiple_choice", draft: { selectedOptionIds: ["bad"] } },
    { name: "multiple lower limit", type: "multiple_choice", settings: { minSelections: 2 }, draft: { selectedOptionIds: [id(20)] } },
    { name: "multiple upper limit", type: "multiple_choice", settings: { maxSelections: 1 }, draft: { selectedOptionIds: [id(20), id(21)] } },
    { name: "forced incomplete draft", type: "forced_choice", settings: { mode: "most_least" }, draft: { mostOptionId: id(20) } },
    { name: "forced incomplete finalize", type: "forced_choice", settings: { mode: "most_least" }, draft: { mostOptionId: id(20) }, finalize: true },
    { name: "forced empty required", type: "forced_choice", settings: { mode: "most_least" }, draft: {}, finalize: true },
    { name: "forced empty optional", type: "forced_choice", settings: { mode: "most_least", required: false }, draft: {}, finalize: true },
    { name: "forced empty draft unsupported mode", type: "forced_choice", draft: {} },
    { name: "forced required unsupported mode", type: "forced_choice", draft: {}, finalize: true },
    { name: "forced same option", type: "forced_choice", settings: { mode: "most_least" }, draft: { mostOptionId: id(20), leastOptionId: id(20) } },
    { name: "forced foreign option", type: "forced_choice", settings: { mode: "most_least" }, draft: { mostOptionId: id(20), leastOptionId: id(99) } },
    { name: "forced valid", type: "forced_choice", settings: { mode: "most_least" }, draft: { mostOptionId: id(20), leastOptionId: id(21) } },
    { name: "scale absent", type: "scale", draft: { scaleValue: null } },
    { name: "scale zero", type: "scale", settings: { min: 0, max: 10 }, draft: { scaleValue: 0 } },
    { name: "scale default minimum", type: "scale", draft: { scaleValue: 1 } },
    { name: "scale default maximum", type: "scale", draft: { scaleValue: 5 } },
    { name: "scale out of range", type: "scale", draft: { scaleValue: 6 } },
    { name: "scale fraction", type: "scale", draft: { scaleValue: 2.5 } },
    { name: "ordering empty", type: "ordering", settings: { structuredResponseVersion: 1 }, draft: {} },
    { name: "ordering permutation", type: "ordering", settings: { structuredResponseVersion: 1 }, draft: { orderedOptionIds: [id(22), id(20), id(21)] } },
    { name: "ordering incomplete", type: "ordering", settings: { structuredResponseVersion: 1 }, draft: { orderedOptionIds: [id(20)] } },
    { name: "ordering duplicate", type: "ordering", settings: { structuredResponseVersion: 1 }, draft: { orderedOptionIds: [id(20), id(20), id(21)] } },
    { name: "ordering foreign", type: "ordering", settings: { structuredResponseVersion: 1 }, draft: { orderedOptionIds: [id(20), id(21), id(99)] } },
    { name: "legacy ordering text", type: "ordering", draft: { answerText: "  C, B, A  " } },
    { name: "matching empty", type: "matching", settings: { structuredResponseVersion: 1 }, draft: { matches: [] } },
    { name: "matching partial draft", type: "matching", settings: { structuredResponseVersion: 1 }, draft: { matches: [{ optionId: id(20), targetId: id(31) }] } },
    { name: "matching partial finalize", type: "matching", settings: { structuredResponseVersion: 1 }, draft: { matches: [{ optionId: id(20), targetId: id(31) }] }, finalize: true },
    { name: "matching permutation", type: "matching", settings: { structuredResponseVersion: 1 }, draft: { matches: [20, 21, 22].map((n, i) => ({ optionId: id(n), targetId: id(32 - i) })) }, finalize: true },
    { name: "matching duplicate target", type: "matching", settings: { structuredResponseVersion: 1 }, draft: { matches: [20, 21].map(n => ({ optionId: id(n), targetId: id(30) })) } },
    { name: "matching foreign target", type: "matching", settings: { structuredResponseVersion: 1 }, draft: { matches: [{ optionId: id(20), targetId: id(99) }] } },
    { name: "legacy matching text", type: "matching", draft: { answerText: " A-B " } },
    { name: "text trims JS whitespace", type: "open_text", draft: { answerText: "\uFEFF\u00a0\t\r\n Текст \u2003\n" } },
    { name: "text empty", type: "open_text", draft: { answerText: "\n\t " } },
    { name: "text at UTF16 boundary", type: "open_text", draft: { answerText: "😀".repeat(2000) } },
    { name: "text exceeds UTF16 limit", type: "open_text", draft: { answerText: "😀".repeat(2001) } },
  ];
  try {
    await db.query("insert into public.test_versions (id, status) values ($1, 'draft')", [id(3)]);
    await db.query("insert into public.test_sections (id, test_version_id) values ($1, $2)", [id(5), id(3)]);
    await db.query("insert into public.questions (id, section_id) values ($1, $2)", [id(10), id(5)]);
    for (const n of [20, 21, 22]) await db.query("insert into public.answer_options values ($1, $2, $3, $4)", [id(n), id(10), n === 20, id(n + 10)]);
    for (const example of examples) {
      await t.test(example.name, async () => {
        await db.query("update public.questions set question_type = $1, settings_json = $2", [example.type, JSON.stringify(example.settings ?? {})]);
        const expected = await Promise.allSettled([normalize(example.type, example.settings ?? {}, example.draft, example.finalize ?? false)]);
        const result = await Promise.allSettled([db.query<{ answer: unknown }>("select public.normalize_assessment_answer_v2($1,$2,$3) as answer", [id(10), JSON.stringify(example.draft), example.finalize ?? false])]);
        assert.equal(result[0].status, expected[0].status);
        if (expected[0].status === "fulfilled" && result[0].status === "fulfilled") {
          assert.deepEqual(result[0].value.rows[0].answer, expected[0].value);
        }
      });
    }
  } finally { await db.close(); }
});

test("atomic answer saving applies the real DB validators in both assessment scopes", async (t) => {
  const db = await database();
  try {
    for (const scope of ["candidate", "employee"] as const) {
      const employee = scope === "employee";
      const sessions = employee ? "employee_assessment_sessions" : "test_sessions";
      const answers = employee ? "employee_assessment_answers" : "candidate_answers";
      const owners = employee ? "employee_assessment_participants" : "candidate_applications";
      const invites = employee ? "employee_assessment_invitations" : "invitations";
      const owner = employee ? "participant_id" : "application_id";
      const lease = async (clientId = id(50)) => (await db.query<{ result: Record<string, unknown> }>(
        "select public.control_assessment_session_lease_v2($1,$2,$3,$4,$5,'claim',$6) as result",
        [scope, token, id(7), clientId, id(51), JSON.stringify({ clientEventId: id(52) })],
      )).rows[0].result;
      const save = async (draft: AssessmentAnswerDraft = { selectedOptionId: id(20) }, options: {
        questionId?: string; finalize?: boolean; time?: number; token?: string; clientId?: string; sessionId?: string;
      } = {}) => (await db.query<{ result: Record<string, unknown> }>(
        "select public.save_assessment_answer_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) as result",
        [scope, options.token ?? token, options.sessionId ?? id(7), options.clientId ?? id(50), id(51), options.questionId ?? id(10),
          JSON.stringify(draft), options.finalize ?? true, options.time ?? null],
      )).rows[0].result;
      const rows = async () => (await db.query<Record<string, unknown>>(`select * from public.${answers} order by question_id`)).rows;
      const state = async () => (await db.query<Record<string, unknown>>(`select * from public.${sessions}`)).rows;
      const settings = async (value: Record<string, unknown>) => { await db.query("update public.test_versions set settings_json = $1 where id = $2", [JSON.stringify(value), id(3)]); };
      const question = async (type: string, value: Record<string, unknown> = {}) => { await db.query("update public.questions set question_type = $1, settings_json = $2 where id = $3", [type, JSON.stringify(value), id(10)]); };
      const reject = async (run: () => Promise<unknown>) => {
        await db.exec("savepoint rejection");
        await assert.rejects(run());
        await db.exec("rollback to savepoint rejection");
      };
      const scenario = async (name: string, run: () => Promise<void>) => {
        await t.test(`${scope}: ${name}`, async () => {
          await db.exec("savepoint scenario");
          try { await run(); } finally { await db.exec("rollback to savepoint scenario"); }
        });
      };
      await db.exec("begin");
      await db.query("insert into public.companies values ($1), ($2)", [id(1), id(2)]);
      await db.query(`insert into public.${owners} (id,company_id) values ($1,$2), ($3,$4)`, [id(6), id(1), id(66), id(2)]);
      await db.query(`insert into public.${invites} (id,company_id,${owner},token,status) values ($1,$2,$3,$4,'started')`, [id(8), id(1), id(6), token]);
      await db.query("insert into public.test_versions (id,duration_minutes,status) values ($1,30,'published'), ($2,30,'published')", [id(3), id(4)]);
      await db.query("insert into public.test_sections (id,test_version_id) values ($1,$2), ($3,$4)", [id(5), id(3), id(9), id(4)]);
      await db.query("insert into public.questions (id,section_id,question_type,order_index) values ($1,$4,'single_choice',0),($2,$4,'open_text',1),($3,$5,'open_text',0)", [id(10), id(11), id(12), id(5), id(9)]);
      for (const n of [20, 21, 22]) await db.query("insert into public.answer_options values ($1,$2,$3,$4)", [id(n), id(10), n === 20, id(n + 10)]);
      await db.query(`insert into public.${sessions} (id,${owner},test_version_id,status,started_at) values ($1,$2,$3,'in_progress',clock_timestamp())`, [id(7), id(6), id(3)]);
      await lease();

      await scenario("ordinary save is idempotent and section mode never leaks correctness", async () => {
        for (let n = 0; n < 2; n++) {
          const result = await save();
          assert.equal(result.status, "active");
          assert.equal(result.answerIsCorrect, null);
          assert.equal(result.incorrectFeedback, null);
          assert.ok(result.savedAt);
        }
        assert.equal((await rows()).length, 1);
        assert.equal((await rows())[0].selected_option_id, id(20));
        assert.equal((await rows())[0].points_awarded, null);
      });
      await scenario("empty autosave deletes an answer; optional finalize stores skipped", async () => {
        await save();
        await save({}, { finalize: false });
        assert.deepEqual(await rows(), []);
        await settings({ presentationMode: "one_question" });
        await question("single_choice", { required: false });
        await save({});
        assert.deepEqual((await rows())[0].answer_json, { skipped: true });
      });
      await scenario("captures time only when enabled and preserves it when omitted", async () => {
        await save({}, { questionId: id(11), time: 9 });
        assert.equal((await rows())[0].time_spent_seconds, null);
        await settings({ captureQuestionTime: true });
        await save({ answerText: "timed" }, { questionId: id(11), time: 0 });
        assert.equal((await rows())[0].time_spent_seconds, 0);
        await save({ answerText: "changed" }, { questionId: id(11) });
        assert.equal((await rows())[0].time_spent_seconds, 0);
        await reject(() => save({}, { time: -1 }));
      });
      await scenario("real forced/multiple choice triggers accept canonical answers and optional skips", async () => {
        await question("forced_choice", { mode: "most_least" });
        await save({ mostOptionId: id(20), leastOptionId: id(21) });
        await reject(() => save({ mostOptionId: id(20) }));
        await question("multiple_choice", { required: false, multipleChoiceScoringVersion: 1, minSelections: 0, maxSelections: 3 });
        await save({ selectedOptionIds: [id(22), id(20), id(20)] });
        assert.deepEqual((await rows())[0].answer_json, { selectedOptionIds: [id(20), id(22)] });
        await save({});
        assert.deepEqual((await rows())[0].answer_json, { skipped: true });
      });
      await scenario("one-question order, required checks and immutable finalized retries", async () => {
        await settings({ presentationMode: "one_question", allowBack: false });
        await reject(() => save({ answerText: "second" }, { questionId: id(11) }));
        await reject(() => save({}, { finalize: false }));
        await reject(() => save({}));
        await save();
        const before = await rows();
        // Nullable is_correct must still count as an existing answer.
        await save({ selectedOptionId: id(21) });
        assert.deepEqual(await rows(), before);
        await save({ answerText: "second" }, { questionId: id(11) });
        assert.equal((await rows()).length, 2);
      });
      await scenario("wrong parent opens remediation, right parent atomically clears it", async () => {
        await settings({ presentationMode: "one_question", allowBack: true });
        await question("single_choice", { remediationQuestionId: id(11), incorrectFeedback: "Try the rule again" });
        const wrong = await save({ selectedOptionId: id(21) });
        assert.equal(wrong.answerIsCorrect, false);
        assert.equal(wrong.incorrectFeedback, "Try the rule again");
        await save({ answerText: "remediation" }, { questionId: id(11) });
        assert.equal((await rows()).length, 2);
        const correct = await save();
        assert.equal(correct.answerIsCorrect, true);
        assert.equal(correct.incorrectFeedback, null);
        assert.equal((await rows()).length, 1);
      });
      await scenario("hidden remediation does not become the next no-back question", async () => {
        await settings({ presentationMode: "one_question", allowBack: false });
        await question("single_choice", { remediationQuestionId: id(11), incorrectFeedback: "hint" });
        await save();
        await reject(() => save({ answerText: "hidden" }, { questionId: id(11) }));
      });
      await scenario("wrong-answer retries keep feedback and remediation cannot be skipped", async () => {
        await settings({ presentationMode: "one_question", allowBack: false });
        await question("single_choice", { remediationQuestionId: id(11), incorrectFeedback: "hint" });
        await db.query("update public.questions set settings_json = $1 where id = $2", ['{"required":false}', id(11)]);
        await save({ selectedOptionId: id(21) });
        const before = await rows();
        const retry = await save();
        assert.equal(retry.answerIsCorrect, false);
        assert.equal(retry.incorrectFeedback, "hint");
        assert.deepEqual(await rows(), before);
        await reject(() => save({}, { questionId: id(11) }));
        await save({ answerText: "retry" }, { questionId: id(11) });
        assert.equal((await rows()).length, 2);
      });
      await scenario("multiple-choice remediation retains V1 null correctness, without new scoring", async () => {
        await settings({ presentationMode: "one_question", allowBack: true });
        await question("multiple_choice", { remediationQuestionId: id(11), incorrectFeedback: "hint" });
        const result = await save({ selectedOptionIds: [id(21)] });
        assert.equal(result.answerIsCorrect, null);
        assert.equal(result.incorrectFeedback, null);
        assert.equal((await rows())[0].raw_score, null);
      });
      await scenario("remediation deletion failure rolls back parent answer and lease", async () => {
        await settings({ presentationMode: "one_question", allowBack: true });
        await question("single_choice", { remediationQuestionId: id(11), incorrectFeedback: "hint" });
        await save({ selectedOptionId: id(21) });
        await save({ answerText: "retry" }, { questionId: id(11) });
        const before = await rows(); const sessionBefore = await state();
        await db.exec(`create function public.test_reject_delete() returns trigger language plpgsql as $$ begin raise exception 'test delete failure'; end; $$;
          create trigger test_reject_delete before delete on public.${answers} for each row execute function public.test_reject_delete()`);
        await reject(() => save());
        assert.deepEqual(await rows(), before);
        assert.deepEqual(await state(), sessionBefore);
      });
      await scenario("late save and clear cannot mutate data after takeover, expiry or completion", async () => {
        await save();
        const before = await rows();
        await db.exec(`update public.${sessions} set lease_expires_at = clock_timestamp() - interval '1 second'`);
        await lease(id(60));
        assert.equal((await save()).status, "blocked");
        assert.equal((await save({}, { finalize: false })).status, "blocked");
        await db.exec(`update public.${sessions} set deadline_at = clock_timestamp() - interval '1 second'`);
        assert.equal((await save()).status, "expired");
        await db.exec(`update public.${sessions} set status = 'completed'`);
        assert.equal((await save()).status, "terminal");
        assert.deepEqual(await rows(), before);
      });
      await scenario("invalid token, cross-tenant session and foreign question fail closed", async () => {
        const before = await state();
        assert.equal((await save({}, { token: "b".repeat(64) })).status, "unavailable");
        assert.equal((await save({}, { sessionId: id(99) })).status, "unavailable");
        await reject(() => save({ answerText: "foreign" }, { questionId: id(12) }));
        assert.deepEqual(await state(), before);
        await db.query(`update public.${sessions} set ${owner} = $1`, [id(66)]);
        assert.equal((await save()).status, "unavailable");
        assert.deepEqual(await rows(), []);
      });
      await scenario("deadline or token expiring inside an answer trigger rolls back the whole save", async () => {
        await db.exec(`create function public.test_delay_answer() returns trigger language plpgsql as $$ begin perform pg_sleep(0.15); return new; end; $$;
          create trigger test_delay_answer after insert on public.${answers} for each row execute function public.test_delay_answer()`);
        for (const cutoff of ["deadline", "token"]) {
          await db.exec("savepoint cutoff");
          await db.exec(cutoff === "deadline"
            ? `update public.${sessions} set deadline_at = clock_timestamp() + interval '0.1 second'`
            : `update public.${invites} set expires_at = clock_timestamp() + interval '0.1 second'`);
          const before = await state();
          assert.equal((await save()).status, cutoff === "deadline" ? "expired" : "unavailable");
          assert.deepEqual(await rows(), []);
          assert.deepEqual(await state(), before);
          await db.exec("rollback to savepoint cutoff");
        }
      });
      await scenario("save is service-only and its normalization helper is private", async () => {
        const signature = "public.save_assessment_answer_v2(text,text,uuid,text,text,uuid,jsonb,boolean,integer)";
        for (const role of ["anon", "authenticated"]) {
          await db.exec("savepoint role_test");
          await db.exec(`set local role ${role}`);
          await assert.rejects(save(), /permission denied/);
          await db.exec("rollback to savepoint role_test");
        }
        await db.exec("set local role service_role");
        assert.equal((await save()).status, "active");
        await db.exec("reset role");
        const permissions = await db.query<{ helper: boolean; prosecdef: boolean; proconfig: string[] }>(
          "select has_function_privilege('service_role','public.normalize_assessment_answer_v2(uuid,jsonb,boolean)','execute') as helper, prosecdef, proconfig from pg_proc where oid = $1::regprocedure", [signature]);
        assert.equal(permissions.rows[0].helper, false);
        assert.equal(permissions.rows[0].prosecdef, true);
        assert.deepEqual(permissions.rows[0].proconfig, ['search_path=""']);
        const verification = await db.exec(read("../supabase/verification/assessment_session_control_v2.sql"));
        assert.equal(verification[0].rows.length, 3);
        for (const entry of verification[0].rows as Array<{ installed: boolean; permissions_ok: boolean }>) {
          assert.equal(entry.installed, true);
          assert.equal(entry.permissions_ok, true);
        }
        assert.ok(Object.values(verification[1].rows[0] as Record<string, boolean>).every(Boolean));
      });
      await db.exec("rollback");
    }
  } finally { await db.close(); }
});
