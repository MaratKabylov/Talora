import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { comparisonPage, DEFAULT_COMPARISON_FILTERS } from "../lib/comparison/pagination.ts";
import { JOB_LIST_SELECT, TEST_TEMPLATE_LIST_SELECT, PACKAGE_LIST_SELECT, EMPLOYEE_ASSESSMENT_LIST_SELECT } from "../lib/lists/read-models.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const id = (n: number) => `fa100000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function harness() {
  const requests: URL[] = [];
  const responses = new Map<string, unknown>();
  let failure: string | null = null;
  let platformAllowed = true;
  const client = createClient("https://example.test", "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input)); requests.push(url);
      const name = url.pathname.split("/").at(-1)!;
      return new Response(JSON.stringify(name === failure ? { message: "private database error" } : responses.get(name) ?? []), {
        status: name === failure ? 500 : 200, headers: { "content-type": "application/json" },
      });
    } },
  });
  const stubs: Record<string, unknown> = {
    "server-only": {},
    "lib/supabase/server.ts": { createClient: async () => client },
    "lib/supabase/admin.ts": { createAdminClient: () => client },
    "lib/admin/context.ts": { requirePlatformContext: async () => { if (!platformAllowed) throw Error("Forbidden"); return {}; } },
    "lib/rich-text.server.ts": { sanitizeRichTextValue: (value: unknown) => value },
    "lib/observability/server-performance.ts": { measureServerOperation: (_: string, task: () => Promise<unknown>) => task() },
  };
  const cache = new Map<string, unknown>();
  function load<T>(file: string): T {
    const path = resolve(root, file);
    const key = relative(root, path).replaceAll("\\", "/");
    if (Object.hasOwn(stubs, key)) return stubs[key] as T;
    if (cache.has(path)) return cache.get(path) as T;
    const loadedModule = { exports: {} }; cache.set(path, loadedModule.exports);
    const { outputText } = transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
    compileFunction(outputText, ["exports", "module", "require", "process"])(loadedModule.exports, loadedModule, (name: string) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name.startsWith(".") || name.startsWith("@/")) {
        const target = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(path), name);
        return load(target.endsWith(".ts") ? target : `${target}.ts`);
      }
      return require(name);
    }, process);
    return loadedModule.exports as T;
  }
  return { requests, responses, load, fail: (name: string) => { failure = name; }, forbid: () => { platformAllowed = false; } };
}
const params = (h: ReturnType<typeof harness>, name: string) => h.requests.filter(url => url.pathname.endsWith(`/${name}`)).map(url => url.searchParams);

