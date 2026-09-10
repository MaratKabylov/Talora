// Opt-in remote test data creation. Never deletes rows or changes schema/flags.
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";
import { listPage } from "../lib/lists/pagination.ts";
import { comparisonPage, DEFAULT_COMPARISON_FILTERS } from "../lib/comparison/pagination.ts";
import { TEST_TEMPLATE_LIST_SELECT, PACKAGE_LIST_SELECT, EMPLOYEE_ASSESSMENT_LIST_SELECT, JOB_LIST_SELECT } from "../lib/lists/read-models.ts";

const requireCheck = (condition, label) => { if (!condition) throw new Error(label); };
const code = (error) => /^[A-Za-z0-9_]{1,40}$/.test(error?.code ?? "") ? error.code : "request_failed";
const rowsOf = (response, label) => {
  if (response.error) throw new Error(`${label}: ${code(response.error)}`);
  return response.data ?? [];
};
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const sameIds = (actual, expected) => actual.length === expected.length && actual.every((id, i) => id === expected[i]);
const dateAt = (n) => `2026-09-10T00:00:00.${String(n % 23).padStart(6, "0")}+00:00`;

export async function runStagingLists(env, directory, progress = () => {}) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  requireCheck(url && key && anonKey, "Missing Supabase settings");
  await mkdir(directory, { recursive: true });
  const runId = randomUUID();
  const prefix = `PERF-STAGING-${runId.slice(0, 8)}`;
  const report = { runId, prefix, startedAt: new Date().toISOString(), completed: false,
    projectFingerprint: createHash("sha256").update(new URL(url).origin).digest("hex"),
    scope: "Authorized current project, isolated synthetic tenants. Real Supabase Auth/PostgREST/RLS; no SQL DDL, flags, deletes or existing business-row changes.",
    limitations: "List acceptance and API latency only. Seeded completed statuses/scores are fixtures, not execution of scoring. No native browser, SQL EXPLAIN, cold I/O, index before/after or full autosave/completion acceptance.",
    companies: [], users: [], dataset: {}, checks: [], metrics: [], shutdown: [] };
  const save = () => writeFile(resolve(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  // Never overwrite the only manifest identifying remote fixture rows/accounts.
  await writeFile(resolve(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  let lastBytes = 0;
  const measuredFetch = async (input, init) => {
    const response = await fetch(input, { ...init, signal: AbortSignal.timeout(30000) });
    lastBytes = (await response.clone().arrayBuffer()).byteLength;
    return response;
  };
  const makeClient = (apiKey) => createClient(url, apiKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: measuredFetch } });
  const service = makeClient(key);
  const identities = [];
  const check = (name, condition) => { report.checks.push({ name, passed: !!condition }); requireCheck(condition, name); };
  const insert = async (table, values) => {
    for (let n = 0; n < values.length; n += 200) rowsOf(await service.from(table).insert(values.slice(n, n + 200)), `seed:${table}`);
    report.dataset[table] = (report.dataset[table] ?? 0) + values.length;
    await save();
  };
  try {
    progress("Creating three synthetic Auth users and two isolated companies");
    for (const label of ["A", "B", "dual"]) {
      const email = `perf-${runId}-${label.toLowerCase()}@example.invalid`;
      const password = randomBytes(36).toString("base64url");
      const response = await service.auth.admin.createUser({ email, password, email_confirm: true,
        user_metadata: { full_name: `${prefix} ${label}`, perf_run_id: runId } });
      if (response.error || !response.data.user) throw new Error(`create-test-user:${code(response.error)}`);
      const user = { label, id: response.data.user.id, client: makeClient(anonKey) };
      identities.push(user); report.users.push({ label, id: user.id }); await save();
      const auth = await user.client.auth.signInWithPassword({ email, password });
      if (auth.error || !auth.data.session) throw new Error(`sign-in-test-user:${code(auth.error)}`);
    }
    const companies = ["A", "B"].map(label => ({ id: randomUUID(), name: `${prefix} ${label}`, status: "active" }));
    report.companies = companies.map(({ id, name }) => ({ id, name })); await save();
    await insert("companies", companies);
    const [a, b] = companies.map(c => c.id);
    await insert("company_users", [
      { company_id: a, user_id: identities[0].id, role: "owner", status: "active" },
      { company_id: b, user_id: identities[1].id, role: "owner", status: "active" },
      ...[a, b].map(company_id => ({ company_id, user_id: identities[2].id, role: "recruiter", status: "active" })),
    ]);
    const data = {};
    for (const [company, counts] of [[a, [121, 1107, 137, 61, 35, 107]], [b, [5, 207, 17, 3, 3, 3]]]) {
      const [jobCount, applicationCount, employeeCount, templateCount, packageCount, assessmentCount] = counts;
      const packages = Array.from({ length: packageCount }, (_, n) => ({ id: randomUUID(), company_id: company, title: `${prefix} Package ${n}`, updated_at: dateAt(n) }));
      await insert("assessment_packages", packages);
      const jobs = Array.from({ length: jobCount }, (_, n) => ({ id: randomUUID(), company_id: company, title: `${prefix} Job ${n}`, status: n % 5 ? "active" : "draft", updated_at: dateAt(n) }));
      await insert("jobs", jobs);
      const templates = Array.from({ length: templateCount }, (_, n) => ({ id: randomUUID(), company_id: company, title: `${prefix} Template ${n}`, updated_at: dateAt(n), is_system: false }));
      await insert("test_templates", templates);
      await insert("test_versions", templates.map(t => ({ id: randomUUID(), test_template_id: t.id, title: t.title, status: "draft", version_number: 1 })));
      const candidates = Array.from({ length: applicationCount }, (_, n) => ({ id: randomUUID(), company_id: company, full_name: `${prefix} Person ${String(n).padStart(4, "0")}` }));
      await insert("candidates", candidates);
      const applications = candidates.map((c, n) => ({ id: randomUUID(), company_id: company, candidate_id: c.id, job_id: jobs[n % 2].id,
        status: n % 5 ? "completed" : "invited", fit_score: n % 5 ? n % 101 : null, overall_score: n % 5 ? n % 101 : null,
        requires_review: n % 7 === 0, created_at: dateAt(n) }));
      await insert("candidate_applications", applications);
      // Synthetic invitation tokens are never retained in reports or printed.
      await insert("invitations", applications.slice(0, 3).flatMap(app => [0, 1].map(n => ({ id: randomUUID(), company_id: company,
        job_id: app.job_id, candidate_id: app.candidate_id, application_id: app.id, token: randomBytes(32).toString("hex"),
        status: "created", created_at: `2026-09-10T00:00:0${n}+00:00` }))));
      const assessments = Array.from({ length: assessmentCount }, (_, n) => ({ id: randomUUID(), company_id: company,
        assessment_package_id: packages[0].id, title: `${prefix} Assessment ${n}`, updated_at: dateAt(n) }));
      await insert("employee_assessments", assessments);
      const employees = Array.from({ length: employeeCount }, (_, n) => ({ id: randomUUID(), company_id: company,
        full_name: `${prefix} Employee ${n}`, email: `perf-${runId}-${company.slice(0, 8)}-${n}@example.invalid`, department: n % 2 ? "Synthetic A" : "Synthetic B" }));
      await insert("employees", employees);
      const participants = employees.map((e, n) => ({ id: randomUUID(), company_id: company, employee_id: e.id,
        employee_assessment_id: assessments[0].id, status: n % 5 ? "completed" : "invited", fit_score: n % 5 ? n % 101 : null,
        created_at: dateAt(n) }));
      await insert("employee_assessment_participants", participants);
      data[company] = { packages, jobs, templates, applications, assessments, participants };
    }
    const [clientA, clientB, dual] = identities.map(i => i.client);
    progress("Checking real JWT tenant isolation and requested-company RPC scope");
    for (const [table, keyName] of [["jobs", "jobs"], ["candidate_applications", "applications"], ["employee_assessment_participants", "participants"],
      ["test_template_list", "templates"], ["assessment_package_list", "packages"], ["employee_assessment_list", "assessments"]]) {
      const targets = [data[a][keyName][0].id, data[b][keyName][0].id];
      for (const [label, client, expected] of [["A", clientA, [targets[0]]], ["B", clientB, [targets[1]]], ["dual", dual, targets]]) {
        const rows = rowsOf(await client.from(table).select("id").in("id", targets).order("id"), `rls:${table}`);
        check(`rls:${table}:${label}`, sameIds(rows.map(r => r.id), [...expected].sort()));
      }
    }
    for (const [rpc, itemKey] of [["list_company_test_templates", "templates"], ["list_company_assessment_packages", "packages"]]) {
      const targets = [data[a][itemKey][0].id, data[b][itemKey][0].id];
      const allowed = rowsOf(await dual.rpc(rpc, { target_company_id: a }, { get: true }).select("id").in("id", targets), rpc);
      check(`${rpc}:dual-requested-company`, sameIds(allowed.map(r => r.id), [targets[0]]));
      const denied = rowsOf(await clientA.rpc(rpc, { target_company_id: b }, { get: true }).select("id").in("id", targets), rpc);
      check(`${rpc}:nonmember`, denied.length === 0);
    }
    const inaccessible = rowsOf(await clientA.from("jobs").update({ title: `${prefix} forbidden` }).eq("id", data[b].jobs[0].id).select("id"), "cross-tenant-update");
    check("cross-tenant-update-empty", inaccessible.length === 0);
    const untouched = rowsOf(await service.from("jobs").select("title").eq("id", data[b].jobs[0].id), "cross-tenant-update-check");
    check("cross-tenant-update-unchanged", untouched[0]?.title === data[b].jobs[0].title);

    async function traverse(name, table, expectedRows, column, sort, pageSize, filters = {}, extra = q => q) {
      const seen = []; let cursor;
      do {
        const page = listPage([name, a], column, { sort, pageSize: String(pageSize), ...filters, cursor });
        const response = await page.apply(extra(clientA.from(table).select(`id,${column}`).eq("company_id", a)), { status: "status" });
        const rows = rowsOf(response, name); check(`${name}:page-${Math.floor(seen.length / pageSize)}:bounded`, rows.length <= pageSize + 1);
        const next = page.finish(rows); seen.push(...next.items.map(r => r.id)); cursor = next.nextCursor;
        requireCheck(seen.length <= expectedRows.length, `${name}:cursor-progress`);
      } while (cursor);
      const expected = [...expectedRows].sort((x, y) => (x[column] < y[column] ? -1 : x[column] > y[column] ? 1 : 0) * (sort === "date_asc" ? 1 : -1) || x.id.localeCompare(y.id));
      check(`${name}:no-gaps-or-duplicates`, sameIds(seen, expected.map(r => r.id)) && new Set(seen).size === seen.length);
    }
    progress("Traversing tied dates and nullable scores through real PostgREST");
    for (const sort of ["date_asc", "date_desc"]) {
      await traverse(`applications-${sort}`, "candidate_applications", data[a].applications, "created_at", sort, 50);
      await traverse(`jobs-${sort}`, "jobs", data[a].jobs, "updated_at", sort, 100);
      await traverse(`participants-${sort}`, "employee_assessment_participants", data[a].participants, "created_at", sort, 50);
    }
    await traverse("applications-filtered", "candidate_applications", data[a].applications.filter(r => r.status === "completed"), "created_at", "date_desc", 100, { status: "completed" });
    for (const [table, expectedRows, parent, parentId] of [["candidate_applications", data[a].applications.filter(r => r.job_id === data[a].jobs[0].id), "job_id", data[a].jobs[0].id],
      ["employee_assessment_participants", data[a].participants, "employee_assessment_id", data[a].assessments[0].id]]) {
      for (const sort of ["fit_asc", "fit_desc"]) {
        const seen = []; let cursor;
        do {
          const page = comparisonPage(a, parentId, { ...DEFAULT_COMPARISON_FILTERS, sort }, cursor);
          let query = clientA.from(table).select("id,fit_score").eq("company_id", a).eq(parent, parentId);
          if (page.predicate) query = query.or(page.predicate);
          const rows = rowsOf(await query.order("fit_score", { ascending: page.ascending, nullsFirst: false }).order("id").limit(51), "comparison");
          requireCheck(rows.length <= 51, "comparison:page-limit");
          const next = page.finish(rows); seen.push(...next.items.map(r => r.id)); cursor = next.nextCursor;
          requireCheck(seen.length <= expectedRows.length, "comparison:cursor-progress");
        } while (cursor);
        const expected = [...expectedRows].sort((x, y) => (x.fit_score === null && y.fit_score !== null ? 1 : y.fit_score === null && x.fit_score !== null ? -1 :
          ((x.fit_score ?? 0) - (y.fit_score ?? 0)) * (sort === "fit_asc" ? 1 : -1)) || x.id.localeCompare(y.id));
        check(`${table}:${sort}:ties-nulls-no-gaps`, sameIds(seen, expected.map(r => r.id)));
      }
    }
    const embedded = rowsOf(await clientA.from("candidate_applications").select("id,invitations(id,status,created_at)")
      .in("id", data[a].applications.slice(0, 3).map(r => r.id)).order("created_at", { referencedTable: "invitations", ascending: false })
      .order("id", { referencedTable: "invitations", ascending: false }).limit(1, { referencedTable: "invitations" }), "latest-invitation");
    check("latest-invitation-per-parent", embedded.length === 3 && embedded.every(r => r.invitations.length === 1 && r.invitations[0].created_at.startsWith("2026-09-10T00:00:01")));
    const search = rowsOf(await clientA.from("candidate_applications").select("id,candidates!inner(id)").eq("company_id", a)
      .ilike("candidates.full_name", `%${prefix} Person 000%`).limit(51), "inner-name-search");
    check("inner-name-search", search.length === 10);
    const empty = rowsOf(await clientA.from("jobs").select("id").eq("company_id", a).ilike("title", "%__absent_perf_value__%").limit(51), "empty-search");
    check("empty-search", empty.length === 0);

    progress("Measuring nine real authenticated API queries: first request and 30 warm samples each");
    const queries = [
      ["jobs", () => clientA.from("jobs").select(JOB_LIST_SELECT).eq("company_id", a).order("updated_at", { ascending: false }).order("id").limit(51)],
      ["templates-rpc", () => clientA.rpc("list_company_test_templates", { target_company_id: a }, { get: true }).select(TEST_TEMPLATE_LIST_SELECT).order("updated_at", { ascending: false }).order("id").limit(51)],
      ["packages-rpc", () => clientA.rpc("list_company_assessment_packages", { target_company_id: a }, { get: true }).select(PACKAGE_LIST_SELECT).order("updated_at", { ascending: false }).order("id").limit(51)],
      ["assessments-view", () => clientA.from("employee_assessment_list").select(EMPLOYEE_ASSESSMENT_LIST_SELECT).eq("company_id", a).order("updated_at", { ascending: false }).order("id").limit(51)],
      ["candidates", () => clientA.from("candidate_applications").select("id,status,fit_score,created_at,candidates!inner(id),invitations(id,status,created_at)").eq("company_id", a)
        .order("created_at", { ascending: false }).order("id").order("created_at", { referencedTable: "invitations", ascending: false }).limit(1, { referencedTable: "invitations" }).limit(51)],
      ["job-candidates", () => clientA.from("candidate_applications").select("id,status,fit_score,created_at,candidates!inner(id)").eq("company_id", a).eq("job_id", data[a].jobs[0].id).order("created_at", { ascending: false }).order("id").limit(51)],
      ["participants", () => clientA.from("employee_assessment_participants").select("id,status,fit_score,created_at,employees!inner(id)").eq("company_id", a).eq("employee_assessment_id", data[a].assessments[0].id).order("created_at", { ascending: false }).order("id").limit(51)],
      ["candidate-comparison", () => clientA.from("candidate_applications").select("id,fit_score,candidates!inner(id),application_competency_summary(competency_key,percentage)").eq("company_id", a).eq("job_id", data[a].jobs[0].id).order("fit_score", { ascending: false, nullsFirst: false }).order("id").limit(51)],
      ["employee-comparison", () => clientA.from("employee_assessment_participants").select("id,fit_score,employees!inner(id)").eq("company_id", a).eq("employee_assessment_id", data[a].assessments[0].id).order("fit_score", { ascending: false, nullsFirst: false }).order("id").limit(51)],
    ];
    for (const [name, query] of queries) {
      const samples = [], bytes = []; let firstMs;
      for (let n = 0; n <= 30; n++) {
        const start = performance.now(); const rows = rowsOf(await query(), `measure:${name}`);
        const elapsed = performance.now() - start;
        requireCheck(rows.length > 0 && rows.length <= 51, `measure:${name}:rows`);
        if (n === 0) firstMs = elapsed; else { samples.push(elapsed); bytes.push(lastBytes); }
      }
      report.metrics.push({ name, firstMs, repetitions: samples.length, p50Ms: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95),
        maxJsonBytes: Math.max(...bytes), samplesMs: samples });
      progress(`Measured ${name}`); await save();
    }
    rowsOf(await service.from("company_users").update({ status: "disabled" }).eq("company_id", b).eq("user_id", identities[1].id), "disable-test-membership");
    check("disabled-membership-denied", rowsOf(await clientB.from("jobs").select("id").eq("company_id", b).limit(1), "disabled-read").length === 0);
    report.completed = true;
  } catch (error) {
    // Labels are ours; never serialize raw Supabase errors, fetched rows or credentials.
    report.failure = error instanceof Error && !error.message.includes("http") ? error.message.slice(0, 180) : "staging_run_failed";
    progress(`Run stopped: ${report.failure}`);
  } finally {
    progress("Disabling only the synthetic users and memberships created by this run");
    for (const identity of identities) {
      const membership = await service.from("company_users").update({ status: "disabled" }).eq("user_id", identity.id)
        .in("company_id", report.companies.map(c => c.id));
      report.shutdown.push({ user: identity.label, operation: "disable-memberships", passed: !membership.error, code: membership.error ? code(membership.error) : null });
      const ban = await service.auth.admin.updateUserById(identity.id, { ban_duration: "8760h" });
      report.shutdown.push({ user: identity.label, operation: "ban-test-user", passed: !ban.error, code: ban.error ? code(ban.error) : null });
      const signedOut = await identity.client.auth.signOut({ scope: "global" });
      report.shutdown.push({ user: identity.label, operation: "revoke-test-sessions", passed: !signedOut.error, code: signedOut.error ? code(signedOut.error) : null });
    }
    report.finishedAt = new Date().toISOString(); await save();
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--execute") throw new Error("Remote writes require explicit --execute; use only in a user-authorized project.");
  const env = {};
  for (const name of [".env", ".env.local"]) { try { Object.assign(env, parseEnv(await readFile(name, "utf8"))); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  Object.assign(env, process.env);
  const directory = resolve(process.argv[3] ?? `artifacts/performance/staging-${Date.now()}`);
  const report = await runStagingLists(env, directory, console.log);
  console.log(JSON.stringify({ completed: report.completed, checks: report.checks.length, metrics: report.metrics.length,
    shutdownPassed: report.shutdown.every(check => check.passed), artifact: resolve(directory, "report.json") }));
  if (!report.completed || report.shutdown.some(check => !check.passed)) process.exitCode = 1;
}
