import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const id = (n: number) => `fa800000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = (name: string) => read(`../supabase/migrations/${name}.sql`);
const blank = () => ({ version: null as Record<string, unknown> | null,
  sections: [] as Record<string, unknown>[], questions: [] as Record<string, unknown>[],
  options: [] as Record<string, unknown>[], deletedSections: [] as string[],
  deletedQuestions: [] as string[], deletedOptions: [] as string[] });
const section = (n = 20) => ({ id: id(n), title: "Section", description: null, order_index: 1,
  time_limit_minutes: null, settings_json: { contentBlocks: [] } });
const question = (n = 30, parent = 20) => ({ id: id(n), section_id: id(parent), question_type: "single_choice",
  text: "Question", description: null, order_index: 1, points: 1, competency_key: null,
  difficulty: null, settings_json: { required: true } });
const option = (n = 40, parent = 30) => ({ id: id(n), question_id: id(parent), text: "Option", order_index: 1,
  points: 1, is_correct: true, match_text: null, explanation: null, competency_effect_json: {} });

test("builder V2 runs real migration with publication guards and atomic revision protocol", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(read("./fixtures/builder-save-v2.sql"));
    const initial = migration("20260525000000_initial_schema");
    await db.exec(initial.slice(initial.indexOf("create table if not exists public.test_templates"),
      initial.indexOf("create table if not exists public.assessment_package_tests")));
    const structured = migration("20260822000000_structured_ordering_matching");
    await db.exec(structured.slice(structured.indexOf("alter table public.answer_options"),
      structured.indexOf("create or replace function")));
    await db.exec(`alter table public.test_versions add column archived_at timestamptz,
      add column scoring_schema_version integer default 2, add column scoring_config_json jsonb default '{"kept":true}';
      alter table public.questions add column scoring_model text default 'kept-model',
      add column scoring_config_json jsonb default '{"kept":true}'`);
    const archive = migration("20260827120000_archive_old_test_versions");
    await db.exec(archive.slice(archive.indexOf("create or replace function public.protect_published_test_version()"),
      archive.indexOf("alter table public.company_audit_logs")));
    for (const [table, fn] of [["test_versions", "test_version"], ["test_sections", "test_sections"],
      ["questions", "questions"], ["answer_options", "answer_options"]]) {
      await db.exec(`create trigger protect_published_${fn} before insert or update or delete on public.${table}
        for each row execute function public.protect_published_${fn}()`);
    }
    await db.exec(migration("20260908120000_builder_save_v2"));
    const adminSchema = migration("20260526100000_platform_admin_backoffice");
    await db.exec(adminSchema.slice(adminSchema.indexOf("create table if not exists public.platform_audit_logs"),
      adminSchema.indexOf("create table if not exists public.platform_company_notes")));
    await db.exec(migration("20260908140000_builder_save_v2_integration"));
    await db.exec("grant usage on schema public to service_role; grant select, insert, update, delete on all tables in schema public to service_role");
    await db.exec(`insert into public.companies(id) values ('${id(1)}'), ('${id(2)}');
      insert into public.profiles values ('${id(3)}'), ('${id(4)}'), ('${id(5)}'), ('${id(6)}');
      insert into public.company_users(company_id,user_id,role) values
        ('${id(1)}','${id(3)}','recruiter'), ('${id(1)}','${id(4)}','viewer'), ('${id(2)}','${id(5)}','owner');
      insert into public.platform_users(user_id,role) values ('${id(6)}','platform_admin');
      insert into public.test_templates(id,company_id,is_system,title) values
        ('${id(10)}','${id(1)}',false,'Company A'), ('${id(11)}','${id(2)}',false,'Company B'), ('${id(12)}',null,true,'System');
      insert into public.test_versions(id,test_template_id,title,settings_json) values
        ('${id(13)}','${id(10)}','Draft','{"unknown":"preserved","allowBack":true}'),
        ('${id(14)}','${id(11)}','Other','{}'), ('${id(15)}','${id(12)}','System','{}');
      insert into public.test_sections(id,test_version_id,title,settings_json) values
        ('${id(20)}','${id(13)}','Section','{"unknown":"preserved"}'),
        ('${id(21)}','${id(13)}','Section 2','{}'), ('${id(22)}','${id(14)}','Foreign','{}'), ('${id(23)}','${id(15)}','System','{}');
      insert into public.questions(id,section_id,question_type,text,settings_json) values
        ('${id(30)}','${id(20)}','single_choice','Question','{"unknown":"preserved","minSelections":1,"remediationQuestionId":"${id(31)}"}'),
        ('${id(31)}','${id(20)}','open_text','Question 2','{}'), ('${id(32)}','${id(22)}','single_choice','Foreign','{}'),
        ('${id(33)}','${id(23)}','single_choice','System','{}');
      insert into public.answer_options(id,question_id,text) values
        ('${id(40)}','${id(30)}','Option'), ('${id(41)}','${id(30)}','Option 2'),
        ('${id(42)}','${id(32)}','Foreign'), ('${id(43)}','${id(33)}','System');`);
    const revision = async (version = 13) => (await db.query<{ revision: string }>(
      "select builder_revision::text revision from public.test_versions where id=$1", [id(version)])).rows[0].revision;
    const snapshot = async () => {
      const state: Record<string, unknown> = {};
      for (const table of ["test_versions", "test_sections", "questions", "answer_options", "builder_save_state"]) {
        state[table] = (await db.query(`select * from public.${table} order by ${table === "builder_save_state" ? "version_id" : "id"}`)).rows;
      }
      return state;
    };
    const save = async (delta: unknown, opts: { expected?: string; request?: number; actor?: number; company?: number | null; template?: number; version?: number } = {}) => {
      const result = await db.query<{ result: { revision: string; savedAt: string; replayed: boolean } }>(
        "select public.save_builder_delta_v2($1,$2,$3,$4,$5,$6,$7) result",
        [id(opts.template ?? 10), id(opts.version ?? 13), id(opts.actor ?? 3), opts.company === null ? null : id(opts.company ?? 1),
          opts.expected ?? await revision(opts.version), id(opts.request ?? 100), JSON.stringify(delta)]);
      return result.rows[0].result;
    };
    const rejection = async (run: () => Promise<unknown>, pattern?: RegExp) => {
      const before = await snapshot();
      await db.exec("savepoint rejection");
      if (pattern) await assert.rejects(run(), pattern);
      else await assert.rejects(run());
      await db.exec("rollback to savepoint rejection");
      assert.deepEqual(await snapshot(), before, "failed statement must roll back document, revision and receipt");
    };
    const scenario = async (name: string, run: () => Promise<void>) => t.test(name, async () => {
      await db.exec("begin");
      try { await run(); } finally { await db.exec("rollback"); }
    });
    await scenario("one option changes only that row and one revision; matching target and scoring metadata survive", async () => {
      await db.exec(`create temporary table builder_writes(entity text, entity_id uuid);
        create function public.record_builder_write() returns trigger language plpgsql as $$ begin
          insert into builder_writes values (tg_table_name,new.id); return new; end; $$`);
      for (const table of ["test_versions", "test_sections", "questions", "answer_options"]) {
        await db.exec(`create trigger record_builder_write after update on public.${table}
          for each row execute function public.record_builder_write()`);
      }
      const before = await snapshot();
      const delta = blank(); delta.options = [{ ...option(), text: "Changed" }];
      const initial = await revision(); const result = await save(delta);
      assert.equal(result.revision, String(BigInt(initial) + BigInt(1)));
      const after = await snapshot();
      assert.deepEqual(after.questions, before.questions);
      assert.deepEqual(after.test_sections, before.test_sections);
      const optionsBefore = before.answer_options as Record<string, unknown>[];
      const optionsAfter = after.answer_options as Record<string, unknown>[];
      assert.deepEqual(optionsAfter.slice(1), optionsBefore.slice(1));
      assert.equal(optionsAfter[0].match_target_id, optionsBefore[0].match_target_id);
      assert.equal(optionsAfter[0].text, "Changed");
      assert.deepEqual(Object.keys(result).sort(), ["replayed", "revision", "savedAt"]);
      assert.deepEqual((await db.query("select * from builder_writes order by entity")).rows,
        [{ entity: "answer_options", entity_id: id(40) }, { entity: "test_versions", entity_id: id(13) }]);
    });
    await scenario("two editors using the same base revision cannot overwrite each other", async () => {
      const expected = await revision(); const delta = blank(); delta.options = [option()];
      await save(delta, { expected });
      delta.options[0].text = "Lost edit";
      await rejection(() => save(delta, { expected, request: 101 }), /revision conflict/);
    });
    await scenario("lost ACK replay is idempotent; reusing an ID with different payload or actor fails", async () => {
      const expected = await revision(); const delta = blank(); delta.options = [option()];
      const first = await save(delta, { expected }); const before = await snapshot();
      assert.deepEqual(await save(delta, { expected }), { ...first, replayed: true });
      assert.deepEqual(await snapshot(), before);
      delta.options[0].text = "Other";
      await rejection(() => save(delta, { expected }), /request ID reused/);
      delta.options = [option()];
      await db.exec(`update public.company_users set role='admin' where user_id='${id(4)}'`);
      await rejection(() => save(delta, { expected, actor: 4 }), /request ID reused/);
      await save(delta, { request: 101 });
      await rejection(() => save(delta, { expected }), /revision conflict/);
    });
    await scenario("failure after insert/update/delete rolls back the entire batch and enrollment", async () => {
      const delta = blank(); delta.sections = [section(24)]; delta.questions = [question(34, 24)];
      delta.options = [option(44, 34)]; delta.deletedSections = [id(20)];
      delta.version = { title: "Changed", description: null, instructions: null, duration_minutes: 10,
        scoring_type: "invalid", settings_json: {} };
      await rejection(() => save(delta), /check constraint/);
      await db.exec(`create function public.reject_builder_delete() returns trigger language plpgsql as $$ begin
        raise exception 'synthetic delete failure'; end; $$;
        create trigger reject_builder_delete before delete on public.answer_options for each row execute function public.reject_builder_delete()`);
      delta.version = null;
      await rejection(() => save(delta), /synthetic delete failure/);
    });
    await scenario("same-version moves happen before parent deletion and preserve all surviving child IDs", async () => {
      const delta = blank(); delta.questions = [question(30, 21)]; delta.deletedSections = [id(20)];
      await save(delta);
      assert.equal((await db.query("select id from public.questions where id=$1", [id(30)])).rows.length, 1);
      assert.equal((await db.query("select id from public.answer_options where question_id=$1", [id(30)])).rows.length, 2);
      assert.equal((await db.query("select id from public.questions where id=$1", [id(31)])).rows.length, 0);
    });
    await scenario("unknown settings, scoring columns and media survive; removed managed settings really disappear", async () => {
      await db.query("update public.questions set media_url=$1 where id=$2", ["/synthetic-media.svg", id(30)]);
      const delta = blank(); delta.sections = [section()]; delta.questions = [question()];
      delta.version = { title: "Saved", description: "Description", instructions: null, duration_minutes: 20,
        scoring_type: "points", settings_json: { allowBack: false, presentationMode: "section", captureQuestionTime: true } };
      await save(delta);
      const q = (await db.query<Record<string, unknown>>("select * from public.questions where id=$1", [id(30)])).rows[0];
      assert.deepEqual(q.settings_json, { unknown: "preserved", minSelections: 1, required: true });
      assert.equal(q.scoring_model, "kept-model"); assert.deepEqual(q.scoring_config_json, { kept: true });
      assert.equal(q.media_url, "/synthetic-media.svg");
      const v = (await db.query<Record<string, unknown>>("select * from public.test_versions where id=$1", [id(13)])).rows[0];
      assert.deepEqual(v.settings_json, { unknown: "preserved", allowBack: false, presentationMode: "section", captureQuestionTime: true });
      assert.equal(v.scoring_schema_version, 2); assert.deepEqual(v.scoring_config_json, { kept: true });
      assert.deepEqual((await db.query<{ settings_json: unknown }>("select settings_json from public.test_sections where id=$1", [id(20)])).rows[0].settings_json,
        { unknown: "preserved", contentBlocks: [] });
    });
    await scenario("foreign entity IDs and parents are rejected, including service-role deletes and reparenting", async () => {
      for (const key of ["sections", "questions", "options"] as const) {
        const delta = blank(); delta[key] = [key === "sections" ? section(22) : key === "questions" ? question(32) : option(42)];
        await rejection(() => save(delta), /another version/);
      }
      for (const [key, value] of [["deletedSections", 22], ["deletedQuestions", 32], ["deletedOptions", 42]] as const) {
        const delta = blank(); delta[key] = [id(value)]; await rejection(() => save(delta), /another version/);
      }
      for (const parent of [22, 99]) {
        const delta = blank(); delta.questions = [question(30, parent)]; await rejection(() => save(delta), /parent unavailable/);
      }
      for (const parent of [32, 99]) {
        const delta = blank(); delta.options = [option(40, parent)]; await rejection(() => save(delta), /parent unavailable/);
      }
      const delta = blank(); delta.questions = [question()]; delta.deletedSections = [id(20)];
      await rejection(() => save(delta), /parent unavailable/);
      for (const key of ["deletedSections", "deletedQuestions", "deletedOptions"] as const) {
        const missing = blank(); missing[key] = [id(99)];
        await rejection(() => save(missing), /deleted entity unavailable/);
      }
    });
    await scenario("malformed/duplicate/contradictory entities and protected fields fail without mutation", async () => {
      const duplicate = blank(); duplicate.options = [option(), option()];
      const contradictory = blank(); contradictory.options = [option()]; contradictory.deletedOptions = [id(40)];
      const protectedField = blank(); protectedField.questions = [{ ...question(), scoring_model: "tampered" }];
      const protectedSettings = blank(); protectedSettings.questions = [{ ...question(), settings_json: { minSelections: 2 } }];
      const missing = blank(); missing.options = [{ id: id(40), text: "Incomplete" }];
      for (const delta of [null, {}, [], { ...blank(), options: null }, { ...blank(), version: [] },
        { ...blank(), unexpected: true }, duplicate, contradictory, protectedField, protectedSettings, missing,
        { ...blank(), deletedQuestions: [id(30), id(30)] }, { ...blank(), deletedOptions: [null] }]) {
        await rejection(() => save(delta));
      }
    });
    await scenario("company and platform authorization is checked again, including active status", async () => {
      for (const opts of [{ actor: 4 }, { actor: 5 }, { company: 2 }, { company: null }, { template: 11 },
        { template: 12, version: 15 }, { template: 12, version: 15, company: null }]) {
        await rejection(() => save(blank(), opts));
      }
      await db.exec(`update public.company_users set status='disabled' where user_id='${id(3)}'`);
      await rejection(() => save(blank()), /Cannot manage/);
      await db.exec(`update public.company_users set status='active' where user_id='${id(3)}';
        update public.companies set status='suspended' where id='${id(1)}'`);
      await rejection(() => save(blank()), /Company unavailable/);
      await db.exec(`update public.companies set status='active' where id='${id(1)}';
        update public.test_templates set status='archived' where id='${id(10)}'`);
      await rejection(() => save(blank()), /target unavailable/);
      const delta = blank(); delta.options = [option(43, 33)];
      await save(delta, { actor: 6, company: null, template: 12, version: 15 });
      await db.exec(`update public.platform_users set role='platform_support' where user_id='${id(6)}'`);
      await rejection(() => save(delta, { actor: 6, company: null, template: 12, version: 15 }), /Cannot manage/);
    });
    await scenario("legacy content writes bump the revision; enrollment fences stale legacy save AND publish", async () => {
      let before = await revision();
      for (const statement of [
        `update public.answer_options set text='Legacy' where id='${id(40)}'`,
        `update public.questions set text='Legacy question' where id='${id(30)}'`,
        `update public.test_sections set title='Legacy section' where id='${id(20)}'`,
        `update public.test_versions set title='Legacy version', builder_revision=0 where id='${id(13)}'`,
      ]) {
        await db.exec(statement); assert.equal(await revision(), String(BigInt(before) + BigInt(1))); before = await revision();
      }
      await save(blank());
      for (const statement of [
        `update public.answer_options set text='Stale' where id='${id(40)}'`,
        `delete from public.questions where id='${id(30)}'`,
        `insert into public.test_sections(id,test_version_id,title) values ('${id(90)}','${id(13)}','Stale')`,
        `update public.test_versions set title='Stale' where id='${id(13)}'`,
        `update public.test_versions set status='published' where id='${id(13)}'`,
      ]) await rejection(() => db.exec(statement), /revision-checked batch/);
    });
    await scenario("published and archived guards remain compatible with narrow archive/revert paths", async () => {
      await db.exec(`update public.test_versions set status='published' where id='${id(13)}'`);
      await rejection(() => save(blank()), /must be a draft/);
      await rejection(() => db.exec(`update public.answer_options set text='Forbidden' where id='${id(40)}'`), /Only draft/);
      const publishedRevision = await revision();
      await db.query("select set_config('talora.archive_test_version_id',$1,true)", [id(13)]);
      await db.exec(`update public.test_versions set status='archived', archived_at=now() where id='${id(13)}'`);
      assert.equal(await revision(), publishedRevision);
      await rejection(() => save(blank()), /must be a draft/);
      await rejection(() => db.exec(`update public.answer_options set text='Forbidden' where id='${id(40)}'`), /Only draft/);
      await db.exec(`update public.test_versions set status='published' where id='${id(15)}'`);
      await db.query("select set_config('talora.revert_system_test_version_id',$1,true)", [id(15)]);
      await db.exec(`update public.test_versions set status='draft', published_at=null where id='${id(15)}'`);
      await save(blank(), { actor: 6, company: null, template: 12, version: 15 });
    });
    await scenario("anon/authenticated cannot invoke RPC, forge the fence, or touch revision through helpers", async () => {
      const verification = await db.exec(read("../supabase/verification/builder_save_v2.sql"));
      const checks = verification[0].rows as { check_name: string; passed: boolean }[];
      assert.equal(checks.length, 6);
      for (const check of checks) assert.equal(check.passed, true, check.check_name);
      for (const role of ["anon", "authenticated"]) {
        const rights = (await db.query<{ rpc: boolean; helper: boolean; state: boolean }>(`select
          has_function_privilege($1,'public.save_builder_delta_v2(uuid,uuid,uuid,uuid,bigint,uuid,jsonb)','execute') rpc,
          has_function_privilege($1,'public.touch_builder_content_revision(uuid)','execute') helper,
          has_table_privilege($1,'public.builder_save_state','insert') state`, [role])).rows[0];
        assert.deepEqual(rights, { rpc: false, helper: false, state: false });
      }
      await db.exec("set local role service_role");
      const delta = blank(); delta.options = [option()];
      assert.equal((await save(delta)).replayed, false);
    });
    const readSnapshot = async (opts: { version?: number; template?: number; actor?: number; company?: number | null } = {}) =>
      (await db.query<{ result: { revision: string; version: { status: string }; sections: { questions: { answer_options: unknown[] }[] }[];
        receipt: { client_payload_hash: string; last_revision: string } | null } }>(
        "select public.read_builder_snapshot_v2($1,$2,$3,$4) result",
        [id(opts.template ?? 10), id(opts.version ?? 13), id(opts.actor ?? 3), opts.company === null ? null : id(opts.company ?? 1)])).rows[0].result;
    const publish = async (expected: string, opts: { version?: number; template?: number; actor?: number; company?: number | null; request?: number } = {}) =>
      (await db.query<{ result: { published: boolean; revision: string } }>(
        "select public.publish_builder_version_v2($1,$2,$3,$4,$5,$6,$7) result",
        [id(opts.template ?? 10), id(opts.version ?? 13), id(opts.actor ?? 3), opts.company === null ? null : id(opts.company ?? 1),
          expected, id(opts.request ?? 110), "Published v1"])).rows[0].result;
    await scenario("V2 snapshot is scoped, complete, read-only and carries string revisions", async () => {
      const before = await snapshot(), data = await readSnapshot();
      assert.equal(data.revision, await revision()); assert.equal(data.sections.length, 2);
      assert.equal(data.sections[0].questions[0].answer_options.length, 2);
      assert.equal(data.receipt, null); assert.deepEqual(await snapshot(), before);
      await rejection(() => readSnapshot({ actor: 4 }), /Cannot manage/);
      await rejection(() => readSnapshot({ template: 11, version: 14 }), /scope mismatch/);
      const system = await readSnapshot({ actor: 6, company: null, template: 12, version: 15 });
      assert.equal(system.sections.length, 1);
    });
    await scenario("wrapper persists browser ACK hash in same transaction and rejects ID reuse", async () => {
      const delta = blank(); delta.options = [option()]; const expected = await revision();
      const commit = async (hash = "a".repeat(64)) => db.query(
        "select public.commit_builder_delta_v2($1,$2,$3,$4,$5,$6,$7,$8)",
        [id(10), id(13), id(3), id(1), expected, id(100), hash, JSON.stringify(delta)]);
      await commit(); const receipt = (await readSnapshot()).receipt!;
      assert.equal(receipt.client_payload_hash, "a".repeat(64)); assert.equal(typeof receipt.last_revision, "string");
      const before = await snapshot(); await commit(); assert.deepEqual(await snapshot(), before);
      await rejection(() => commit("b".repeat(64)), /request ID reused/);
    });
    await scenario("publish rejects edits after validation, publishes enrolled revision once, and is replay-safe", async () => {
      await db.exec(`update public.test_versions set duration_minutes=10 where id='${id(13)}'`);
      const expected = (await readSnapshot()).revision;
      await db.exec(`update public.answer_options set text='Race' where id='${id(40)}'`);
      await rejection(() => publish(expected), /revision conflict/);
      const saved = await save(blank()); const before = await snapshot();
      const result = await publish(saved.revision); assert.equal(result.published, true);
      assert.equal(result.revision, String(BigInt(saved.revision) + BigInt(1)));
      assert.equal((await readSnapshot()).version.status, "published");
      assert.deepEqual((await snapshot()).answer_options, before.answer_options);
      const published = await snapshot(); assert.deepEqual(await publish(saved.revision), result);
      assert.deepEqual(await snapshot(), published);
      await rejection(() => publish(saved.revision, { request: 111 }), /revision conflict/);
      await rejection(() => save(blank()), /must be a draft/);
    });
    await scenario("system publication and audit commit or roll back together", async () => {
      await db.exec(`update public.test_versions set duration_minutes=10 where id='${id(15)}'`);
      const opts = { actor: 6, company: null, template: 12, version: 15 };
      const expected = await revision(15);
      await db.exec(`create function public.reject_builder_audit() returns trigger language plpgsql as $$ begin
        raise exception 'synthetic audit failure'; end; $$;
        create trigger reject_builder_audit before insert on public.platform_audit_logs for each row execute function public.reject_builder_audit()`);
      await rejection(() => publish(expected, opts), /synthetic audit failure/);
      await db.exec("drop trigger reject_builder_audit on public.platform_audit_logs");
      await publish(expected, opts); await publish(expected, opts);
      const audit = (await db.query<{ action: string; metadata_json: unknown }>("select action,metadata_json from public.platform_audit_logs")).rows;
      assert.deepEqual(audit, [{ action: "publish_system_test_version", metadata_json: { templateId: id(12) } }]);
    });
    await scenario("all integration RPCs remain service-only", async () => {
      const verification = await db.exec(read("../supabase/verification/builder_save_v2_integration.sql"));
      for (const result of verification.slice(0, 2)) for (const row of result.rows as { check_name: string; passed: boolean }[]) {
        assert.equal(row.passed, true, row.check_name);
      }
      for (const signature of ["lock_builder_version_v2(uuid,uuid,uuid,uuid)", "read_builder_snapshot_v2(uuid,uuid,uuid,uuid)",
        "commit_builder_delta_v2(uuid,uuid,uuid,uuid,bigint,uuid,text,jsonb)", "publish_builder_version_v2(uuid,uuid,uuid,uuid,bigint,uuid,text)"]) {
        for (const role of ["anon", "authenticated", "service_role"]) {
          const rights = (await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2,'execute') allowed", [role, `public.${signature}`])).rows[0];
          assert.equal(rights.allowed, role === "service_role");
        }
      }
    });
    await scenario("explicit root draft deletion retains existing deletion semantics after enrollment", async () => {
      await save(blank());
      await db.query("delete from public.test_versions where id=$1", [id(13)]);
      assert.equal((await db.query("select * from public.builder_save_state where version_id=$1", [id(13)])).rows.length, 0);
      assert.equal((await db.query("select * from public.test_sections where test_version_id=$1", [id(13)])).rows.length, 0);
    });
    await scenario("terminal draft archive is allowed but cannot smuggle a metadata change past the fence", async () => {
      await save(blank());
      await rejection(() => db.query("update public.test_versions set status='archived', title='Stale' where id=$1", [id(13)]), /revision-checked batch/);
      await db.query("update public.test_versions set status='archived' where id=$1", [id(13)]);
      assert.equal((await readSnapshot()).version.status, "archived");
      await rejection(() => save(blank()), /must be a draft/);
    });
  } finally { await db.close(); }
});