test("list selects contain summaries, not rich text or child payloads", () => {
  assert.equal(JOB_LIST_SELECT, "id, title, department, location, status, updated_at, assessment_packages(title)");
  for (const select of [JOB_LIST_SELECT, TEST_TEMPLATE_LIST_SELECT, PACKAGE_LIST_SELECT, EMPLOYEE_ASSESSMENT_LIST_SELECT]) {
    assert.doesNotMatch(select, /description|instructions|json|test_versions\(|participants\(/);
  }
});

test("dashboard list loaders request RLS views and retain tenant/system grant filters", async () => {
  const h = harness();
  h.responses.set("company_system_test_access", [{ test_template_id: id(20) }]);
  h.responses.set("get_accessible_system_package_ids", [{ package_id: id(10) }]);
  await h.load<typeof import("../lib/jobs/data.ts")>("lib/jobs/data.ts").listJobs(id(1));
  await h.load<typeof import("../lib/tests/data.ts")>("lib/tests/data.ts").listTestTemplates(id(1));
  await h.load<typeof import("../lib/packages/data.ts")>("lib/packages/data.ts").listAssessmentPackages(id(1));
  await h.load<typeof import("../lib/employee-assessments/data.ts")>("lib/employee-assessments/data.ts").listEmployeeAssessments(id(1));
  for (const [table, select] of [["jobs", JOB_LIST_SELECT], ["test_template_list", TEST_TEMPLATE_LIST_SELECT],
    ["assessment_package_list", PACKAGE_LIST_SELECT], ["employee_assessment_list", EMPLOYEE_ASSESSMENT_LIST_SELECT]]) {
    const queries = params(h, table); assert.ok(queries.length);
    for (const query of queries) {
      assert.equal(query.get("select"), select.replaceAll(" ", ""));
      if (query.get("is_system") === "eq.true") assert.match(query.get("id") ?? "", /^in\./);
      else assert.equal(query.get("company_id"), `eq.${id(1)}`);
    }
  }
  assert.equal(params(h, "test_versions").length, 0);
  assert.equal(params(h, "employee_assessment_participants").length, 0);
  h.fail("employee_assessment_list");
  await assert.rejects(h.load<typeof import("../lib/employee-assessments/data.ts")>("lib/employee-assessments/data.ts").listEmployeeAssessments(id(1)), /Unable to load employee assessments/);
});

test("candidate and employee invitation embedding is ordered and limited inside PostgREST", async () => {
  const h = harness();
  const candidate = h.load<typeof import("../lib/candidates/data.ts")>("lib/candidates/data.ts");
  await candidate.listCandidateApplications(id(1));
  await candidate.listJobCandidateApplications(id(1), id(2));
  for (const query of params(h, "candidate_applications")) {
    assert.equal(query.get("company_id"), `eq.${id(1)}`);
    assert.equal(query.get("invitations.order"), "created_at.desc,id.desc");
    assert.equal(query.get("invitations.limit"), "1");
    assert.equal(query.get("limit"), null);
  }
  assert.equal(params(h, "candidate_applications")[1].get("job_id"), `eq.${id(2)}`);
  h.responses.set("employee_assessments", null);
  await h.load<typeof import("../lib/employee-assessments/data.ts")>("lib/employee-assessments/data.ts").getEmployeeAssessmentPageData(id(1), id(2));
  const query = params(h, "employee_assessment_participants")[0];
  assert.equal(query.get("employee_assessment_invitations.order"), "created_at.desc,id.desc");
  assert.equal(query.get("employee_assessment_invitations.limit"), "1");
});

test("job candidate list context does not load detail settings, weights or package choices", async () => {
  const h = harness();
  h.responses.set("jobs", { id: id(2), title: "Fixture", status: "active", assessment_package_id: id(3) });
  const result = await h.load<typeof import("../lib/jobs/data.ts")>("lib/jobs/data.ts").getJobCandidateListContext(id(1), id(2));
  assert.deepEqual(result, { job: { id: id(2), title: "Fixture", status: "active", assessmentPackageId: id(3) } });
  assert.equal(h.requests.length, 1);
  const query = params(h, "jobs")[0];
  assert.equal(query.get("select"), "id,title,status,assessment_package_id");
  assert.equal(query.get("company_id"), `eq.${id(1)}`);
  assert.equal(query.get("id"), `eq.${id(2)}`);
});

test("comparison filters and cursor apply in PostgREST before bounded child reads; aggregates remain global", async () => {
  const h = harness();
  const rows = Array.from({ length: 51 }, (_, n) => ({ id: id(100+n), fit_score: 50, status: "completed",
    candidates: { id: id(300+n), full_name: "Fixture" }, employees: { id: id(300+n), full_name: "Fixture" } }));
  h.responses.set("jobs", { id: id(2), title: "Fixture", status: "active" });
  h.responses.set("candidate_applications", rows);
  h.responses.set("job_comparison_summary", { participant_count: 200, completed_count: 150, shortlisted_count: 2, average_fit_score: 55 });
  const filters = { ...DEFAULT_COMPARISON_FILTERS, status: "completed", riskLevel: "low", recommendation: "recommended" };
  const token = comparisonPage(id(1), id(2), filters).finish(rows).nextCursor!;
  const result = await h.load<typeof import("../lib/comparison/data.ts")>("lib/comparison/data.ts").getJobComparisonData(id(1), id(2), filters, token);
  assert.equal(result?.applications.length, 50); assert.ok(result?.nextCursor);
  assert.equal(result?.summary.participantCount, 200);
  const query = params(h, "candidate_applications")[0];
  assert.equal(query.get("limit"), "51"); assert.equal(query.get("order"), "fit_score.desc.nullslast,id.asc");
  assert.equal(query.get("status"), "eq.completed"); assert.equal(query.get("risk_level"), "eq.low");
  assert.equal(query.get("recommendation"), "eq.recommended"); assert.ok(query.get("or"));
  assert.equal(params(h, "job_comparison_summary")[0].get("status"), null);
  h.responses.set("employee_assessments", { id: id(2), title: "Fixture", status: "active" });
  h.responses.set("employee_assessment_participants", rows);
  h.responses.set("employee_assessment_list", { participant_count: 200 });
  h.responses.set("employee_comparison_filters", { departments: ["Engineering"], role_titles: ["Developer"] });
  const employeeResult = await h.load<typeof import("../lib/employee-assessments/data.ts")>("lib/employee-assessments/data.ts")
    .getEmployeeComparisonData(id(1), id(2), { ...filters, department: "Engineering", roleTitle: "Developer" });
  assert.equal(employeeResult?.participants.length, 50);
  const employeeQuery = params(h, "employee_assessment_participants")[0];
  assert.match(employeeQuery.get("select") ?? "", /employees!inner/);
  assert.equal(employeeQuery.get("employees.department"), "eq.Engineering");
  assert.equal(employeeQuery.get("employees.role_title"), "eq.Developer");
  const sessionIds = params(h, "employee_assessment_sessions")[0].get("participant_id")!;
  assert.equal(sessionIds.slice(3, -1).split(",").length, 50);
  assert.ok(!sessionIds.includes(id(150)), "lookahead row must not load dimensions");
});

test("admin list access is checked before service-role read", async () => {
  const h = harness(); h.forbid();
  await assert.rejects(h.load<typeof import("../lib/admin/tests-data.ts")>("lib/admin/tests-data.ts").listAdminSystemTests(), /Forbidden/);
  await assert.rejects(h.load<typeof import("../lib/admin/packages-data.ts")>("lib/admin/packages-data.ts").listAdminSystemAssessmentPackages(), /Forbidden/);
  assert.equal(h.requests.length, 0);
});

test("cursor rejects malformed values, SQL syntax, other company/parent/filters and excessive length", () => {
  const rows = Array.from({ length: 51 }, (_, n) => ({ id: id(n+100), fit_score: 50 }));
  const token = comparisonPage(id(1), id(2), DEFAULT_COMPARISON_FILTERS).finish(rows).nextCursor!;
  assert.ok(comparisonPage(id(1), id(2), DEFAULT_COMPARISON_FILTERS, token).predicate);
  for (const [company, parent, filters] of [[id(3), id(2), DEFAULT_COMPARISON_FILTERS], [id(1), id(3), DEFAULT_COMPARISON_FILTERS],
    [id(1), id(2), { ...DEFAULT_COMPARISON_FILTERS, status: "completed" }]] as const) {
    assert.equal(comparisonPage(company, parent, filters, token).predicate, null);
  }
  for (const invalid of ["%%%", "a".repeat(1025), "null", "[]"]) assert.equal(comparisonPage(id(1), id(2), DEFAULT_COMPARISON_FILTERS, invalid).predicate, null);
  const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  for (const patch of [{ id: "1),status.eq.completed" }, { score: "0)" }, { score: -1 }, { score: 101 }]) {
    const invalid = Buffer.from(JSON.stringify({ ...value, ...patch })).toString("base64url");
    assert.equal(comparisonPage(id(1), id(2), DEFAULT_COMPARISON_FILTERS, invalid).predicate, null);
  }
});
