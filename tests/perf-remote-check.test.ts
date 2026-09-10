import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

type Report = { checks: { name: string; passed: boolean }[]; explain: { available: boolean; code: string } };
const { runRemoteCheck }: {
  runRemoteCheck: (env: Record<string, string>, fetchImpl: typeof fetch) => Promise<Report>;
} = await import(new URL("../scripts/perf-remote-check.mjs", import.meta.url).href);

function mockProject(allowAnon = false) {
  const source = readFileSync(new URL("../supabase/verification/dashboard_list_read_models.sql", import.meta.url), "utf8");
  const paths: Record<string, object> = {};
  const definitions: Record<string, { properties: Record<string, object> }> = {};
  for (const match of source.matchAll(/\('([^']+)', array\[([^\]]+)\]/g)) {
    paths[`/${match[1]}`] = {};
    definitions[match[1]] = { properties: Object.fromEntries([...match[2].matchAll(/'([^']+)'/g)].map(column => [column[1], {}])) };
  }
  for (const name of ["list_company_test_templates", "list_company_assessment_packages"]) paths[`/rpc/${name}`] = {};
  const calls: string[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    assert.equal(init?.method ?? "GET", "GET");
    assert.equal(url.origin, "https://fixture.supabase.test");
    calls.push(url.pathname);
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/rest/v1/") return json({ paths, definitions });
    assert.equal(url.searchParams.get("limit"), "0", "Every data/RPC/plan request must be bounded to zero rows");
    if (headers.get("Accept")?.includes("pgrst.plan")) {
      assert.ok(!headers.get("Accept")?.includes("analyze"));
      return json({ code: "PGRST107", message: "PRIVATE_ERROR_SENTINEL" }, 406);
    }
    if (url.pathname.includes("/rpc/") || (!allowAnon && headers.get("apikey") === "fixture-anon")) {
      return json({ code: "42501", message: "PRIVATE_ERROR_SENTINEL" }, 403);
    }
    return json([]);
  };
  return { transport, calls };
}
const env = { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.test", SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon" };

test("remote smoke is GET/LIMIT 0 only, verifies grants, and excludes secrets/raw errors", async () => {
  const { transport, calls } = mockProject();
  const report = await runRemoteCheck(env, transport);
  assert.equal(report.checks.length, 25);
  assert.ok(report.checks.every(check => check.passed));
  assert.equal(report.explain.available, false); assert.equal(report.explain.code, "PGRST107");
  assert.equal(calls.length, 19);
  const serialized = JSON.stringify(report);
  for (const secret of ["fixture-service", "fixture-anon", "fixture.supabase.test", "PRIVATE_ERROR_SENTINEL"]) {
    assert.ok(!serialized.includes(secret));
  }
});

test("remote smoke flags an unexpectedly readable anon view", async () => {
  const { transport } = mockProject(true);
  const report = await runRemoteCheck(env, transport);
  const failures = report.checks.filter(check => !check.passed);
  assert.equal(failures.length, 5);
  assert.ok(failures.every(check => check.name.endsWith(":anon:select")));
});
