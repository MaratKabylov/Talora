// Offline PERF-012 screening only. Never reads env or connects to a remote DB.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = new URL("../", import.meta.url);
const migration = async (name) => readFile(new URL(`supabase/migrations/${name}.sql`, root), "utf8");
const uuid = (n) => `fa120000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const literal = (n) => `'${uuid(n)}'::uuid`;
const sqlId = (expr) => `('fa120000-0000-4000-8000-' || lpad((${expr})::text, 12, '0'))::uuid`;

// Experimental DDL, deliberately outside supabase/migrations. No deployment approval implied.
export const candidates = [
  ["perf012_sections_parent_order", "test_sections", "test_version_id, order_index"],
  ["perf012_questions_parent_order", "questions", "section_id, order_index"],
  ["perf012_options_parent_order", "answer_options", "question_id, order_index"],
  ["perf012_jobs_date", "jobs", "company_id, updated_at desc, id asc"],
  ["perf012_applications_date", "candidate_applications", "company_id, created_at desc, id asc"],
  ["perf012_applications_job_date", "candidate_applications", "company_id, job_id, created_at desc, id asc"],
  ["perf012_applications_fit", "candidate_applications", "company_id, job_id, fit_score desc nulls last, id asc"],
  ["perf012_participants_date", "employee_assessment_participants", "company_id, employee_assessment_id, created_at desc, id asc"],
  ["perf012_participants_fit", "employee_assessment_participants", "company_id, employee_assessment_id, fit_score desc nulls last, id asc"],
].map(([name, table, columns]) => ({ name, table, sql: `create index ${name} on public.${table} (${columns})` }));

export async function setupFixture(db) {
  // Exact CREATE TABLE statements and their constraints, not the complete migration history.
  // Auth, RLS, publication/revision triggers, later wide columns and PostgREST are absent.
  const initial = await migration("20260525000000_initial_schema");
  const employee = await migration("20260607100000_employee_assessments");
  await db.exec("set timezone='UTC'; create schema auth; create table auth.users(id uuid primary key)");
  for (const [source, tables] of [
    [initial, ["companies", "profiles", "assessment_packages", "jobs", "candidates", "candidate_applications",
      "test_templates", "test_versions", "test_sections", "questions", "answer_options"]],
    [employee, ["employees", "employee_assessments", "employee_assessment_participants"]],
  ]) {
    for (const table of tables) {
      const ddl = source.match(new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];
      assert.ok(ddl, `Missing production table DDL: ${table}`);
      await db.exec(ddl);
    }
  }
  const structured = await migration("20260822000000_structured_ordering_matching");
  await db.exec(structured.slice(0, structured.indexOf("-- Extend the trusted")));
  // Existing explicit indexes for measured tables, plus implicit PK/UNIQUE indexes above.
  for (const source of [initial, employee]) {
    for (const ddl of source.match(/create (?:unique )?index if not exists [\s\S]*?;/g) ?? []) {
      if (candidates.some(({ table }) => new RegExp(`on public\\.${table}\\s*\\(`).test(ddl))) await db.exec(ddl);
    }
  }
  await db.exec(`
    insert into companies(id,name) select ${sqlId("n")}, 'Synthetic company ' || n from generate_series(1,8) n;
    insert into assessment_packages(id,company_id,title) select ${sqlId("100+n")}, ${sqlId("n")}, 'Synthetic package' from generate_series(1,8) n;
    insert into jobs(id,company_id,title,status,updated_at)
      select ${sqlId("10000+n")}, ${sqlId("1+(n-1)/1000")}, 'Synthetic job ' || n,
        case when n % 5 = 0 then 'draft' else 'active' end,
        '2026-01-01'::timestamptz + (n % 251) * interval '1 microsecond'
      from generate_series(1,8000) n;
    insert into candidates(id,full_name) select ${sqlId("100000+n")}, 'Synthetic candidate ' || n from generate_series(1,32000) n;
    insert into candidate_applications(id,company_id,job_id,candidate_id,status,fit_score,created_at)
      select ${sqlId("200000+n")}, ${sqlId("1+(n-1)/4000")},
        ${sqlId("10001+((n-1)/4000)*1000+((n-1)%4)")}, ${sqlId("100000+n")},
        case when n % 5 = 0 then 'invited' else 'completed' end,
        case when n % 5 = 0 then null else (n % 101)::numeric end,
        '2026-01-01'::timestamptz + ((n/4) % 251) * interval '1 microsecond'
      from generate_series(1,32000) n;
    insert into employees(id,company_id,full_name,email)
      select ${sqlId("300000+n")}, ${sqlId("1+(n-1)/4000")}, 'Synthetic employee ' || n, 'fixture-' || n || '@example.test'
      from generate_series(1,32000) n;
    insert into employee_assessments(id,company_id,assessment_package_id,title)
      select ${sqlId("400+n")}, ${sqlId("n")}, ${sqlId("100+n")}, 'Synthetic assessment' from generate_series(1,8) n;
    insert into employee_assessment_participants(id,company_id,employee_assessment_id,employee_id,status,fit_score,created_at)
      select ${sqlId("400000+n")}, ${sqlId("1+(n-1)/4000")}, ${sqlId("401+(n-1)/4000")}, ${sqlId("300000+n")},
        case when n % 5 = 0 then 'invited' else 'completed' end,
        case when n % 5 = 0 then null else (n % 101)::numeric end,
        '2026-01-01'::timestamptz + (n % 251) * interval '1 microsecond'
      from generate_series(1,32000) n;
    insert into test_templates(id,company_id,title) select ${sqlId("500+n")}, ${literal(1)}, 'Synthetic template' from generate_series(1,100) n;
    insert into test_versions(id,test_template_id,title) select ${sqlId("600+n")}, ${sqlId("500+n")}, 'Synthetic draft' from generate_series(1,100) n;
    insert into test_sections(id,test_version_id,title,order_index)
      select ${sqlId("500000+n")}, ${sqlId("601+(n-1)/10")}, 'Synthetic section', (n-1)%10 from generate_series(1,1000) n;
    insert into questions(id,section_id,question_type,text,order_index)
      select ${sqlId("600000+n")}, ${sqlId("500001+(n-1)/10")}, 'single_choice', repeat('Synthetic question. ',20), (n-1)%10
      from generate_series(1,10000) n;
    insert into answer_options(id,question_id,text,order_index)
      select ${sqlId("700000+n")}, ${sqlId("600001+(n-1)/4")}, repeat('Synthetic option. ',10), (n-1)%4 from generate_series(1,40000) n;
    analyze;
  `);
}

export function queryShapes() {
  const shapes = [];
  const date = "'2026-01-01 00:00:00.000125+00'::timestamptz";
  for (const [name, table, column, parent, cursorId, projection, source] of [
    ["jobs", "jobs", "updated_at", "", 10500, "title,status,department,location", "lib/jobs/data.ts"],
    ["applications", "candidate_applications", "created_at", "", 202000, "status,fit_score,overall_score", "lib/candidates/data.ts"],
    ["job-applications", "candidate_applications", "created_at", ` and job_id=${literal(10001)}`, 202000, "status,fit_score,overall_score", "lib/candidates/data.ts"],
    ["participants", "employee_assessment_participants", "created_at", ` and employee_assessment_id=${literal(401)}`, 402000, "status,fit_score,overall_score", "lib/employee-assessments/data.ts"],
  ]) {
    for (const direction of ["desc", "asc"]) {
      for (const page of ["first", "middle", "tail", "filtered"]) {
        const pivot = page === "tail" ? (direction === "desc" ? "000001" : "000249") : "000125";
        const value = date.replace("000125", pivot);
        const cursor = page === "first" || page === "filtered" ? "" :
          ` and (${column} ${direction === "asc" ? ">" : "<"} ${value} or (${column} = ${value} and id > ${literal(cursorId)}))`;
        const status = page === "filtered" ? ` and status='${table === "jobs" ? "active" : "completed"}'` : "";
        shapes.push({ name: `${name}-${direction}-${page}`, source, maxRows: 51,
          sql: `select id,company_id,${column},${projection} from public.${table} where company_id=${literal(1)}${parent}${cursor}${status} order by ${column} ${direction}, id asc limit 51` });
      }
    }
  }
  for (const [name, table, parent, parentId, cursorId, source] of [
    ["candidate-fit", "candidate_applications", "job_id", 10001, 202000, "lib/comparison/data.ts"],
    ["employee-fit", "employee_assessment_participants", "employee_assessment_id", 401, 402000, "lib/employee-assessments/data.ts"],
  ]) {
    for (const direction of ["desc", "asc"]) {
      for (const page of ["first", "middle", "null-tail"]) {
        const cursor = page === "first" ? "" : page === "null-tail" ? ` and fit_score is null and id > ${literal(cursorId)}` :
          ` and (fit_score ${direction === "asc" ? ">" : "<"} 50 or (fit_score=50 and id > ${literal(cursorId)}) or fit_score is null)`;
        shapes.push({ name: `${name}-${direction}-${page}`, source, maxRows: 51,
          sql: `select id,company_id,status,fit_score,overall_score from public.${table} where company_id=${literal(1)} and ${parent}=${literal(parentId)}${cursor} order by fit_score ${direction} nulls last, id asc limit 51` });
      }
    }
  }
  for (const [name, table, parent, parentId] of [
    ["sections", "test_sections", "test_version_id", 601],
    ["questions", "questions", "section_id", 500001],
    ["options", "answer_options", "question_id", 600001],
  ]) shapes.push({ name, source: "lib/tests/builder-data.ts; lib/assessment/section-data.ts", maxRows: 10,
    sql: `select id,${parent},order_index,${table === "test_sections" ? "title,settings_json" : table === "questions" ? "text,points,settings_json" : "text,points,competency_effect_json"} from public.${table} where ${parent}=${literal(parentId)} order by order_index` });
  return shapes;
}

const writes = [
  { name: "question-upsert-proxy", sql: `insert into questions(id,section_id,question_type,text,order_index)
    select id,section_id,question_type,text || ' edit',order_index from questions where section_id between ${literal(500001)} and ${literal(500010)}
    on conflict(id) do update set text=excluded.text,order_index=excluded.order_index` },
  { name: "option-reorder-proxy", sql: `update answer_options set order_index=3-order_index where question_id between ${literal(600001)} and ${literal(600100)}` },
  { name: "application-score-proxy", sql: `update candidate_applications set fit_score=42,updated_at='2026-02-01' where id between ${literal(200001)} and ${literal(200100)}` },
  { name: "participant-score-proxy", sql: `update employee_assessment_participants set fit_score=42,updated_at='2026-02-01' where id between ${literal(400001)} and ${literal(400100)}` },
];

const fingerprint = (rows) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
export function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { p50: sorted[Math.ceil(sorted.length * 0.5) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}
async function explain(db, sql) {
  return (await db.query(`explain (analyze, buffers, settings, format json) ${sql}`)).rows[0]["QUERY PLAN"][0];
}
async function inventory(db) {
  return (await db.query(`select t.relname as table_name, c.relname as name, pg_get_indexdef(i.indexrelid) as definition,
      pg_relation_size(i.indexrelid)::bigint as bytes, i.indisvalid as valid,
      i.indrelid::text || ':' || i.indkey::text || ':' || i.indclass::text || ':' || i.indcollation::text || ':' || i.indoption::text || ':' ||
      coalesce(pg_get_expr(i.indpred,i.indrelid),'') || ':' || coalesce(pg_get_expr(i.indexprs,i.indrelid),'') as signature
    from pg_index i join pg_class c on c.oid=i.indexrelid join pg_class t on t.oid=i.indrelid
    join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' order by t.relname,c.relname`)).rows;
}

