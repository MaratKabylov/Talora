import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { z } from "zod";
import * as contract from "../lib/assessment/completion-contract.ts";
import * as perf from "../lib/observability/performance-core.ts";
import * as sameOrigin from "../lib/assessment/same-origin.ts";

const require = createRequire(import.meta.url);
require("next/dist/server/node-environment-baseline");
const next: typeof import("next/server") = require("next/server");
const id = (n: number) => `fb000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = "a".repeat(64);
const input: contract.CompletionRequest = { assessmentType: "candidate", token, sessionId: id(1), clientId: id(2), deviceId: id(3) };
function load<T>(path: string, dependencies: Record<string, unknown>, env: Record<string, string> = {}): T {
  const { outputText } = transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
  const exports = {};
  compileFunction(outputText, ["exports", "require", "process"])(exports, (name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  }, { env });
  return exports as T;
}
function harness(data: unknown, error = false, scoreResult: "completed" | "processing" | "not_ready" | "error" = "completed") {
  const calls: unknown[][] = []; const scores: unknown[] = [];
  const score = async (scope: string, args: unknown) => { scores.push({ scope, args }); if (scoreResult === "error") throw Error("scoring failed"); return scoreResult; };
  const helper = load<typeof import("../lib/assessment/completion-v2.ts")>("../lib/assessment/completion-v2.ts", {
    "server-only": {}, zod: { z }, "./completion-contract": contract,
    "@/lib/observability/server-performance": { measureServerOperation: (_name: string, fn: () => unknown) => fn() },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (...args: unknown[]) => {
      calls.push(args); return { data, error: error ? { message: `SQL ${token}` } : null };
    } }) },
    "@/lib/scoring/finalization": { finalizeCompletedCandidateAssessment: (args: unknown) => score("candidate", args),
      finalizeCompletedEmployeeAssessment: (args: unknown) => score("employee", args) },
  });
  return { ...helper, calls, scores };
}

test("completion uses one RPC and no overview/answer read; only last session enters existing scoring", async () => {
  for (const assessmentType of ["candidate", "employee"] as const) {
    const root = `/${assessmentType === "employee" ? "employee-assessment" : "assessment"}/${token}`;
    for (const [data, expected] of [[{ status: "next", nextSessionId: id(5) }, { status: "redirect", redirectTo: `${root}/test/${id(5)}` }],
      [{ status: "next", nextSessionId: null }, { status: "redirect", redirectTo: root }], [{ status: "finished" }, { status: "redirect", redirectTo: `${root}/complete` }],
      [{ status: "unavailable" }, { status: "redirect", redirectTo: root }], [{ status: "expired" }, { status: "expired" }],
      [{ status: "incomplete", sectionIndex: 2 }, { status: "incomplete", sectionIndex: 2 }],
      [{ status: "blocked", retryAfterSeconds: 90 }, { status: "blocked", retryAfterSeconds: 90 }]]) {
      const h = harness({ ...data, scoringKeys: token });
      assert.deepEqual(await h.completeAssessmentSessionV2({ ...input, assessmentType }), expected); assert.deepEqual(h.scores, []);
      assert.deepEqual(h.calls, [["complete_assessment_session_v2", { p_scope: assessmentType, p_token: token,
        p_session_id: id(1), p_client_id: id(2), p_device_id: id(3) }]]);
    }
    for (const outcome of ["completed", "processing", "not_ready"] as const) {
      const h = harness({ status: "ready", ownerId: id(6), invitationId: id(7) }, false, outcome);
      const result = await h.completeAssessmentSessionV2({ ...input, assessmentType });
      assert.deepEqual(result, outcome === "processing" ? { status: "processing" } : { status: "redirect", redirectTo: outcome === "completed" ? `${root}/complete` : root });
      assert.deepEqual(h.scores, [{ scope: assessmentType, args: { invitationId: id(7), readiness: "completion_v2", [assessmentType === "employee" ? "participantId" : "applicationId"]: id(6) } }]);
      assert.ok(!JSON.stringify(result).includes(id(6))); assert.ok(!JSON.stringify(result).includes(id(7)));
    }
  }
});

test("RPC/DTO errors never fall back; a scoring failure can retry ready without another answer write", async () => {
  for (const [data, error] of [[null, true], [{ status: "ready", ownerId: "invalid" }, false], [{ status: "unexpected" }, false]] as const) {
    const h = harness(data, error); await assert.rejects(h.completeAssessmentSessionV2(input), e => !String(e).includes(token));
    assert.equal(h.calls.length, 1); assert.deepEqual(h.scores, []);
  }
  const failed = harness({ status: "ready", ownerId: id(6), invitationId: id(7) }, false, "error");
  await assert.rejects(failed.completeAssessmentSessionV2(input), /scoring failed/);
  const retry = harness({ status: "ready", ownerId: id(6), invitationId: id(7) });
  assert.equal((await retry.completeAssessmentSessionV2(input)).status, "redirect"); assert.equal(retry.scores.length, 1);
  const invalid = harness(null); await assert.rejects(invalid.completeAssessmentSessionV2({ ...input, clientId: "invalid" }));
  assert.deepEqual(invalid.calls, []);
});

test("completion route gates flags/origin/identity and protects errors with no-store headers", async () => {
  const enabled = { ASSESSMENT_COMPLETION_V2: "true", SESSION_CONTROL_V2: "true", ASSESSMENT_SOFT_NAVIGATION_V2: "true", ASSESSMENT_SECTION_READ_V2: "true" };
  function route(env: Record<string, string> = enabled, fail = false) {
    const calls: unknown[] = [];
    const endpoint = load<typeof import("../app/api/assessment/complete/route.ts")>("../app/api/assessment/complete/route.ts", {
      "next/server": next, "@/lib/observability/performance-core": perf, "@/lib/assessment/completion-contract": contract,
      "@/lib/assessment/same-origin": sameOrigin,
      "@/lib/assessment/completion-v2": { completeAssessmentSessionV2: async (args: unknown) => { calls.push(args); if (fail) throw Error(token); return { status: "processing" }; } },
    }, env); return { ...endpoint, calls };
  }
  const request = (body: unknown = input, origin = "https://talvia.test", url = "https://talvia.test/api/assessment/complete", host = new URL(url).host) => new next.NextRequest(url, {
    method: "POST", headers: { origin, host, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const good = route(); const response = await good.POST(request({ ...input, answers: "Must not be forwarded" }));
  assert.deepEqual(await response.json(), { status: "processing" }); assert.deepEqual(good.calls, [input]);
  assert.match(response.headers.get("server-timing")!, /assessment_complete/);
  for (const flag of Object.keys(enabled)) {
    const off = route({ ...enabled, [flag]: "false" }); const response = await off.POST(request());
    assert.equal(response.status, 409); assert.match(response.headers.get("cache-control")!, /no-store/); assert.deepEqual(off.calls, []);
  }
  const invalid = route(); assert.equal((await invalid.POST(request(input, "https://foreign.test"))).status, 403);
  const alias = route();
  assert.equal((await alias.POST(request(input, "http://127.0.0.1:4333", "http://localhost:4333/api/assessment/complete", "127.0.0.1:4333"))).status, 200);
  for (const body of [null, {}, { ...input, sessionId: "bad" }, { ...input, token: "bad" }, { ...input, assessmentType: "other" }, { ...input, deviceId: "bad" }]) {
    assert.equal((await invalid.POST(request(body))).status, 400);
  }
  assert.deepEqual(invalid.calls, []);
  const failed = route(undefined, true); const errorResponse = await failed.POST(request());
  assert.equal(errorResponse.status, 500); assert.ok(!(await errorResponse.text()).includes(token)); assert.equal(failed.calls.length, 1);
});

test("client completion is explicit POST and redirects only within the scoped invitation", async t => {
  const path = `/assessment/${token}/test/${id(5)}`;
  let status = 200; let result: unknown = { status: "redirect", redirectTo: path };
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "/api/assessment/complete"); assert.equal(options.method, "POST"); assert.equal(options.cache, "no-store");
    assert.deepEqual(JSON.parse(String(options.body)), input); return Response.json(result, { status });
  });
  assert.deepEqual(await contract.requestAssessmentCompletion(input), result);
  for (const redirectTo of ["https://foreign.test", "javascript:alert(1)", `//foreign.test/${token}`, `/employee-assessment/${token}/complete`,
    `/assessment/${"b".repeat(64)}/complete`, `${path}?redirect=https://foreign.test`, `${path}/../other`, "/dashboard"]) {
    result = { status: "redirect", redirectTo }; await assert.rejects(contract.requestAssessmentCompletion(input));
  }
  for (const code of [409, 500]) { status = code; await assert.rejects(contract.requestAssessmentCompletion(input), e => !String(e).includes(token)); }
});
