import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const id = (n: number) => `fa000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = "a".repeat(64);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
test("completion V2 atomically validates saved answers, finishes and starts the next session in both scopes", async t => {
  const db = new PGlite();
  try {
    for (const path of ["./fixtures/session-control-v2.sql", "./fixtures/assessment-test-overview-v2.sql", "./fixtures/assessment-answer-v2.sql",
      "../supabase/migrations/20260811120000_assessment_integrity_controls.sql", "../supabase/migrations/20260827170000_employee_assessment_integrity_controls.sql",
      "../supabase/migrations/20260906120000_assessment_session_lease_v2.sql", "../supabase/migrations/20260906130000_assessment_answer_v2.sql",
      "../supabase/migrations/20260907190000_assessment_completion_v2.sql"]) await db.exec(read(path));
    await db.exec("alter table public.test_sessions add column time_spent_seconds integer; alter table public.employee_assessment_sessions add column time_spent_seconds integer");
    for (const scope of ["candidate", "employee"] as const) {
      const employee = scope === "employee";
      const sessions = employee ? "employee_assessment_sessions" : "test_sessions";
      const answers = employee ? "employee_assessment_answers" : "candidate_answers";
      const owners = employee ? "employee_assessment_participants" : "candidate_applications";
      const invites = employee ? "employee_assessment_invitations" : "invitations";
      const owner = employee ? "participant_id" : "application_id";
      const people = employee ? "employees" : "candidates";
      const person = employee ? "employee_id" : "candidate_id";
      const contexts = employee ? "employee_assessments" : "jobs";
      const context = employee ? "employee_assessment_id" : "job_id";
      await db.exec("begin");
      await db.exec(`insert into public.companies(id) values ('${id(1)}'),('${id(2)}');
        insert into public.${people}(id,company_id) values ('${id(10)}','${id(1)}'),('${id(11)}','${id(2)}');
        insert into public.assessment_packages(id,company_id,title) values ('${id(3)}','${id(1)}','Package');
        insert into public.${contexts}(id,company_id,assessment_package_id,title) values ('${id(12)}','${id(1)}','${id(3)}','Context');
        insert into public.${owners}(id,company_id,${person},${context}) values ('${id(20)}','${id(1)}','${id(10)}','${id(12)}'),('${id(21)}','${id(2)}','${id(11)}','${id(12)}');
        insert into public.${invites}(id,company_id,${owner},${person},${context},token,status,consent_given_at,expires_at)
          values ('${id(40)}','${id(1)}','${id(20)}','${id(10)}','${id(12)}','${token}','started',now(),now()+interval '1 day');
        insert into public.test_versions(id,duration_minutes,status,settings_json) values ('${id(30)}',30,'published','{"presentationMode":"section"}'),('${id(31)}',30,'published','{}'),('${id(32)}',30,'published','{}');
        insert into public.assessment_package_tests values ('${id(3)}','${id(30)}',0),('${id(3)}','${id(31)}',2),('${id(3)}','${id(32)}',1);
        insert into public.${sessions}(id,${owner},${person},test_version_id,status,started_at,deadline_at,active_client_id_hash,active_device_id_hash,lease_expires_at)
          values ('${id(50)}','${id(20)}','${id(10)}','${id(30)}','in_progress',now()-interval '10 seconds',now()+interval '30 minutes',
            encode(sha256(convert_to('${token}:${id(60)}','UTF8')),'hex'),encode(sha256(convert_to('${token}:${id(61)}','UTF8')),'hex'),now()+interval '90 seconds');
        insert into public.${sessions}(id,${owner},${person},test_version_id,status) values
          ('${id(51)}','${id(20)}','${id(10)}','${id(31)}','not_started'),('${id(52)}','${id(20)}','${id(10)}','${id(32)}','not_started'),
          ('${id(53)}','${id(21)}','${id(11)}','${id(30)}','in_progress');
        insert into public.test_sections(id,test_version_id,order_index) values ('${id(70)}','${id(30)}',0),('${id(71)}','${id(30)}',1);
        insert into public.questions(id,section_id,question_type,settings_json) values ('${id(80)}','${id(70)}','open_text','{}'),('${id(81)}','${id(71)}','open_text','{"required":false}');
        insert into public.${answers}(session_id,question_id,answer_text) values ('${id(50)}','${id(80)}','Saved answer');`);
      const finish = async (override: { session?: string; token?: string; scope?: string; client?: string; device?: string } = {}) =>
        (await db.query<{ result: Record<string, unknown> }>("select public.complete_assessment_session_v2($1,$2,$3,$4,$5) result",
          [override.scope ?? scope, override.token ?? token, override.session ?? id(50), override.client ?? id(60), override.device ?? id(61)])).rows[0].result;
      const state = () => db.exec(`select * from public.${sessions} order by id; select * from public.${answers} order by question_id; select * from public.${owners} order by id; select * from public.${invites}`);
      const scenario = async (name: string, run: () => Promise<void>) => t.test(`${scope}: ${name}`, async () => {
        await db.exec("savepoint scenario"); try { await run(); } finally { await db.exec("rollback to savepoint scenario"); }
      });
      await scenario("one RPC finishes without rewriting answers, uses package order, retry never resets timestamps", async () => {
        const beforeAnswers = await db.exec(`select * from public.${answers}`);
        assert.deepEqual(await finish(), { status: "next", nextSessionId: id(52) });
        assert.deepEqual(await db.exec(`select * from public.${answers}`), beforeAnswers);
        const current = (await db.query<Record<string, unknown>>(`select * from public.${sessions} where id = $1`, [id(50)])).rows[0];
        assert.equal(current.status, "completed"); assert.equal(current.active_client_id_hash, null); assert.equal(current.lease_expires_at, null);
        assert.equal(current.submission_reason, employee ? "employee" : "candidate"); assert.ok(Number(current.time_spent_seconds) >= 10);
        const after = await state(); assert.deepEqual(await finish(), { status: "next", nextSessionId: id(52) }); assert.deepEqual(await state(), after);
      });
      await scenario("last test returns private finalization IDs and retries can recover scoring after commit", async () => {
        await db.exec(`update public.${sessions} set status = 'completed' where id in ('${id(51)}','${id(52)}')`);
        assert.deepEqual(await finish(), { status: "ready", ownerId: id(20), invitationId: id(40) });
        const before = await state(); assert.deepEqual(await finish(), { status: "ready", ownerId: id(20), invitationId: id(40) }); assert.deepEqual(await state(), before);
        await db.exec(`update public.${invites} set status = 'completed', expires_at = now()-interval '1 day'`);
        assert.deepEqual(await finish(), { status: "finished" });
      });
      await scenario("empty tests, active successor precedence and cancelled assignments retain existing routing", async () => {
        await db.exec(`delete from public.${answers}; delete from public.questions; delete from public.test_sections`);
        await db.exec(`update public.${sessions} set status = 'in_progress', started_at = now()-interval '2 minutes', deadline_at = now()+interval '28 minutes' where id = '${id(51)}'`);
        const beforeNext = await db.exec(`select * from public.${sessions} where id = '${id(51)}'`);
        assert.deepEqual(await finish(), { status: "next", nextSessionId: id(51) });
        assert.deepEqual(await db.exec(`select * from public.${sessions} where id = '${id(51)}'`), beforeNext);
        await db.exec(`update public.${sessions} set status = 'cancelled' where id in ('${id(51)}','${id(52)}')`);
        assert.deepEqual(await finish(), { status: "next", nextSessionId: null }); // Not ready for scoring.
      });
      await scenario("current/next version eligibility follows candidate package and employee assigned-version semantics", async () => {
        await db.exec(`update public.test_versions set status = 'archived' where id = '${id(30)}'`);
        const before = await state();
        assert.equal((await finish()).status, employee ? "next" : "unavailable");
        if (!employee) assert.deepEqual(await state(), before);
      });
      await scenario("missing required/one-question optional/remediation cannot complete or renew the lease", async () => {
        await db.exec(`delete from public.${answers}`);
        let before = await state(); assert.deepEqual(await finish(), { status: "incomplete", sectionIndex: 0 }); assert.deepEqual(await state(), before);
        await db.exec(`insert into public.${answers}(session_id,question_id,answer_text) values ('${id(50)}','${id(80)}','Saved');
          update public.test_versions set settings_json = '{"presentationMode":"one_question"}' where id = '${id(30)}'`);
        before = await state(); assert.deepEqual(await finish(), { status: "incomplete", sectionIndex: 1 }); assert.deepEqual(await state(), before);
        await db.exec(`insert into public.${answers}(session_id,question_id,answer_json) values ('${id(50)}','${id(81)}','{"skipped":true}')`);
        assert.equal((await finish()).status, "next");
      });
      await scenario("visible remediation is required even when optional; hidden branch does not block", async () => {
        await db.exec(`update public.questions set settings_json = '{"remediationQuestionId":"${id(81)}"}' where id = '${id(80)}';
          update public.${answers} set is_correct = false`);
        const before = await state(); assert.deepEqual(await finish(), { status: "incomplete", sectionIndex: 1 }); assert.deepEqual(await state(), before);
        await db.exec(`update public.${answers} set is_correct = true`); assert.equal((await finish()).status, "next");
      });
      await scenario("real normalizer rejects incomplete structured drafts and accepts valid saved values", async () => {
        for (const type of ["single_choice", "multiple_choice", "forced_choice", "scale", "ordering", "matching"]) {
          await db.exec("savepoint answer_type");
          await db.exec(`update public.questions set question_type = '${type}', settings_json = '{"mode":"most_least","structuredResponseVersion":1}' where id = '${id(80)}';
            insert into public.answer_options(id,question_id,match_target_id) values ('${id(90)}','${id(80)}','${id(92)}'),('${id(91)}','${id(80)}','${id(93)}');
            update public.${answers} set answer_text = null, answer_json = '{}'`);
          assert.deepEqual(await finish(), { status: "incomplete", sectionIndex: 0 }, type);
          const json = type === "multiple_choice" ? { selectedOptionIds: [id(90)] } : type === "forced_choice" ? { mostOptionId: id(90), leastOptionId: id(91) }
            : type === "scale" ? { value: 3 } : type === "ordering" ? { orderedOptionIds: [id(91), id(90)] }
              : type === "matching" ? { matches: [{ optionId: id(90), targetId: id(93) }, { optionId: id(91), targetId: id(92) }] } : {};
          await db.query(`update public.${answers} set answer_json = $1, selected_option_id = $2`, [JSON.stringify(json), type === "single_choice" ? id(90) : null]);
          assert.equal((await finish()).status, "next", type); await db.exec("rollback to savepoint answer_type");
        }
      });
      await scenario("token, tenant, person, context, consent, status and ownership are enforced", async () => {
        for (const override of [{ token: "bad" }, { token: "b".repeat(64) }, { session: id(53) }, { scope: "invalid" },
          { scope: employee ? "candidate" : "employee" }, { client: id(62) }, { device: id(62) }]) {
          const before = await state(); assert.ok(["unavailable", "blocked"].includes(String((await finish(override)).status))); assert.deepEqual(await state(), before);
        }
        for (const [table, where, change] of [[invites,"true","consent_given_at = null"], [invites,"true","status = 'cancelled'"],
          [invites,"true","expires_at = now()-interval '1 second'"], [invites,"true",`company_id = '${id(2)}'`],
          [people,`id = '${id(10)}'`,`company_id = '${id(2)}'`], [contexts,"true",`company_id = '${id(2)}'`],
          [owners,`id = '${id(20)}'`,"status = 'cancelled'"], [sessions,`id = '${id(50)}'`,"status = 'not_started'"]]) {
          await db.exec("savepoint denied"); await db.exec(`update public.${table} set ${change} where ${where}`);
          const before = await state(); assert.equal((await finish()).status, "unavailable", change); assert.deepEqual(await state(), before);
          await db.exec("rollback to savepoint denied");
        }
      });
      await scenario("failure/expiry inside a trigger rolls back completion, successor and lease", async () => {
        await db.exec(`create function public.slow_finish() returns trigger language plpgsql as $$ begin
          if new.status = 'completed' then perform pg_sleep(0.15); end if; return new; end $$;
          create trigger slow_finish before update on public.${sessions} for each row execute function public.slow_finish();`);
        await db.exec(`update public.${sessions} set deadline_at = clock_timestamp()+interval '0.08 seconds' where id = '${id(50)}'`);
        const before = await state(); assert.equal((await finish()).status, "expired"); assert.deepEqual(await state(), before);
        await db.exec(`update public.${sessions} set deadline_at = now()+interval '1 day' where id = '${id(50)}';
          update public.${invites} set expires_at = clock_timestamp()+interval '0.08 seconds'`);
        const beforeToken = await state(); assert.equal((await finish()).status, "unavailable"); assert.deepEqual(await state(), beforeToken);
      });
      await scenario("successor write failure rolls back current completion", async () => {
        await db.exec(`create function public.fail_successor() returns trigger language plpgsql as $$ begin
          if old.status = 'not_started' then raise exception 'synthetic failure'; end if; return new; end $$;
          create trigger fail_successor before update on public.${sessions} for each row execute function public.fail_successor();`);
        const before = await state(); await db.exec("savepoint failed_write"); await assert.rejects(finish(), /synthetic failure/);
        await db.exec("rollback to savepoint failed_write"); assert.deepEqual(await state(), before);
      });
      await scenario("service-only grants and verification, with no direct candidate access", async () => {
        const verification = await db.exec(read("../supabase/verification/assessment_completion_v2.sql"));
        assert.deepEqual(verification[0].rows, [{ signature: "public.complete_assessment_session_v2(text,text,uuid,text,text)", installed: true, permissions_ok: true }]);
        for (const role of ["anon", "authenticated"]) {
          await db.exec("savepoint role_check"); await db.exec(`set local role ${role}`); await assert.rejects(finish(), /permission denied/);
          await db.exec("rollback to savepoint role_check");
        }
        await db.exec("set local role service_role"); assert.equal((await finish()).status, "next"); await db.exec("reset role");
      });
      await db.exec("rollback");
    }
  } finally { await db.close(); }
});
