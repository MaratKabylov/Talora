import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { compileFunction } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { z } from "zod";
import * as performanceCore from "../lib/observability/performance-core.ts";
import * as presentation from "../lib/tests/presentation-settings.ts";
import { fetchAssessmentSection, firstQuestionIndex, sectionUrl } from "../lib/assessment/section-navigation.ts";
import type { AssessmentSectionSnapshot, PublicFlowQuestion } from "../lib/assessment/section-contract.ts";
import * as sectionSaveContract from "../lib/assessment/section-save-contract.ts";
import * as sameOrigin from "../lib/assessment/same-origin.ts";

const require = createRequire(import.meta.url);
require("next/dist/server/node-environment-baseline");
const { NextRequest, NextResponse }: typeof import("next/server") = require("next/server");
type NextRequest = import("next/server").NextRequest;
type NextResponse = import("next/server").NextResponse;

const id = (n: number) => `f7000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = "a".repeat(64);
const body = { assessmentType: "candidate", token, sessionId: id(1), sectionIndex: 1, review: false };
function routeHarness(result: unknown, env: Record<string, string> = { ASSESSMENT_SOFT_NAVIGATION_V2: "true", ASSESSMENT_SECTION_READ_V2: "true" }, fail = false) {
  const calls: unknown[] = [];
  const source = readFileSync(new URL("../app/api/assessment/section/route.ts", import.meta.url), "utf8");
  const { outputText } = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
  const dependencies: Record<string, unknown> = {
    "next/server": { NextRequest, NextResponse }, zod: { z },
    "@/lib/observability/performance-core": performanceCore,
    "@/lib/assessment/same-origin": sameOrigin,
    "@/lib/tests/presentation-settings": presentation,
    "@/lib/assessment/section-prefetch-data": { readAssessmentSectionTransition: async (input: unknown, cached: unknown) => {
      calls.push({ input, cached }); if (fail) throw Error(`private SQL ${token}`); return result;
    } },
    "@/lib/assessment/section-data": { getAssessmentSectionSnapshot: async (input: unknown) => {
      calls.push(input); if (fail) throw Error(`private SQL ${token}`); return result;
    } },
  };
  const exports = {} as { POST: (request: NextRequest) => Promise<NextResponse> };
  compileFunction(outputText, ["exports", "require", "process"])(exports, (name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name];
  }, { env });
  return { ...exports, calls };
}
function request(input: unknown = body, origin = "https://talvia.test", url = "https://talvia.test/api/assessment/section", host = new URL(url).host) {
  return new NextRequest(url, {
    method: "POST", body: JSON.stringify(input), headers: { origin, host, "Content-Type": "application/json" },
  });
}

test("assessment origin guard uses the actual Host header across local aliases", () => {
  assert.equal(sameOrigin.isSameOriginRequest({ headers: new Headers({ origin: "http://127.0.0.1:4333", host: "127.0.0.1:4333" }) }), true);
  assert.equal(sameOrigin.isSameOriginRequest({ headers: new Headers({ origin: "http://127.0.0.1:4333", host: "localhost:4333" }) }), false);
  assert.equal(sameOrigin.isSameOriginRequest({ headers: new Headers({ origin: "not a URL", host: "talvia.test" }) }), false);
});

test("section navigation endpoint calls only the section reader for either scope and never caches token content", async () => {
  const snapshot = { section: null, sections: [], answers: {}, sectionIndex: 0, reviewMode: false, questionOffset: 0, otherVisibleQuestionCount: 0 };
  for (const assessmentType of ["candidate", "employee"]) {
    const route = routeHarness(snapshot);
    const response = await route.POST(request({ ...body, assessmentType, review: true }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), snapshot);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.match(response.headers.get("server-timing")!, /assessment_load_section/);
    assert.deepEqual(route.calls, [{ assessmentType, token, sessionId: id(1), requestedIndex: "1", review: "1",
      presentationSettings: presentation.DEFAULT_TEST_PRESENTATION_SETTINGS }]);
  }
  const aliasRoute = routeHarness(snapshot);
  assert.equal((await aliasRoute.POST(request(body, "http://127.0.0.1:4333", "http://localhost:4333/api/assessment/section", "127.0.0.1:4333"))).status, 200);
});

test("section navigation rejects bad origins, identifiers, indexes and disabled flags before data access", async () => {
  const route = routeHarness(null);
  assert.equal((await route.POST(request(body, "https://foreign.test"))).status, 403);
  for (const invalid of [null, {}, { ...body, token: "bad" }, { ...body, sessionId: "bad" },
    { ...body, sectionIndex: -1 }, { ...body, sectionIndex: 0.5 }, { ...body, sectionIndex: 2 ** 31 },
    { ...body, assessmentType: "other" }, { ...body, review: "1" }]) {
    const response = await route.POST(request(invalid));
    assert.equal(response.status, 400); assert.match(response.headers.get("cache-control")!, /no-store/);
  }
  assert.deepEqual(route.calls, []);
  for (const env of [{ ASSESSMENT_SOFT_NAVIGATION_V2: "false", ASSESSMENT_SECTION_READ_V2: "true" },
    { ASSESSMENT_SOFT_NAVIGATION_V2: "true", ASSESSMENT_SECTION_READ_V2: "false" }]) {
    const disabled = routeHarness(null, env);
    assert.equal((await disabled.POST(request())).status, 409); assert.deepEqual(disabled.calls, []);
  }
});

test("unavailable sessions and RPC errors disclose no token/SQL and do not retry legacy readers", async () => {
  for (const fail of [false, true]) {
    const route = routeHarness(null, undefined, fail);
    const response = await route.POST(request());
    assert.equal(response.status, fail ? 500 : 410);
    const json = JSON.stringify(await response.json());
    assert.ok(!json.includes(token)); assert.ok(!json.includes("SQL")); assert.equal(route.calls.length, 1);
    assert.match(response.headers.get("cache-control")!, /no-store/);
  }
});

test("cached section transitions use fresh state only with prefetch flag; live rollback still uses V2", async () => {
  const cached = { sectionId: id(2), versionId: id(3) };
  for (const assessmentType of ["candidate", "employee"]) for (const flag of ["true", "false"]) {
    const input = { ...body, assessmentType, cached };
    const route = routeHarness({ kind: "state" }, { ASSESSMENT_SOFT_NAVIGATION_V2: "true", ASSESSMENT_SECTION_READ_V2: "true", ASSESSMENT_SECTION_PREFETCH_V3: flag });
    assert.equal((await route.POST(request(input))).status, 200);
    assert.equal(route.calls.length, 1);
    if (flag === "true") assert.deepEqual(route.calls, [{ input, cached }]);
    else assert.ok(!("cached" in (route.calls[0] as object)));
  }
  const route = routeHarness(null);
  assert.equal((await route.POST(request({ ...body, cached: { ...cached, sectionId: "bad" } }))).status, 400);
  assert.deepEqual(route.calls, []);
});

test("prefetch endpoint validates origin/flags/input and returns only no-store data without fallback", async () => {
  const enabled = { ASSESSMENT_SOFT_NAVIGATION_V2: "true", ASSESSMENT_SECTION_READ_V2: "true", ASSESSMENT_SECTION_PREFETCH_V3: "true" };
  function harness(env: Record<string, string> = enabled, data: unknown = null, fail = false) {
    const calls: unknown[] = [];
    const dependencies: Record<string, unknown> = { "next/server": { NextRequest, NextResponse }, zod: { z },
      "@/lib/observability/performance-core": performanceCore,
      "@/lib/assessment/same-origin": sameOrigin,
      "@/lib/assessment/section-prefetch-data": { prefetchAssessmentSection: async (input: unknown) => {
        calls.push(input); if (fail) throw Error(`SQL ${token}`); return data;
      } },
    };
    const { outputText } = transpileModule(readFileSync(new URL("../app/api/assessment/section-prefetch/route.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
    const exports = {} as { POST: (req: NextRequest) => Promise<NextResponse> };
    compileFunction(outputText, ["exports", "require", "process"])(exports, (name: string) => {
      assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
    }, { env });
    return { ...exports, calls };
  }
  for (const assessmentType of ["candidate", "employee"]) {
    const route = harness(); const response = await route.POST(request({ ...body, assessmentType }));
    assert.equal(response.status, 200); assert.equal(await response.json(), null);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.match(response.headers.get("server-timing")!, /assessment_prefetch_section/);
    assert.deepEqual(route.calls, [{ assessmentType, token, sessionId: id(1), sectionIndex: 1 }]);
  }
  const aliasRoute = harness();
  assert.equal((await aliasRoute.POST(request(body, "http://127.0.0.1:4333", "http://localhost:4333/api/assessment/section-prefetch", "127.0.0.1:4333"))).status, 200);
  for (const flag of Object.keys(enabled)) {
    const route = harness({ ...enabled, [flag]: "false" });
    assert.equal((await route.POST(request())).status, 409); assert.deepEqual(route.calls, []);
  }
  const route = harness();
  assert.equal((await route.POST(request(body, "https://foreign.test"))).status, 403);
  for (const invalid of [null, {}, { ...body, token: "bad" }, { ...body, assessmentType: "other" },
    { ...body, sessionId: "bad" }, { ...body, sectionIndex: -1 }, { ...body, sectionIndex: 2 ** 31 }]) {
    assert.equal((await route.POST(request(invalid))).status, 400);
  }
  assert.deepEqual(route.calls, []);
  const failed = harness(undefined, null, true); const response = await failed.POST(request());
  assert.equal(response.status, 500); assert.ok(!(await response.text()).includes(token)); assert.equal(failed.calls.length, 1);
});

test("client section request is POST/no-store/abortable and only returns successful snapshots", async (t) => {
  const input = { ...body, assessmentType: "candidate" as const };
  const controller = new AbortController();
  const calls: RequestInit[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "/api/assessment/section"); calls.push(options);
    return new Response(JSON.stringify({ sectionIndex: 1 }), { status: 200 });
  });
  assert.deepEqual(await fetchAssessmentSection(input, controller.signal), { sectionIndex: 1 });
  assert.equal(calls[0].signal, controller.signal); assert.equal(calls[0].method, "POST"); assert.equal(calls[0].cache, "no-store");
  assert.deepEqual(JSON.parse(calls[0].body as string), input);
  t.mock.restoreAll();
  for (const status of [410, 500]) {
    t.mock.method(globalThis, "fetch", async () => new Response(`private ${token}`, { status }));
    await assert.rejects(fetchAssessmentSection(input, controller.signal), error => !String(error).includes(token));
    t.mock.restoreAll();
  }
});

test("section transitions choose an incomplete visible question or the last question in review", () => {
  const questions = [{ id: id(2), remediationParentId: null }, { id: id(3), remediationParentId: id(2) },
    { id: id(4), remediationParentId: null }] as PublicFlowQuestion[];
  const snapshot = { section: { questions }, answers: {}, reviewMode: false } as Pick<AssessmentSectionSnapshot, "section" | "answers" | "reviewMode">;
  assert.equal(firstQuestionIndex(snapshot), 0);
  const answer = { answerJson: {}, answerText: "saved", selectedOptionId: null, timeSpentSeconds: 10, remediationRequired: false };
  snapshot.answers = { [id(2)]: answer };
  assert.equal(firstQuestionIndex(snapshot), 1);
  snapshot.answers[id(2)] = { ...answer, remediationRequired: true };
  assert.equal(firstQuestionIndex(snapshot), 1);
  snapshot.answers[id(3)] = answer;
  snapshot.answers[id(4)] = answer;
  assert.equal(firstQuestionIndex(snapshot), -1);
  assert.equal(firstQuestionIndex({ ...snapshot, reviewMode: true }), 2);
  assert.equal(firstQuestionIndex({ section: null, answers: {}, reviewMode: true }), -1);
  assert.equal(sectionUrl("/assessment/token/test/session", 2, true), "/assessment/token/test/session?section=2&review=1");
});

test("section-save route gates every required flag and validates before one scoped RPC", async () => {
  const enabled = { ASSESSMENT_SOFT_NAVIGATION_V2: "true", ASSESSMENT_SECTION_READ_V2: "true",
    ASSESSMENT_SECTION_SAVE_V2: "true", SESSION_CONTROL_V2: "true" };
  const input = { assessmentType: "candidate", token, sessionId: id(1), sectionId: id(2), clientId: id(3), deviceId: id(4),
    direction: "next", answers: [{ questionId: id(5), answer: { answerText: "synthetic" }, timeSpentSeconds: 3 }] };
  const active = { status: "active", deadlineAt: "2026-09-07T12:00:00+00:00", savedAt: "2026-09-07T11:59:00+00:00",
    sectionIndex: 0, nextSectionIndex: 1, needsRemediation: false };
  function harness(env: Record<string, string> = enabled, result: unknown = active, error: unknown = null) {
    const calls: unknown[][] = [];
    const dependencies: Record<string, unknown> = {
      "next/server": { NextRequest, NextResponse }, "@/lib/assessment/section-save-contract": sectionSaveContract,
      "@/lib/assessment/same-origin": sameOrigin,
      "@/lib/observability/performance-core": performanceCore,
      "@/lib/observability/server-performance": { measureServerOperation: (_name: string, task: () => unknown) => task() },
      "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (...args: unknown[]) => {
        calls.push(args); return { data: result, error };
      } }) },
    };
    const { outputText } = transpileModule(readFileSync(new URL("../app/api/assessment/section-save/route.ts", import.meta.url), "utf8"),
      { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
    const exports = {} as { POST: (req: NextRequest) => Promise<NextResponse> };
    compileFunction(outputText, ["exports", "require", "process"])(exports, (name: string) => {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name];
    }, { env });
    return { ...exports, calls };
  }
  for (const assessmentType of ["candidate", "employee"]) {
    const route = harness(undefined, { ...active, privateSql: token });
    const response = await route.POST(request({ ...input, assessmentType }));
    assert.deepEqual(await response.json(), active);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.match(response.headers.get("server-timing")!, /assessment_save_section/);
    assert.deepEqual(route.calls, [["save_assessment_section_v2", { p_scope: assessmentType, p_token: token,
      p_session_id: id(1), p_section_id: id(2), p_client_id: id(3), p_device_id: id(4), p_direction: "next", p_answers: input.answers }]]);
  }
  for (const flag of Object.keys(enabled)) {
    const route = harness({ ...enabled, [flag]: "false" });
    assert.equal((await route.POST(request(input))).status, 409); assert.deepEqual(route.calls, []);
  }
  const route = harness();
  assert.equal((await route.POST(request(input, "https://foreign.test"))).status, 403);
  const aliasRoute = harness();
  assert.equal((await aliasRoute.POST(request(input, "http://127.0.0.1:4333", "http://localhost:4333/api/assessment/section-save", "127.0.0.1:4333"))).status, 200);
  for (const invalid of [{}, { ...input, token: "bad" }, { ...input, direction: "skip" },
    { ...input, answers: Array(1001).fill(input.answers[0]) },
    { ...input, answers: [{ ...input.answers[0], timeSpentSeconds: -1 }] }]) {
    assert.equal((await route.POST(request(invalid))).status, 400);
  }
  assert.deepEqual(route.calls, []);
  for (const data of [{ status: "blocked", retryAfterSeconds: 90 }, { status: "expired" },
    { status: "terminal" }, { status: "unavailable" }]) {
    const response = await harness(undefined, data).POST(request(input));
    assert.deepEqual(await response.json(), data);
  }
  for (const [data, error, status] of [[null, { code: "TVS01", message: token }, 400],
    [null, { code: "XX000", message: token }, 500], [{ unexpected: token }, null, 500]] as const) {
    const failed = harness(undefined, data, error);
    const response = await failed.POST(request(input));
    assert.equal(response.status, status); assert.ok(!(await response.text()).includes(token));
    assert.equal(failed.calls.length, 1);
  }
  const diagnostics: string[] = [];
  const originalInfo = console.info;
  console.info = (...values: unknown[]) => { diagnostics.push(values.join(" ")); };
  try {
    const failed = harness({ ...enabled, PERFORMANCE_TELEMETRY_ENABLED: "true" }, null, { code: "XX000", message: token });
    assert.equal((await failed.POST(request(input))).status, 500);
  } finally {
    console.info = originalInfo;
  }
  assert.equal(diagnostics.length, 1);
  const diagnostic = JSON.parse(diagnostics[0]) as Record<string, unknown>;
  assert.equal(diagnostic.event, "assessment.section_save_failure");
  assert.equal(diagnostic.operation, "assessment.save_section");
  assert.equal(diagnostic.category, "database");
  assert.equal(diagnostic.code, "XX000");
  assert.equal(diagnostic.version, 1);
  assert.match(String(diagnostic.correlationId), /^req_[0-9a-f-]{36}$/i);
  assert.ok(Number.isFinite(Date.parse(String(diagnostic.timestamp))));
  assert.ok(!diagnostics[0].includes(token));
});
