import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const id = (n: number) => `f9000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = "a".repeat(64);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = (name: string) => read(`../supabase/migrations/${name}.sql`);

test("section batch executes real normalization/triggers atomically for both scopes", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(read("./fixtures/session-control-v2.sql"));
    await db.exec(read("./fixtures/assessment-answer-v2.sql"));
    await db.exec(migration("20260811120000_assessment_integrity_controls"));
    const fc = migration("20260819160000_forced_choice_support");
    await db.exec(fc.slice(fc.indexOf("create or replace function public.validate_forced_choice_answer_payload("),
      fc.indexOf("create or replace function public.validate_candidate_answer_assignment()")));
    const mc = migration("20260822120000_multiple_choice_support");
    await db.exec(mc.slice(mc.indexOf("create or replace function public.validate_multiple_choice_answer_payload(")));
    for (const name of ["20260827170000_employee_assessment_integrity_controls", "20260906120000_assessment_session_lease_v2",
      "20260906130000_assessment_answer_v2", "20260907150000_assessment_section_save_v2"]) await db.exec(migration(name));
    await db.exec("alter table public.invitations add column consent_given_at timestamptz default now(); alter table public.employee_assessment_invitations add column consent_given_at timestamptz default now()");
    for (const scope of ["candidate", "employee"] as const) {
      const employee = scope === "employee";
      const sessions = employee ? "employee_assessment_sessions" : "test_sessions";
      const answers = employee ? "employee_assessment_answers" : "candidate_answers";
      const owners = employee ? "employee_assessment_participants" : "candidate_applications";
      const invites = employee ? "employee_assessment_invitations" : "invitations";
      const owner = employee ? "participant_id" : "application_id";
      const batch = (option = id(20), text = "Saved text", extra: Record<string, unknown> = {}) => [
        { questionId: id(10), answer: { selectedOptionId: option }, timeSpentSeconds: 5 },
        { questionId: id(11), answer: { answerText: text }, ...extra },
        { questionId: id(12), answer: {} },
      ];
      const save = async (payload: unknown = batch(), opts: { section?: string; token?: string; client?: string; direction?: string; session?: string } = {}) =>
        (await db.query<{ result: Record<string, unknown> }>("select public.save_assessment_section_v2($1,$2,$3,$4,$5,$6,$7,$8) result",
          [scope, opts.token ?? token, opts.session ?? id(7), opts.client ?? id(60), id(61), opts.section ?? id(5), JSON.stringify(payload), opts.direction ?? "next"])).rows[0].result;
      const rows = async () => (await db.query<Record<string, unknown>>(`select * from public.${answers} order by question_id`)).rows;
      const state = async () => (await db.query(`select * from public.${sessions}`)).rows;
      const reject = async (run: () => Promise<unknown>) => {
        await db.exec("savepoint rejection"); await assert.rejects(run()); await db.exec("rollback to savepoint rejection");
      };
      const scenario = async (name: string, run: () => Promise<void>) => t.test(`${scope}: ${name}`, async () => {
        await db.exec("savepoint scenario"); try { await run(); } finally { await db.exec("rollback to savepoint scenario"); }
      });
      await db.exec("begin");
      await db.exec(`insert into public.companies values ('${id(1)}'), ('${id(2)}');
        insert into public.${owners}(id,company_id) values ('${id(30)}','${id(1)}'), ('${id(31)}','${id(2)}');
        insert into public.${invites}(id,company_id,${owner},token,status) values ('${id(8)}','${id(1)}','${id(30)}','${token}','started');
        insert into public.test_versions(id,duration_minutes,status,settings_json) values ('${id(3)}',30,'published','{"presentationMode":"section","captureQuestionTime":true}'), ('${id(4)}',30,'published','{}');
        insert into public.test_sections(id,test_version_id,order_index) values ('${id(5)}','${id(3)}',0), ('${id(6)}','${id(3)}',1), ('${id(9)}','${id(4)}',0);
        insert into public.questions(id,section_id,question_type,settings_json,order_index) values
          ('${id(10)}','${id(5)}','single_choice','{}',0), ('${id(11)}','${id(5)}','open_text','{}',1),
          ('${id(12)}','${id(5)}','open_text','{"required":false}',2), ('${id(13)}','${id(9)}','open_text','{}',0);
        insert into public.answer_options values ('${id(20)}','${id(10)}',true,'${id(40)}'), ('${id(21)}','${id(10)}',false,'${id(41)}');
        insert into public.${sessions}(id,${owner},test_version_id,status,started_at) values ('${id(7)}','${id(30)}','${id(3)}','in_progress',clock_timestamp());
      `);
      await db.query("select public.control_assessment_session_lease_v2($1,$2,$3,$4,$5,'claim',$6)", [scope, token, id(7), id(60), id(61), JSON.stringify({ clientEventId: id(62) })]);
      await scenario("batch persists once, clears optional answers, keeps timing and exposes only navigation metadata", async () => {
        assert.equal((await save()).nextSectionIndex, 1);
        assert.equal((await rows()).length, 2);
        assert.equal((await rows())[0].time_spent_seconds, 5);
        const response = await save();
        assert.equal((await rows()).length, 2);
        assert.deepEqual(Object.keys(response).sort(), ["deadlineAt", "needsRemediation", "nextSectionIndex", "savedAt", "sectionIndex", "status"]);
        const withOptional = batch(); withOptional[2].answer = { answerText: "remove me" };
        await save(withOptional); assert.equal((await rows()).length, 3);
        await save(); assert.equal((await rows()).length, 2);
        assert.equal((await rows())[0].is_correct, null);
      });
      await scenario("invalid, missing, duplicate and foreign questions roll back answers AND lease", async () => {
        await save(); const before = await rows(); const sessionBefore = await state();
        for (const input of [null, {}, [], batch().slice(1), [...batch(), batch()[0]],
          [...batch(), { questionId: id(13), answer: { answerText: "foreign" } }], batch(id(99)), batch(id(20), "")]) {
          await reject(() => save(input)); assert.deepEqual(await rows(), before); assert.deepEqual(await state(), sessionBefore);
        }
        await reject(() => save(batch(), { section: id(9) }));
      });
      await scenario("normalizes all structured answer types with the deployed validator", async () => {
        for (const n of [50, 51, 52]) await db.query("insert into public.answer_options values ($1,$2,false,$3)", [id(n), id(11), id(n + 100)]);
        for (const [type, settings, draft, expected] of [
          ["multiple_choice", { minSelections: 1 }, { selectedOptionIds: [id(51), id(50)] }, { selectedOptionIds: [id(50), id(51)] }],
          ["forced_choice", { mode: "most_least" }, { mostOptionId: id(50), leastOptionId: id(51) }, { mostOptionId: id(50), leastOptionId: id(51) }],
          ["scale", { min: 0, max: 5 }, { scaleValue: 0 }, { value: 0 }],
          ["ordering", { structuredResponseVersion: 1 }, { orderedOptionIds: [id(52), id(51), id(50)] }, { orderedOptionIds: [id(52), id(51), id(50)] }],
          ["matching", { structuredResponseVersion: 1 }, { matches: [50, 51, 52].map(n => ({ optionId: id(n), targetId: id(n + 100) })) }, { matches: [50, 51, 52].map(n => ({ optionId: id(n), targetId: id(n + 100) })) }],
        ] as const) {
          await db.query("update public.questions set question_type = $1, settings_json = $2 where id = $3", [type, JSON.stringify(settings), id(11)]);
          await save(batch(id(20), "", { answer: draft }));
          assert.deepEqual((await rows()).find(row => row.question_id === id(11))?.answer_json, expected);
        }
      });
      await scenario("remediation activates on current parent, stays until answered, and clears inactive target", async () => {
        await db.query("update public.questions set settings_json = $1 where id = $2", [JSON.stringify({ remediationQuestionId: id(12) }), id(10)]);
        const first = await save(batch(id(21)).slice(0, 2));
        assert.equal(first.needsRemediation, true); assert.equal(first.nextSectionIndex, 0);
        const followup = batch(id(21)); followup[2].answer = { answerText: "Retry" };
        assert.equal((await save(followup)).nextSectionIndex, 1);
        assert.equal((await rows()).length, 3);
        await save(); assert.equal((await rows()).length, 2);
        assert.equal((await rows())[0].is_correct, true);
      });
      await scenario("write/delete failure and deadline during slow trigger roll back the entire batch", async () => {
        await db.exec(`create function public.reject_section_write() returns trigger language plpgsql as $$ begin raise exception 'synthetic failure'; end; $$;
          create trigger reject_section_write before insert on public.${answers} for each row when (new.question_id = '${id(11)}') execute function public.reject_section_write()`);
        const before = await state(); await reject(() => save());
        assert.deepEqual(await rows(), []); assert.deepEqual(await state(), before);
        await db.exec(`drop trigger reject_section_write on public.${answers}`);
        const optional = batch(); optional[2].answer = { answerText: "preserve" }; await save(optional);
        await db.exec(`create trigger reject_section_delete before delete on public.${answers} for each row execute function public.reject_section_write()`);
        const stored = await rows(); const sessionBefore = await state(); await reject(() => save());
        assert.deepEqual(await rows(), stored); assert.deepEqual(await state(), sessionBefore);
        await db.exec(`drop trigger reject_section_delete on public.${answers}; delete from public.${answers};
          create function public.delay_section_write() returns trigger language plpgsql as $$ begin perform pg_sleep(0.15); return new; end; $$;
          create trigger delay_section_write after insert on public.${answers} for each row execute function public.delay_section_write()`);
        for (const cutoff of ["deadline", "token"]) {
          await db.exec("savepoint cutoff");
          await db.exec(cutoff === "deadline" ? `update public.${sessions} set deadline_at = clock_timestamp() + interval '100 milliseconds'`
            : `update public.${invites} set expires_at = clock_timestamp() + interval '100 milliseconds'`);
          const stateBefore = await state(); assert.equal((await save()).status, cutoff === "deadline" ? "expired" : "unavailable");
          assert.deepEqual(await rows(), []); assert.deepEqual(await state(), stateBefore);
          await db.exec("rollback to savepoint cutoff");
        }
      });
      await scenario("consent/tenant/token/session/lease guards and mode restrictions", async () => {
        assert.equal((await save(batch(), { token: "b".repeat(64) })).status, "unavailable");
        assert.equal((await save(batch(), { client: id(99) })).status, "blocked");
        assert.equal((await save(batch(), { session: id(99) })).status, "unavailable");
        for (const statement of [`update public.${invites} set consent_given_at = null`,
          `update public.${invites} set status = 'cancelled'`, `update public.${sessions} set ${owner} = '${id(31)}'`]) {
          await db.exec("savepoint guard"); await db.exec(statement);
          const before = await state(); assert.equal((await save()).status, "unavailable");
          assert.deepEqual(await state(), before); await db.exec("rollback to savepoint guard");
        }
        await db.exec(`update public.test_versions set settings_json = '{"allowBack":false}' where id = '${id(3)}'`);
        await reject(() => save(batch(), { direction: "previous" }));
        await db.exec(`update public.test_versions set settings_json = '{"presentationMode":"one_question"}' where id = '${id(3)}'`);
        await reject(() => save());
        assert.deepEqual(await rows(), []);
      });
      await scenario("empty sections and service-only grants", async () => {
        assert.equal((await save([], { section: id(6), direction: "previous" })).nextSectionIndex, 0);
        for (const role of ["anon", "authenticated"]) {
          await db.exec("savepoint role_test"); await db.exec(`set local role ${role}`);
          await assert.rejects(save(), /permission denied/); await db.exec("rollback to savepoint role_test");
        }
        await db.exec("set local role service_role"); assert.equal((await save()).status, "active"); await db.exec("reset role");
        const verification = await db.exec(read("../supabase/verification/assessment_section_save_v2.sql"));
        assert.equal((verification[0].rows[0] as { permissions_ok: boolean }).permissions_ok, true);
      });
      await db.exec("rollback");
    }
  } finally { await db.close(); }
});
