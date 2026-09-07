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

const require = createRequire(import.meta.url);
require("next/dist/server/node-environment-baseline");
const { NextRequest, NextResponse }: typeof import("next/server") = require("next/server");
type NextRequest = import("next/server").NextRequest;
type NextResponse = import("next/server").NextResponse;

const id = (n: number) => `f7000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = "a".repeat(64);
const body = { assessmentType: "candidate", token, sessionId: id(1), sectionIndex: 1, review: false };
function routeHarness(result: unknown, env = { ASSESSMENT_SOFT_NAVIGATION_V2: "true", ASSESSMENT_SECTION_READ_V2: "true" }, fail = false) {
  const calls: unknown[] = [];
  const source = readFileSync(new URL("../app/api/assessment/section/route.ts", import.meta.url), "utf8");
  const { outputText } = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
  const dependencies: Record<string, unknown> = {
    "next/server": { NextRequest, NextResponse }, zod: { z },
    "@/lib/observability/performance-core": performanceCore,
    "@/lib/tests/presentation-settings": presentation,
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
function request(input: unknown = body, origin = "https://talvia.test") {
  return new NextRequest("https://talvia.test/api/assessment/section", {
    method: "POST", body: JSON.stringify(input), headers: { origin, "Content-Type": "application/json" },
  });
}

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
