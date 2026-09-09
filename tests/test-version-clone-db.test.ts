import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { QUESTION_TYPE_VALUES } from "../lib/tests/builder-constants.ts";
import { validateMatchingAnswer, scoreMatchingAnswer, scoreOrderingAnswer } from "../lib/structured-questions.ts";

const id = (n: number) => `fa900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = (name: string) => read(`../supabase/migrations/${name}.sql`);
type Row = Record<string, unknown> & { id: string };
type Receipt = { versionId: string; created: boolean };

test("atomic version clone executes production SQL with real content/revision guards", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(read("./fixtures/builder-save-v2.sql"));
    const initial = migration("20260525000000_initial_schema");
    await db.exec(initial.slice(initial.indexOf("create table if not exists public.test_templates"),
      initial.indexOf("create table if not exists public.assessment_package_tests")));
    const structured = migration("20260822000000_structured_ordering_matching");
    await db.exec(structured.slice(structured.indexOf("alter table public.answer_options"), structured.indexOf("create or replace function")));
    const forced = migration("20260819160000_forced_choice_support");
    await db.exec(forced.slice(0, forced.indexOf("alter table public.questions", forced.indexOf("));") + 3)));
    const scoring = migration("20260823150000_scoring_v2_expand");
    await db.exec(scoring.slice(0, scoring.indexOf("alter table public.test_results")));
    const sjt = migration("20260823210000_sjt_scoring_model");
    await db.exec(sjt.slice(0, sjt.indexOf("-- Preserve")));
    const archive = migration("20260827120000_archive_old_test_versions");
    await db.exec(archive.slice(0, archive.indexOf("alter table public.company_audit_logs")));
    for (const [table, fn] of [["test_versions", "test_version"], ["test_sections", "test_sections"],
      ["questions", "questions"], ["answer_options", "answer_options"]]) {
      await db.exec(`create trigger protect_published_${fn} before insert or update or delete on public.${table}
        for each row execute function public.protect_published_${fn}()`);
    }
    const admin = migration("20260526100000_platform_admin_backoffice");
    await db.exec(admin.slice(admin.indexOf("create table if not exists public.platform_audit_logs"),
      admin.indexOf("create table if not exists public.platform_company_notes")));
    await db.exec(migration("20260908120000_builder_save_v2"));
    await db.exec(migration("20260908140000_builder_save_v2_integration"));
    await db.exec(migration("20260909120000_atomic_test_version_clone"));
    await db.exec(`grant usage on schema public to service_role, authenticated, anon;
      grant select, insert, update, delete on all tables in schema public to service_role;
      insert into public.companies(id) values ('${id(1)}'),('${id(2)}');
      insert into public.profiles values ('${id(3)}'),('${id(4)}'),('${id(5)}'),('${id(6)}'),('${id(7)}');
      insert into public.company_users(company_id,user_id,role) values
        ('${id(1)}','${id(3)}','recruiter'),('${id(1)}','${id(4)}','viewer'),('${id(2)}','${id(5)}','owner');
      insert into public.platform_users(user_id,role) values ('${id(6)}','platform_admin'),('${id(7)}','platform_support');
      insert into public.test_templates(id,company_id,is_system,title) values
        ('${id(10)}','${id(1)}',false,'Company A'),('${id(11)}','${id(2)}',false,'Company B'),('${id(12)}',null,true,'System');
      insert into public.test_versions(id,test_template_id,title,version_number) values
        ('${id(13)}','${id(10)}','Original',3),('${id(14)}','${id(11)}','Other',1),('${id(15)}','${id(12)}','System',1);
      insert into public.test_sections(id,test_version_id,title,order_index,description,time_limit_minutes,settings_json) values
        ('${id(20)}','${id(13)}','Section',0,'<p>Content</p>',10,'{"contentBlocks":[{"id":"${id(600)}","orderIndex":0,"positionIndex":2,"title":"Block","description":"<p>Block</p>"}],"custom":true}'),
        ('${id(21)}','${id(13)}','Empty section',5,null,null,'{}'),
        ('${id(22)}','${id(14)}','Foreign',0,null,null,'{}'),('${id(23)}','${id(15)}','System',0,null,null,'{}');`);
    const types = [...QUESTION_TYPE_VALUES, "single_choice"];
    for (const [index, type] of types.entries()) {
      const questionId = id(30 + index);
      const settings = { required: index !== 3, unknown: { nested: [1, null, "preserved"] }, shuffleOptions: true,
        ...(index === 0 ? { remediationQuestionId: id(31), incorrectFeedback: "Retry", correctFeedback: "Good" } : {}),
        ...(index === 2 ? { min: 1, max: 5 } : {}),
        ...([4, 5].includes(index) ? { structuredResponseVersion: 1, orderingScoringMode: "pairwise", matchingScoringMode: "per_pair" } : {}) };
      const model = index === 6 ? "forced_choice" : index === 7 ? "sjt" : index === 3 ? null : "criterion";
      const options = Array.from({ length: 3 }, (_, optionIndex) => id(100 + index * 3 + optionIndex));
      const config = model === "forced_choice" ? { centering: "none", method: "ipsative", roleWeights: { least: -1, most: 1 },
        statements: options.map(statementId => ({ statementId, scaleId: "stable_scale", keyedDirection: 1 })) }
        : model === "sjt" ? { minPoints: 0, maxPoints: 2,
          options: options.map((optionId, i) => ({ optionId, points: i, dimensionEffects: [{ scaleId: "stable_scale", effect: i }] })) }
        : model ? { strategy: type === "matching" ? "matching" : type === "ordering" ? "ordering" : "single_choice_points", minPoints: 0, maxPoints: 2 } : null;
      await db.query(`insert into public.questions(id,section_id,question_type,text,description,media_url,order_index,
        points,competency_key,difficulty,settings_json,scoring_model,scoring_config_json)
        values($1,$2,$3,$4,'<p>Description</p>','https://example.test/media', $5,2.5,'logical_reasoning','hard',$6,$7,$8)`,
      [questionId, id(20), type, `Question ${index}`, index * 2, JSON.stringify(settings), model, config && JSON.stringify(config)]);
      if (type !== "open_text" && type !== "scale") {
        for (const [i, optionId] of options.entries()) {
          await db.query(`insert into public.answer_options(id,question_id,text,order_index,is_correct,points,
            competency_effect_json,explanation,match_text) values($1,$2,$3,$4::integer,$5,$4::integer,'{"logical_reasoning":-0.5}','Explanation',$6)`,
          [optionId, questionId, `Option ${i}`, i, i === 0, type === "matching" ? `Target ${i}` : null]);
        }
      }
    }
    await db.query(`update public.test_versions set description='<p>Version</p>',instructions='<p>Instructions</p>',duration_minutes=25,
      scoring_type='mixed',settings_json='{"allowBack":true,"contentBlocks":[],"unknown":[false,null]}',
      scoring_schema_version='2.0',assessment_domain='mixed',result_shape='hybrid',scoring_config_json=$1 where id=$2`,
    [JSON.stringify({ schemaVersion: "2.0", assessmentDomain: "mixed", resultShape: "hybrid", scales: [],
      normAssignments: [{ normSetId: id(500), normSetVersion: 2, scaleId: "stable_scale" }],
      overallScore: { sourceType: "criterion", sourceId: id(30) },
      composites: [{ id: "stable_composite", inputs: [{ source: "criterion", scoreId: id(30), weight: 1 },
        { source: "criterion", scoreId: "criterion_total", weight: 2 }, { source: "scale", scoreId: "stable_scale", weight: 1 }] }] }), id(13)]);
    await db.exec(`update public.test_versions set status='published',published_at=now();
      -- A published V2 receipt must not be copied into a fresh draft.
      insert into public.builder_save_state(version_id,last_request_id,last_revision) values ('${id(13)}','${id(501)}',900)`);

    const snapshot = async () => {
      const state: Record<string, unknown> = {};
      for (const table of ["test_versions", "test_sections", "questions", "answer_options", "builder_save_state", "platform_audit_logs"]) {
        state[table] = (await db.query(`select * from public.${table} order by ${table === "builder_save_state" ? "version_id" : "id"}`)).rows;
      }
      return state;
    };
    const clone = async (opts: { template?: number; source?: number; actor?: number; company?: number | null } = {}) => {
      await db.exec("set local role service_role");
      try {
        return (await db.query<{ result: Receipt }>("select public.clone_published_test_version($1,$2,$3,$4) result",
          [id(opts.template ?? 10), id(opts.source ?? 13), id(opts.actor ?? 3), opts.company === null ? null : id(opts.company ?? 1)])).rows[0].result;
      } finally {
        // Failed statements are reset by the caller's savepoint.
        try { await db.exec("reset role"); } catch { /* transaction aborted */ }
      }
    };
    const scenario = async (name: string, run: () => Promise<void>) => t.test(name, async () => {
      await db.exec("begin");
      try { await run(); } finally { await db.exec("rollback"); }
    });
    const rejection = async (run: () => Promise<unknown>, pattern: RegExp) => {
      const before = await snapshot(); await db.exec("savepoint rejection");
      await assert.rejects(run(), pattern);
      await db.exec("rollback to savepoint rejection; reset role");
      assert.deepEqual(await snapshot(), before);
    };
    const rowsFor = async (version: string) => ({
      version: (await db.query<Row>("select * from public.test_versions where id=$1", [version])).rows[0],
      sections: (await db.query<Row>("select * from public.test_sections where test_version_id=$1 order by order_index,id", [version])).rows,
      questions: (await db.query<Row>(`select q.* from public.questions q join public.test_sections s on s.id=q.section_id
        where s.test_version_id=$1 order by s.order_index,q.order_index,q.id`, [version])).rows,
      options: (await db.query<Row>(`select o.* from public.answer_options o join public.questions q on q.id=o.question_id
        join public.test_sections s on s.id=q.section_id where s.test_version_id=$1 order by s.order_index,q.order_index,o.order_index,o.id`, [version])).rows,
    });
    await scenario("all question types, settings, scoring IDs and matching pairs survive a complete clone", async () => {
      for (const systemScope of [false, true]) {
        await db.exec("savepoint structural_copy");
        if (systemScope) await db.exec(`update public.test_templates set company_id=null,is_system=true where id='${id(10)}'`);
        const original = await rowsFor(id(13));
        const receipt = await clone(systemScope ? { actor: 6, company: null } : {}); assert.equal(receipt.created, true);
        const copied = await rowsFor(receipt.versionId);
        assert.deepEqual(new Set(copied.questions.map(q => q.question_type)), new Set(QUESTION_TYPE_VALUES));
        const mapping = new Map<string, string>([[id(13), receipt.versionId]]);
        for (const key of ["sections", "questions", "options"] as const) {
          assert.equal(copied[key].length, original[key].length);
          original[key].forEach((row, i) => {
            assert.notEqual(row.id, copied[key][i].id); mapping.set(row.id, copied[key][i].id);
            if (key === "options") {
              assert.notEqual(row.match_target_id, copied[key][i].match_target_id);
              mapping.set(String(row.match_target_id), String(copied[key][i].match_target_id));
            }
          });
        }
        const normalize = (value: unknown, remap: boolean): unknown => {
          if (typeof value === "string") return remap ? mapping.get(value) ?? value : value;
          if (Array.isArray(value)) return value.map(v => normalize(v, remap));
          if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
            .filter(([key]) => !["created_at", "updated_at", "builder_revision"].includes(key))
            .map(([key, v]) => [key, normalize(v, remap)]));
          return value;
        };
        for (const key of ["sections", "questions", "options"] as const) {
          assert.deepEqual(normalize(copied[key], false), normalize(original[key], true));
        }
        assert.deepEqual(normalize(copied.version, false), normalize({ ...original.version,
          status: "draft", title: copied.version.title, version_number: 4, published_at: null, archived_at: null }, true));
        assert.match(String(copied.version.title), /^v\.4 от \d{2}-\d{2}-\d{4}$/);
        assert.deepEqual(await rowsFor(id(13)), original, "published source is byte-for-byte unchanged");
        assert.equal((await db.query("select * from public.builder_save_state where version_id=$1", [receipt.versionId])).rows.length, 0);
        for (const structuredType of ["matching", "ordering"]) {
          const q = copied.questions.find(q => q.question_type === structuredType)!;
          const options = copied.options.filter(o => o.question_id === q.id).map(o => ({ id: o.id, matchTargetId: String(o.match_target_id), orderIndex: Number(o.order_index) }));
          if (structuredType === "matching") {
            const answer = { matches: options.map(o => ({ optionId: o.id, targetId: o.matchTargetId })) };
            assert.equal(validateMatchingAnswer(answer, options).ok, true);
            assert.equal(validateMatchingAnswer({ matches: [{ optionId: id(115), targetId: id(999) }] }, options).ok, false);
            assert.equal(scoreMatchingAnswer(options, answer, "per_pair"), 1);
          } else {
            assert.equal(scoreOrderingAnswer(options.map(o => o.id), { orderedOptionIds: options.map(o => o.id) }, "pairwise"), 1);
          }
        }
        await db.query("update public.test_versions set description='Legacy edit' where id=$1", [receipt.versionId]);
        const saved = await db.query<{ result: { revision: string } }>("select public.read_builder_snapshot_v2($1,$2,$3,$4) result",
          [id(10), receipt.versionId, id(systemScope ? 6 : 3), systemScope ? null : id(1)]);
        assert.ok(BigInt(saved.rows[0].result.revision) > BigInt(0), "new clone also loads through V2");
        await db.exec("rollback to savepoint structural_copy");
      }
    });
    await scenario("repeat and queued calls return the existing draft; system audit is atomic and singular", async () => {
      const opts = { template: 12, source: 15, actor: 6, company: null };
      const first = await clone(opts); const after = await snapshot();
      const repeats = await Promise.all([clone(opts), clone(opts)]);
      for (const receipt of repeats) assert.deepEqual(receipt, { versionId: first.versionId, created: false });
      assert.deepEqual(await snapshot(), after);
      const audit = (await db.query<Row>("select * from public.platform_audit_logs")).rows;
      assert.equal(audit.length, 1); assert.equal(audit[0].target_id, first.versionId);
      assert.equal(audit[0].actor_role, "platform_admin");
    });
    await scenario("scope, tenant, active company/membership and platform role are rechecked", async () => {
      for (const opts of [{ actor: 4 }, { actor: 5 }, { actor: 999 }, { company: 2 }, { company: null },
        { template: 11 }, { template: 999 }, { source: 14 }, { source: 15 }, { source: 999 },
        { template: 12, source: 15 }, { template: 12, source: 15, company: null },
        { template: 12, source: 15, company: null, actor: 7 }]) {
        await rejection(() => clone(opts), /TEST_CLONE_/);
      }
      for (const sql of ["update public.companies set status='suspended'", "update public.company_users set status='inactive'",
        "update public.test_templates set status='archived'", "update public.platform_users set status='inactive'"]) {
        await db.exec("savepoint inactive"); await db.exec(sql);
        await rejection(() => clone(sql.includes("platform") ? { template: 12, source: 15, company: null, actor: 6 } : {}), /TEST_CLONE_/);
        await db.exec("rollback to savepoint inactive");
      }
      for (const role of ["owner", "admin", "recruiter", "super_admin"]) {
        await db.exec("savepoint manager"); await db.query("update public.company_users set role=$1 where user_id=$2", [role, id(3)]);
        assert.equal((await clone()).created, true); await db.exec("rollback to savepoint manager");
      }
      await db.exec("update public.platform_users set role='platform_owner'");
      assert.equal((await clone({ template: 12, source: 15, company: null, actor: 6 })).created, true);
    });
    await scenario("draft/archived sources fail, and next version follows the maximum including archived versions", async () => {
      await db.exec(`insert into public.test_versions(id,test_template_id,version_number,title) values ('${id(16)}','${id(10)}',9,'Draft')`);
      await rejection(() => clone({ source: 16 }), /SOURCE_NOT_PUBLISHED/);
      await db.exec(`update public.test_versions set status='archived',archived_at=now() where id='${id(16)}'`);
      await rejection(() => clone({ source: 16 }), /SOURCE_NOT_PUBLISHED/);
      const receipt = await clone(); assert.equal((await rowsFor(receipt.versionId)).version.version_number, 10);
    });
    await scenario("errors at every write stage roll back all content, revision state and audit", async () => {
      for (const table of ["test_versions", "test_sections", "questions", "answer_options", "platform_audit_logs"]) {
        await db.exec("savepoint injection");
        await db.exec(`create function public.fail_clone_write() returns trigger language plpgsql as $$
          begin raise exception 'injected clone failure'; end; $$;
          create trigger zz_fail_clone_write after insert on public.${table}
          for each row execute function public.fail_clone_write()`);
        await rejection(() => clone(table === "platform_audit_logs" ? { template: 12, source: 15, company: null, actor: 6 } : {}), /injected clone failure/);
        await db.exec("rollback to savepoint injection");
      }
      assert.equal((await clone()).created, true, "retry succeeds after rollback, including mapping-table cleanup");
    });
    await scenario("foreign remediation and scoring option references fail closed", async () => {
      // Historical corruption is injected by the local fixture owner before cloning.
      for (const change of [
        `settings_json=jsonb_set(settings_json,'{remediationQuestionId}','"${id(999)}"') where id='${id(30)}'`,
        `scoring_config_json=jsonb_set(scoring_config_json,'{options,0,optionId}','"${id(100)}"') where id='${id(37)}'`,
        `scoring_config_json=jsonb_set(scoring_config_json,'{statements,0,statementId}','"${id(100)}"') where id='${id(36)}'`,
      ]) {
        await db.exec("savepoint corruption; alter table public.questions disable trigger user");
        await db.exec(`update public.questions set ${change}`);
        await db.exec("alter table public.questions enable trigger user");
        await rejection(() => clone(), /TEST_CLONE_INVALID_REFERENCE/);
        await db.exec("rollback to savepoint corruption");
      }
    });
    await scenario("browser roles cannot invoke the RPC even with forged actor arguments", async () => {
      for (const role of ["anon", "authenticated"]) {
        await rejection(async () => {
          await db.exec(`set local role ${role}`);
          await db.query("select public.clone_published_test_version($1,$2,$3,$4)", [id(10), id(13), id(3), id(1)]);
        }, /permission denied for function clone_published_test_version/);
      }
    });
    await scenario("100-question set-based clone returns only a small receipt", async () => {
      await db.exec(`insert into public.test_templates(id,company_id,title) values ('${id(90)}','${id(1)}','Benchmark');
        insert into public.test_versions(id,test_template_id,title) values ('${id(91)}','${id(90)}','Benchmark');
        insert into public.test_sections(test_version_id,title,order_index)
          select '${id(91)}','Section '||n,n from generate_series(1,5) n;
        insert into public.questions(section_id,question_type,text,order_index)
          select s.id,'single_choice',repeat('Large text ',200),n from public.test_sections s
          cross join generate_series(1,20) n where s.test_version_id='${id(91)}';
        insert into public.answer_options(question_id,text,order_index,is_correct,points)
          select q.id,repeat('Option ',100),n,n=1,case when n=1 then 1 else 0 end from public.questions q
          join public.test_sections s on s.id=q.section_id cross join generate_series(1,4) n
          where s.test_version_id='${id(91)}';
        update public.test_versions set status='published',published_at=now() where id='${id(91)}'`);
      const started = performance.now(); const receipt = await clone({ template: 90, source: 91 });
      t.diagnostic(`Local PGlite clone (5 sections / 100 questions / 400 options): ${Math.round(performance.now() - started)} ms (not staging SLA)`);
      const content = await rowsFor(receipt.versionId);
      assert.equal(content.sections.length, 5); assert.equal(content.questions.length, 100); assert.equal(content.options.length, 400);
      assert.ok(JSON.stringify(receipt).length < 100);
      assert.equal((await db.query("select * from pg_tables where schemaname like 'pg_temp%' and tablename='builder_clone_ids'")).rows.length, 0);
    });
    await scenario("read-only deployment verification passes", async () => {
      const checks = await db.exec(read("../supabase/verification/atomic_test_version_clone.sql"));
      for (const result of checks) for (const row of result.rows as { check_name: string; passed: boolean }[]) {
        assert.equal(row.passed, true, row.check_name);
      }
    });
  } finally { await db.close(); }
});