export async function runBenchmark({ repetitions = 30, indexNames = candidates.map(({ name }) => name), progress = () => {} } = {}) {
  assert.ok(Number.isInteger(repetitions) && repetitions > 0 && repetitions <= 1000);
  assert.ok(Array.isArray(indexNames) && new Set(indexNames).size === indexNames.length, "Index names must be a unique array");
  const selected = indexNames.map((name) => {
    const candidate = candidates.find((entry) => entry.name === name);
    assert.ok(candidate, `Unknown experimental index: ${name}`);
    return candidate;
  });
  const output = { generatedAt: new Date().toISOString(), environment: "PGlite in-memory; synthetic; owner role; no RLS/triggers/PostgREST",
    limitations: "Base-table screening, not full production schema or route latency. First run is not cold I/O. Write proxies are not autosave acceptance. Selected indexes are tested together; an empty selection is a no-index control.",
    node: process.version, repetitions, candidates: selected, sources: {}, phases: {} };
  for (const path of ["scripts/perf-index-benchmark.mjs", "package-lock.json",
    "supabase/migrations/20260525000000_initial_schema.sql",
    "supabase/migrations/20260607100000_employee_assessments.sql",
    "supabase/migrations/20260822000000_structured_ordering_matching.sql",
    "lib/lists/pagination.ts", "lib/comparison/pagination.ts", "lib/jobs/data.ts", "lib/candidates/data.ts",
    "lib/employee-assessments/data.ts", "lib/comparison/data.ts", "lib/tests/builder-data.ts", "lib/assessment/section-data.ts"]) {
    output.sources[path] = createHash("sha256").update(await readFile(new URL(path, root))).digest("hex");
  }
  const expected = new Map();
  for (const phase of ["before", "after"]) {
    progress(`PERF-012 ${phase}: creating independent synthetic database`);
    const db = new PGlite();
    try {
      await setupFixture(db);
      output.postgres = (await db.query("select version() as version")).rows[0].version;
      const dataset = {};
      for (const table of ["companies", "jobs", "candidate_applications", "employee_assessment_participants",
        "test_templates", "test_versions", "test_sections", "questions", "answer_options"]) {
        dataset[table] = Number((await db.query(`select count(*) as count from public.${table}`)).rows[0].count);
      }
      if (phase === "after") for (const candidate of selected) await db.exec(candidate.sql);
      await db.exec("analyze");
      const indexes = await inventory(db);
      assert.ok(indexes.every((index) => index.valid));
      for (const candidate of phase === "after" ? selected : []) {
        const entry = indexes.find((index) => index.name === candidate.name);
        assert.ok(entry);
        assert.equal(indexes.filter((index) => index.signature === entry.signature).length, 1, `Duplicate: ${entry.name}`);
      }
      assert.deepEqual(indexes.filter((entry) => entry.name.startsWith("perf012_")).map((entry) => entry.name).sort(),
        phase === "after" ? [...indexNames].sort() : [], "Fixture must contain exactly the selected experimental indexes");
      const results = [];
      for (const shape of queryShapes()) {
        const first = await explain(db, shape.sql);
        const rows = (await db.query(shape.sql)).rows;
        assert.ok(rows.length > 0 && rows.length <= shape.maxRows, shape.name);
        assert.ok(rows.every((row) => !row.company_id || row.company_id === uuid(1)), shape.name);
        const hash = fingerprint(rows);
        if (phase === "before") expected.set(shape.name, hash);
        else assert.equal(hash, expected.get(shape.name), `Index changed result: ${shape.name}`);
        const samples = [];
        let representative;
        for (let n = 0; n < repetitions; n++) {
          const plan = await explain(db, shape.sql);
          samples.push(plan["Execution Time"]);
          representative ??= plan;
        }
        results.push({ ...shape, rowCount: rows.length, fingerprint: hash, firstExecutionMs: first["Execution Time"],
          warmMs: summarize(samples), samples, plan: representative });
      }
      progress(`PERF-012 ${phase}: ${results.length} read shapes checked; measuring write proxies`);
      const writeResults = [];
      for (const shape of writes) {
        const samples = [];
        let representative;
        for (let n = 0; n <= repetitions; n++) {
          await db.exec("begin");
          try {
            const plan = await explain(db, shape.sql);
            if (n > 0) { samples.push(plan["Execution Time"]); representative ??= plan; }
          } finally { await db.exec("rollback"); }
        }
        writeResults.push({ ...shape, warmMs: summarize(samples), samples, plan: representative });
      }
      output.phases[phase] = { dataset, indexes, reads: results, writes: writeResults };
    } finally { await db.close(); }
  }
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = resolve(process.argv[2] ?? "artifacts/performance/perf012-local.json");
  const report = await runBenchmark({ progress: console.log });
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Saved ${report.phases.before.reads.length} before/after query plans (${report.repetitions} warm runs each) to ${destination}`);
}
