// Current configured project: GET requests only, LIMIT 0, no returned business rows.
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { TEST_TEMPLATE_LIST_SELECT, PACKAGE_LIST_SELECT, EMPLOYEE_ASSESSMENT_LIST_SELECT,
  JOB_LIST_SELECT } from "../lib/lists/read-models.ts";

const zero = "00000000-0000-0000-0000-000000000000";
const views = {
  test_template_list: `company_id,${TEST_TEMPLATE_LIST_SELECT}`,
  assessment_package_list: `company_id,${PACKAGE_LIST_SELECT}`,
  employee_assessment_list: `company_id,${EMPLOYEE_ASSESSMENT_LIST_SELECT}`,
  job_comparison_summary: "id,company_id,participant_count,completed_count,shortlisted_count,average_fit_score",
  employee_comparison_filters: "id,company_id,departments,role_titles",
};
const functions = ["list_company_test_templates", "list_company_assessment_packages"];
const safeCode = (value) => typeof value === "string" && /^[A-Z0-9_]{1,40}$/.test(value) ? value : null;

export async function runRemoteCheck(env, fetchImpl = fetch) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) throw new Error("Required Supabase settings are missing (values are not logged).");
  const checkedFetch = (input, init = {}) => {
    if ((init.method ?? "GET").toUpperCase() !== "GET") throw new Error("Remote check only permits GET.");
    return fetchImpl(input, { ...init, signal: AbortSignal.timeout(15000) });
  };
  const report = { checkedAt: new Date().toISOString(), projectFingerprint: createHash("sha256").update(new URL(url).origin).digest("hex"),
    scope: "Current configured project, not independently classified as staging. GET/LIMIT 0 metadata and permission probes only.",
    limitations: "No authenticated user JWT, tenant RLS matrix, live SQL catalog, index inventory, migration history, row behavior, or performance acceptance. API presence is not proof of exact deployed DDL.",
    checks: [], explain: null };
  const clients = Object.fromEntries([["service_role", serviceKey], ["anon", anonKey]].map(([role, key]) =>
    [role, createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: checkedFetch } })]));
  const schemaResponse = await checkedFetch(new URL("/rest/v1/", url), { headers: {
    apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/openapi+json",
  } });
  const schema = await schemaResponse.json();
  report.checks.push({ name: "openapi-readable", passed: schemaResponse.ok && !!schema.paths, status: schemaResponse.status });
  if (!schemaResponse.ok) return report;
  for (const [name, projection] of Object.entries(views)) {
    const expected = projection.split(",").map((column) => column.trim()).sort();
    const actual = Object.keys(schema.definitions?.[name]?.properties ?? {}).sort();
    report.checks.push({ name: `${name}:columns`, passed: !!schema.paths?.[`/${name}`] && JSON.stringify(actual) === JSON.stringify(expected) });
    for (const [role, client] of Object.entries(clients)) {
      const response = await client.from(name).select(projection).limit(0);
      const passed = role === "service_role"
        ? !response.error && Array.isArray(response.data) && response.data.length === 0
        : [401, 403].includes(response.status) && response.error?.code === "42501";
      report.checks.push({ name: `${name}:${role}:select`, passed, status: response.status, code: safeCode(response.error?.code) });
    }
  }
  for (const name of functions) {
    report.checks.push({ name: `${name}:exists`, passed: !!schema.paths?.[`/rpc/${name}`] });
    for (const [role, client] of Object.entries(clients)) {
      const response = await client.rpc(name, { target_company_id: zero }, { get: true }).select("id").limit(0);
      report.checks.push({ name: `${name}:${role}:execute-denied`,
        passed: [401, 403].includes(response.status) && response.error?.code === "42501",
        status: response.status, code: safeCode(response.error?.code) });
    }
  }
  const service = clients.service_role;
  const embeddings = [
    ["jobs-package-embedding", service.from("jobs").select(JOB_LIST_SELECT).eq("company_id", zero).limit(0)],
    ["candidate-list-embedding", service.from("candidate_applications")
      .select("id,status,fit_score,requires_review,created_at,candidates!inner(id),jobs(id),invitations(id,status,created_at)")
      .eq("company_id", zero).order("created_at", { referencedTable: "invitations", ascending: false })
      .order("id", { referencedTable: "invitations", ascending: false }).limit(1, { referencedTable: "invitations" }).limit(0)],
    ["candidate-comparison-embedding", service.from("candidate_applications")
      .select("id,fit_score,candidates!inner(id),application_competency_summary(competency_key,percentage)")
      .eq("company_id", zero).eq("job_id", zero).order("fit_score", { ascending: false, nullsFirst: false }).order("id").limit(0)],
  ];
  for (const [name, query] of embeddings) {
    const response = await query;
    report.checks.push({ name, passed: !response.error && Array.isArray(response.data) && response.data.length === 0,
      status: response.status, code: safeCode(response.error?.code) });
  }
  const plan = await service.from("jobs").select("id").eq("company_id", zero).limit(0)
    .explain({ analyze: false, format: "json", settings: true });
  report.explain = { available: !plan.error && Array.isArray(plan.data) && !!plan.data[0]?.Plan,
    status: plan.status, code: safeCode(plan.error?.code), analyze: false };
  // Do not serialize returned rows, schemas, plans, raw errors, URLs or credentials.
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const env = {};
    for (const name of [".env", ".env.local"]) {
      try { Object.assign(env, parseEnv(await readFile(name, "utf8"))); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    Object.assign(env, process.env);
    const report = await runRemoteCheck(env);
    const destination = resolve(process.argv[2] ?? "artifacts/performance/perf012-remote-check.json");
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
    const failed = report.checks.filter((check) => !check.passed);
    console.log(JSON.stringify({ passed: report.checks.length - failed.length, total: report.checks.length,
      failed, explain: report.explain, artifact: destination }));
    if (failed.length) process.exitCode = 1;
  } catch {
    console.error("Remote check could not complete. Verify the configured project, credentials and connectivity; no raw error or secret was logged.");
    process.exitCode = 1;
  }
}
