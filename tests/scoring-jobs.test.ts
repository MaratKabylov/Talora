import assert from "node:assert/strict";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import test from "node:test";

import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { z } from "zod";

const id = (n: number) => `fc000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function load<T>(path: string, dependencies: Record<string, unknown>, env: Record<string, string> = {}): T {
  const { outputText } = transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  });
  const exports = {};
  compileFunction(outputText, ["exports", "require", "process", "Buffer"])(exports, (name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), name);
    return dependencies[name];
  }, { env }, Buffer);
  return exports as T;
}

test("scoring worker claims bounded jobs and reports safe terminal outcomes", async () => {
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const finalizations: unknown[] = [];
  let finish = 0;
  const admin = { rpc: async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push([name, args]);
    if (name === "enqueue_scoring_job") return { data: { status: "queued", jobId: id(1) }, error: null };
    if (name === "claim_scoring_jobs") return { data: [
      { attempt: 1, expectedRevision: 2, invitationId: id(11), jobId: id(1), parentId: id(21), scope: "candidate" },
      { attempt: 1, expectedRevision: 3, invitationId: id(12), jobId: id(2), parentId: id(22), scope: "employee" },
      { attempt: 1, expectedRevision: 4, invitationId: id(13), jobId: id(3), parentId: id(23), scope: "candidate" },
    ], error: null };
    if (name === "finish_scoring_job") {
      finish += 1;
      return { data: { status: finish === 1 ? "completed" : finish === 2 ? "retry" : "failed" }, error: null };
    }
    throw new Error(`unexpected ${name}`);
  } };
  const jobs = load<typeof import("../lib/scoring/jobs.ts")>("../lib/scoring/jobs.ts", {
    "server-only": {}, "node:crypto": { randomUUID: () => id(99) }, zod: { z },
    "@/lib/supabase/admin": { createAdminClient: () => admin },
    "./finalization": {
      finalizeCompletedCandidateAssessment: async (input: unknown) => {
        finalizations.push(input);
        return finalizations.length === 1 ? "completed" : "processing";
      },
      finalizeCompletedEmployeeAssessment: async (input: unknown) => {
        finalizations.push(input);
        throw new Error("private scoring details");
      },
    },
  });

  assert.equal(await jobs.enqueueAssessmentScoring({
    invitationId: id(11), parentId: id(21), retryFailed: true, scope: "candidate",
  }), "queued");
  assert.deepEqual(rpcCalls[0], ["enqueue_scoring_job", {
    p_invitation_id: id(11), p_parent_id: id(21), p_retry_failed: true, p_scope: "candidate",
  }]);
  const result = await jobs.drainScoringJobs({ leaseSeconds: 9999, limit: 99 });
  assert.deepEqual(result, { claimed: 3, completed: 1, failed: 1, retried: 1, unresolved: 0 });
  assert.deepEqual(rpcCalls[1], ["claim_scoring_jobs", {
    p_lease_seconds: 900, p_limit: 10, p_worker_id: id(99),
  }]);
  assert.equal(finalizations.length, 3);
  assert.deepEqual(rpcCalls.slice(2).map(([, args]) => args.p_error_code), [null, "scoring_failed", "parent_busy"]);
  assert.ok(!JSON.stringify(result).includes("private scoring details"));
});

test("internal drain endpoint requires the server flag and constant-time bearer secret", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  require("next/dist/server/node-environment-baseline");
  const { NextRequest, NextResponse } = require("next/server") as typeof import("next/server");
  const calls: unknown[] = [];
  const route = load<typeof import("../app/api/internal/scoring/drain/route.ts")>(
    "../app/api/internal/scoring/drain/route.ts",
    {
      "node:crypto": { createHash, timingSafeEqual }, "next/server": { NextRequest, NextResponse }, zod: { z },
      "@/lib/scoring/jobs": { drainScoringJobs: async (input: unknown) => {
        calls.push(input); return { claimed: 1, completed: 1, failed: 0, retried: 0, unresolved: 0 };
      } },
    },
    { ASSESSMENT_ASYNC_SCORING_V2: "true", SCORING_WORKER_SECRET: "correct-secret-with-at-least-32-chars" },
  );
  const request = (secret: string, body: unknown = { limit: 2 }) => new NextRequest(
    "https://talvia.test/api/internal/scoring/drain",
    { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  assert.equal((await route.POST(request("wrong-secret"))).status, 401);
  assert.equal((await route.POST(request("correct-secret-with-at-least-32-chars", { limit: 11 }))).status, 400);
  const response = await route.POST(request("correct-secret-with-at-least-32-chars"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { claimed: 1, completed: 1, failed: 0, retried: 0, unresolved: 0 });
  assert.deepEqual(calls, [{ limit: 2 }]);
  assert.match(response.headers.get("cache-control")!, /no-store/);
});
