import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { listPage, normalizeListParams } from "../lib/lists/pagination.ts";
import { comparisonPage, DEFAULT_COMPARISON_FILTERS } from "../lib/comparison/pagination.ts";
import { JOB_LIST_SELECT, TEST_TEMPLATE_LIST_SELECT, PACKAGE_LIST_SELECT, EMPLOYEE_ASSESSMENT_LIST_SELECT } from "../lib/lists/read-models.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const id = (n: number) => `fa100000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function harness() {
  const requests: URL[] = [];
  const responses = new Map<string, unknown>();
  const bodies: Record<string, unknown>[] = [];
  let platformRole = "platform_admin";
  let failure: string | null = null;
  let platformAllowed = true;
  const client = createClient("https://example.test", "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
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
    "lib/admin/context.ts": { requirePlatformContext: async () => { if (!platformAllowed) throw Error("Forbidden"); return { role: platformRole }; } },
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
    const { outputText } = transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX } });
    compileFunction(outputText, ["exports", "module", "require", "process"])(loadedModule.exports, loadedModule, (name: string) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name.startsWith(".") || name.startsWith("@/")) {
        const target = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(path), name);
        return load(/\.tsx?$/.test(target) ? target : existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`);
      }
      return require(name);
    }, process);
    return loadedModule.exports as T;
  }
  return { requests, responses, bodies, load, role: (role: string) => { platformRole = role; }, fail: (name: string) => { failure = name; }, forbid: () => { platformAllowed = false; } };
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
  for (const [table, select] of [["jobs", JOB_LIST_SELECT], ["list_company_test_templates", TEST_TEMPLATE_LIST_SELECT],
    ["list_company_assessment_packages", PACKAGE_LIST_SELECT], ["employee_assessment_list", EMPLOYEE_ASSESSMENT_LIST_SELECT]]) {
    const queries = params(h, table); assert.ok(queries.length);
    for (const query of queries) {
      assert.equal(query.get("select"), select.replaceAll(" ", ""));
      assert.equal(query.get("limit"), "51");
      assert.equal(query.get("order"), "updated_at.desc,id.asc");
      if (!table.startsWith("list_company_")) assert.equal(query.get("company_id"), `eq.${id(1)}`);
    }
  }
  assert.deepEqual(h.bodies, [{ target_company_id: id(1) }, { target_company_id: id(1) }]);
  assert.equal(params(h, "company_system_test_access").length, 0);
  assert.equal(params(h, "get_accessible_system_package_ids").length, 0);
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
    assert.equal(query.get("limit"), "51");
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
  const rows = Array.from({ length: 51 }, (_, n) => ({ id: id(100+n), fit_score: 50, scoring_revision: 1, status: "completed",
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
  h.responses.set("employee_assessment_dimension_scores", rows.slice(0, 50).map((row, index) => ({
    assessment_domain: "skills", dimension_id: `dimension:${index}`, dimension_key: "communication",
    display_order: index, group_key: "knowledge_skills", interpretation_direction: "higher_better",
    participant_id: row.id, percentage: 80, scoring_revision: 1, session_id: id(500 + index),
    source_type: "criterion", test_version_id: id(700 + index), title: `Dimension ${index}`,
  })));
  const employeeResult = await h.load<typeof import("../lib/employee-assessments/data.ts")>("lib/employee-assessments/data.ts")
    .getEmployeeComparisonData(id(1), id(2), { ...filters, department: "Engineering", roleTitle: "Developer" });
  assert.equal(employeeResult?.participants.length, 50);
  const employeeQuery = params(h, "employee_assessment_participants")[0];
  assert.match(employeeQuery.get("select") ?? "", /employees!inner/);
  assert.equal(employeeQuery.get("employees.department"), "eq.Engineering");
  assert.equal(employeeQuery.get("employees.role_title"), "eq.Developer");
  const dimensionIds = params(h, "employee_assessment_dimension_scores")[0].get("participant_id")!;
  assert.equal(dimensionIds.slice(3, -1).split(",").length, 50);
  assert.ok(!dimensionIds.includes(id(150)), "lookahead row must not load dimensions");
  assert.equal(params(h, "employee_assessment_sessions").length, 0);
  assert.equal(params(h, "employee_assessment_test_results").length, 0);
  assert.equal(params(h, "employee_assessment_competency_scores").length, 0);
  assert.equal(params(h, "test_versions").length, 0);
});

test("employee comparison limits rollout fallback to participants missing the current materialized revision", async () => {
  const h = harness();
  const participants = [1, 2].map((n) => ({
    id: id(100 + n), fit_score: 50, scoring_revision: 2, status: "completed",
    employees: { id: id(300 + n), full_name: `Employee ${n}` },
  }));
  h.responses.set("employee_assessments", { id: id(2), title: "Fixture", status: "active" });
  h.responses.set("employee_assessment_participants", participants);
  h.responses.set("employee_assessment_list", { participant_count: 2 });
  h.responses.set("employee_comparison_filters", { departments: [], role_titles: [] });
  h.responses.set("employee_assessment_dimension_scores", [{
    assessment_domain: "skills", dimension_id: "dimension:one", dimension_key: "communication",
    display_order: 0, group_key: "knowledge_skills", interpretation_direction: "higher_better",
    participant_id: participants[0].id, percentage: 75, scoring_revision: 2, session_id: id(501),
    source_type: "criterion", test_version_id: id(701), title: "Communication",
  }]);

  const result = await h.load<typeof import("../lib/employee-assessments/data.ts")>("lib/employee-assessments/data.ts")
    .getEmployeeComparisonData(id(1), id(2));
  assert.equal(result?.participants[0].dimensions["dimension:one"].value, 75);
  const fallback = params(h, "employee_assessment_sessions")[0].get("participant_id");
  assert.equal(fallback, `in.(${participants[1].id})`);
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

test("date cursor preserves microseconds, binds scope and filters, and caps pages", () => {
  const rows = Array.from({ length: 101 }, (_, n) => ({ id: id(100+n), created_at: "2026-09-09T10:00:00.123456+00:00" }));
  const first = listPage(["candidates", id(1), id(2)], "created_at").finish(rows);
  assert.equal(first.items.length, 50);
  assert.equal(first.hasCursor, false);
  const cursor = first.nextCursor!;
  assert.match(listPage(["candidates", id(1), id(2)], "created_at", { cursor }).predicate!, /123456/);
  for (const scope of [["jobs", id(1), id(2)], ["candidates", id(2), id(2)], ["candidates", id(1), id(3)]]) {
    assert.equal(listPage(scope, "created_at", { cursor }).predicate, null);
  }
  for (const change of [{ sort: "date_asc" }, { q: "Ann" }, { status: "completed" }, { review: "true" }, { pageSize: "100" }, { company: id(3) }, { kind: "company" }]) {
    assert.equal(listPage(["candidates", id(1), id(2)], "created_at", { cursor, ...change }).predicate, null);
  }
  const raw = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  for (const patch of [{ id: "1),status.eq.completed" }, { value: null }, { value: "2026-09-09T10:00:00Z),id.gt.0" }, { value: "infinity" }, { value: "2026-99-99T00:00:00Z" }]) {
    const invalid = Buffer.from(JSON.stringify({ ...raw, ...patch })).toString("base64url");
    assert.equal(listPage(["candidates", id(1), id(2)], "created_at", { cursor: invalid }).predicate, null);
  }
  for (const cursor of ["%%%", "a".repeat(1025), "null", "[]"]) {
    assert.equal(listPage(["candidates", id(1)], "created_at", { cursor }).predicate, null);
  }
  for (const pageSize of ["", "-1", "0", "NaN", "1.5"]) assert.equal(normalizeListParams({ pageSize }).pageSize, 50);
  assert.equal(normalizeListParams({ pageSize: "10000" }).pageSize, 100);
  assert.equal(listPage(["test"], "created_at", { pageSize: "100" }).finish(rows).items.length, 100);
  assert.equal(listPage(["test"], "created_at").finish(rows.slice(0, 50)).nextCursor, null);
  assert.deepEqual(listPage(["test"], "created_at").finish([]).items, []);
  assert.equal(normalizeListParams({ company: "invalid" }).company, "00000000-0000-0000-0000-000000000000");
  assert.equal(normalizeListParams({ q: ["a", "b"] as unknown as string }).q, "");
});

test("candidate paging filters the parent via inner search, preserves tenant and latest invitation, and returns only a page", async () => {
  const h = harness();
  const rows = Array.from({ length: 101 }, (_, n) => ({ id: id(100+n), created_at: "2026-09-09T10:00:00.123456Z", candidates: { id: id(300+n), full_name: "Fixture" } }));
  h.responses.set("candidate_applications", rows);
  const loader = h.load<typeof import("../lib/candidates/data.ts")>("lib/candidates/data.ts");
  const filters = { q: "50%_\\name", status: "completed", review: "true", sort: "date_asc", pageSize: "1000" };
  const first = await loader.listJobCandidateApplications(id(1), id(2), filters);
  assert.equal(first.items.length, 100); assert.ok(first.nextCursor);
  await loader.listJobCandidateApplications(id(1), id(2), { ...filters, cursor: first.nextCursor! });
  const query = params(h, "candidate_applications")[1];
  assert.equal(query.get("limit"), "101"); assert.equal(query.get("offset"), null);
  assert.equal(query.get("order"), "created_at.asc,id.asc");
  assert.equal(query.get("company_id"), `eq.${id(1)}`); assert.equal(query.get("job_id"), `eq.${id(2)}`);
  assert.equal(query.get("status"), "eq.completed"); assert.equal(query.get("requires_review"), "eq.true");
  assert.equal(query.get("candidates.full_name"), "ilike.%50\\%\\_\\\\name%");
  assert.match(query.get("select")!, /candidates!inner/); assert.match(query.get("or")!, /created_at.gt.*123456/);
  assert.equal(query.get("invitations.limit"), "1");
  h.fail("candidate_applications");
  await assert.rejects(loader.listCandidateApplications(id(1)), /^Error: Unable to load candidate applications\.$/);
});

test("employee participant page is bounded and retains parent filters without duplicating raw invitations in metadata", async () => {
  const h = harness();
  h.responses.set("employee_assessments", { id: id(2) });
  h.responses.set("employee_assessment_participants", Array.from({ length: 51 }, (_, n) => ({
    id: id(100+n), created_at: "2026-09-09T00:00:00Z", employees: { id: id(300+n), full_name: "Fixture" },
  })));
  const data = await h.load<typeof import("../lib/employee-assessments/data.ts")>("lib/employee-assessments/data.ts")
    .getEmployeeAssessmentPageData(id(1), id(2), { q: "Fixture", status: "invited", review: "true" });
  assert.equal(data?.participants.length, 50); assert.ok(data?.participantPage.nextCursor);
  assert.equal("items" in data!.participantPage, false);
  const query = params(h, "employee_assessment_participants")[0];
  assert.equal(query.get("company_id"), `eq.${id(1)}`); assert.equal(query.get("employee_assessment_id"), `eq.${id(2)}`);
  assert.equal(query.get("limit"), "51"); assert.equal(query.get("order"), "created_at.desc,id.asc");
  assert.equal(query.get("employees.full_name"), "ilike.%Fixture%"); assert.equal(query.get("status"), "eq.invited");
  assert.equal(query.get("requires_review"), "eq.true"); assert.match(query.get("select")!, /employees!inner/);
});

test("all four admin list queries paginate after platform authorization and keep company/PII restrictions", async () => {
  const h = harness();
  const loader = h.load<typeof import("../lib/admin/data.ts")>("lib/admin/data.ts");
  const filters = { company: id(1), status: "active", pageSize: "25", sort: "date_asc", q: "Fixture", review: "true" };
  await loader.listAdminCompanies(filters); await loader.listAdminApplications(filters);
  await loader.listAdminUsers(filters); await loader.listPlatformAudit(filters);
  for (const table of ["companies", "candidate_applications", "company_users", "platform_audit_logs"]) {
    const query = params(h, table)[0];
    assert.equal(query.get("limit"), "26"); assert.equal(query.get("order"), "created_at.asc,id.asc");
    assert.equal(query.get("offset"), null);
    if (table !== "companies") assert.equal(query.get("company_id"), `eq.${id(1)}`);
  }
  assert.equal(params(h, "candidate_applications")[0].get("requires_review"), "eq.true");
  assert.equal(params(h, "company_users")[0].get("profiles.full_name"), "ilike.%Fixture%");
  h.role("platform_analyst");
  const users = await loader.listAdminUsers(); assert.equal(users.items.length, 0);
  assert.equal(params(h, "company_users").length, 1);
  await loader.listAdminApplications();
  assert.doesNotMatch(params(h, "candidate_applications")[1].get("select")!, /candidates\(/);
  h.forbid(); const before = h.requests.length;
  for (const call of [() => loader.listAdminCompanies(), () => loader.listAdminApplications(), () => loader.listAdminUsers(), () => loader.listPlatformAudit()]) {
    await assert.rejects(call(), /Forbidden/);
  }
  assert.equal(h.requests.length, before);
});

test("list controls preserve URL filters and sorting on next/reset links, reset cursor on form submission, and render empty state", () => {
  const { ListControls } = harness().load<typeof import("../components/lists/list-controls.tsx")>("components/lists/list-controls.tsx");
  const html = renderToStaticMarkup(createElement(ListControls, {
    path: "/dashboard/candidates", params: { q: "Имя & имя", status: "completed", review: "true", sort: "date_asc", pageSize: "25", cursor: "old" },
    nextCursor: "next", hasCursor: true, count: 25, search: "Имя", statuses: { completed: "Завершено" }, review: true,
  }));
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(match => new URL(match[1].replaceAll("&amp;", "&"), "https://example.test"));
  assert.equal(links.length, 2);
  for (const url of links) {
    assert.equal(url.pathname, "/dashboard/candidates"); assert.equal(url.searchParams.get("q"), "Имя & имя");
    assert.equal(url.searchParams.get("status"), "completed"); assert.equal(url.searchParams.get("sort"), "date_asc");
    assert.equal(url.searchParams.get("review"), "true"); assert.equal(url.searchParams.get("pageSize"), "25");
  }
  assert.equal(links[0].searchParams.get("cursor"), null); assert.equal(links[1].searchParams.get("cursor"), "next");
  assert.doesNotMatch(html, /name="cursor"/); assert.match(html, /action="\/dashboard\/candidates"/);
  const empty = renderToStaticMarkup(createElement(ListControls, {
    path: "/dashboard/jobs", params: {}, nextCursor: null, hasCursor: false, count: 0,
  }));
  assert.match(empty, /Нет результатов/); assert.doesNotMatch(empty, /Следующая страница|В начало/);
});
