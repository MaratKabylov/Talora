import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileFunction } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { z } from "zod";

import * as forcedChoice from "../lib/forced-choice.ts";
import * as multipleChoice from "../lib/answers/multiple-choice.ts";
import * as presentation from "../lib/tests/presentation-settings.ts";
import * as structured from "../lib/structured-questions.ts";

type Controls = typeof import("../lib/assessment/session-control.ts");
type V2 = typeof import("../lib/assessment/session-control-v2.ts");
const identity = {
  token: "a".repeat(64),
  sessionId: "f3000000-0000-4000-8000-000000000001",
  clientId: "f3000000-0000-4000-8000-000000000002",
  deviceId: "f3000000-0000-4000-8000-000000000003",
};
const eventId = "f3000000-0000-4000-8000-000000000004";

function loadModule<T>(path: string, dependencies: Record<string, unknown>, flag?: string): T {
  const { outputText } = transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  });
  const exports = {};
  compileFunction(outputText, ["exports", "require", "process"])(exports, (specifier: string) => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected import: ${specifier}`);
    return dependencies[specifier];
  }, { env: { SESSION_CONTROL_V2: flag } });
  return exports as T;
}

function harness({ flag = "true", response = { status: "active", deadlineAt: null } as unknown, rpcError = false, expired = false } = {}) {
  const calls = { rpc: [] as unknown[][], from: [] as string[], candidateReads: 0, employeeReads: 0, candidateCompletions: 0, employeeCompletions: 0 };
  const admin = {
    async rpc(...args: unknown[]) {
      calls.rpc.push(args);
      return { data: response, error: rpcError ? { message: `private DB details ${identity.token}` } : null };
    },
    from(table: string) {
      calls.from.push(table);
      const query = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() {
          if (!expired) return { data: null, error: null };
          if (table === "invitations" || table === "employee_assessment_invitations") {
            return { error: null, data: { id: eventId, company_id: eventId, application_id: eventId,
              participant_id: eventId, status: "started", expires_at: null } };
          }
          return { error: null, data: { id: identity.sessionId, status: "in_progress", deadline_at: "2020-01-01T00:00:00Z" } };
        },
        async upsert() { return { error: null }; },
      };
      return query;
    },
  };
  const v2 = loadModule<V2>("../lib/assessment/session-control-v2.ts", {
    "server-only": {}, zod: { z }, "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/forced-choice": forcedChoice, "@/lib/answers/multiple-choice": multipleChoice,
  }, flag);
  const controls = loadModule<Controls>("../lib/assessment/session-control.ts", {
    "node:crypto": crypto, zod: { z }, "@/lib/supabase/admin": { createAdminClient: () => admin },
    "@/lib/forced-choice": forcedChoice,
    "@/lib/answers/multiple-choice": multipleChoice,
    "@/lib/tests/presentation-settings": presentation,
    "@/lib/structured-questions": structured,
    "./session-control-v2": v2,
    "./completion": { completeCandidateSessionAndGetPath: async () => { calls.candidateCompletions += 1; return "/candidate-next"; } },
    "./data": {
      getAssessmentByToken: async () => { calls.candidateReads += 1; return { availability: expired ? "active" : "completed" }; },
      getAssessmentQuestionPageData: () => { throw new Error("Hot path must not load questions"); },
    },
    "@/lib/employee-assessments/completion": { completeEmployeeAssessmentSessionAndGetPath: async () => { calls.employeeCompletions += 1; return "/employee-next"; } },
    "@/lib/employee-assessments/public-data": {
      getEmployeeAssessmentByToken: async () => { calls.employeeReads += 1; return { availability: expired ? "active" : "completed" }; },
      getEmployeeAssessmentQuestionPageData: () => { throw new Error("Hot path must not load questions"); },
    },
  }, flag);
  return { controls, v2, calls };
}

test("V2 hot paths use one RPC and no table/assessment reads in both scopes", async () => {
  for (const assessmentType of [undefined, "candidate", "employee"] as const) {
    for (const operation of ["claim", "heartbeat", "event", "guard"] as const) {
      const { controls, calls } = harness();
      const input = { ...identity, assessmentType };
      const response = operation === "claim" ? await controls.claimCandidateSession({ ...input, clientEventId: eventId })
        : operation === "event" ? await controls.recordCandidateSessionEvent({ ...input, clientEventId: eventId, eventType: "focus_lost" })
        : operation === "guard" ? await controls.guardCandidateSessionSubmission(input)
        : await controls.heartbeatCandidateSession(input);
      assert.deepEqual(response, { status: "active", deadlineAt: null });
      assert.deepEqual(calls.from, []);
      assert.equal(calls.candidateReads + calls.employeeReads, 0);
      assert.equal(calls.rpc.length, 1);
      assert.deepEqual(calls.rpc[0], ["control_assessment_session_lease_v2", {
        p_scope: assessmentType ?? "candidate", p_token: input.token, p_session_id: input.sessionId,
        p_client_id: input.clientId, p_device_id: input.deviceId, p_operation: operation === "guard" ? "heartbeat" : operation,
        p_payload: operation === "claim" ? { clientEventId: eventId }
          : operation === "event" ? { clientEventId: eventId, clientOccurredAt: null, eventType: "focus_lost", metadata: {}, questionId: null } : {},
      }]);
    }
  }
});

test("V2 flag defaults off and switching off never calls the RPC", async () => {
  for (const flag of ["false", "", "TRUE", "1"]) {
    const { controls, v2, calls } = harness({ flag });
    assert.equal(v2.isSessionControlV2Enabled(), false);
    assert.equal((await controls.heartbeatCandidateSession(identity)).status, "redirect");
    assert.deepEqual(calls.rpc, []);
    assert.deepEqual(calls.from, ["invitations"]);
  }
  const v2 = loadModule<V2>("../lib/assessment/session-control-v2.ts", {
    "server-only": {}, zod: { z }, "@/lib/supabase/admin": {},
    "@/lib/forced-choice": forcedChoice, "@/lib/answers/multiple-choice": multipleChoice,
  });
  assert.equal(v2.isSessionControlV2Enabled(), false);
});

test("V2 strips unexpected fields and keeps public active/blocked responses", async () => {
  const active = harness({ response: { status: "active", deadlineAt: "2026-09-06T14:00:00+05:00", secret: "not public" } });
  assert.deepEqual(await active.controls.heartbeatCandidateSession(identity), {
    status: "active", deadlineAt: "2026-09-06T09:00:00.000Z",
  });
  const blocked = harness({ response: { status: "blocked", retryAfterSeconds: 90 } });
  assert.deepEqual(await blocked.controls.heartbeatCandidateSession(identity), { status: "blocked", retryAfterSeconds: 90 });
  assert.deepEqual(blocked.calls.from, []);
});

test("V2 RPC errors and malformed results fail closed without a V1 retry or private details", async () => {
  for (const options of [
    { rpcError: true }, { response: null }, { response: { status: "unknown" } },
    { response: { status: "blocked", retryAfterSeconds: -1 } },
    { response: { status: "active", deadlineAt: "not-a-date" } },
  ]) {
    const { controls, calls } = harness(options);
    await assert.rejects(controls.heartbeatCandidateSession(identity), (error: Error) => {
      assert.ok(!error.message.includes(identity.token));
      return true;
    });
    assert.equal(calls.rpc.length, 1);
    assert.deepEqual(calls.from, []);
    assert.equal(calls.candidateReads + calls.employeeReads, 0);
  }
});

test("V2 rejects invalid identity before creating an RPC request", async () => {
  const { controls, calls } = harness();
  assert.equal((await controls.heartbeatCandidateSession({ ...identity, clientId: "invalid" })).status, "redirect");
  assert.deepEqual(calls.rpc, []);
});

test("internal unavailable and terminal statuses become existing redirects for each scope", async () => {
  for (const assessmentType of ["candidate", "employee"] as const) {
    for (const status of ["unavailable", "terminal"]) {
      const { controls, calls } = harness({ response: { status } });
      const root = `/${assessmentType === "employee" ? "employee-assessment" : "assessment"}/${identity.token}`;
      assert.deepEqual(await controls.heartbeatCandidateSession({ ...identity, assessmentType }), {
        status: "redirect", redirectTo: status === "terminal" ? `${root}/complete` : root,
      });
      assert.equal(calls.candidateReads, status === "terminal" && assessmentType === "candidate" ? 1 : 0);
      assert.equal(calls.employeeReads, status === "terminal" && assessmentType === "employee" ? 1 : 0);
    }
  }
});

test("expired V2 response revalidates access and delegates to existing scoped completion", async () => {
  for (const assessmentType of ["candidate", "employee"] as const) {
    const { controls, calls } = harness({ response: { status: "expired" }, expired: true });
    assert.deepEqual(await controls.heartbeatCandidateSession({ ...identity, assessmentType }), {
      status: "redirect", redirectTo: assessmentType === "employee" ? "/employee-next" : "/candidate-next",
    });
    assert.equal(calls.candidateCompletions, assessmentType === "candidate" ? 1 : 0);
    assert.equal(calls.employeeCompletions, assessmentType === "employee" ? 1 : 0);
    assert.equal(calls.from.length, 3); // Invitation + session revalidation + timer event.
  }
  const revoked = harness({ response: { status: "expired" } });
  assert.deepEqual(await revoked.controls.heartbeatCandidateSession(identity), { status: "redirect", redirectTo: `/assessment/${identity.token}` });
  assert.equal(revoked.calls.candidateCompletions + revoked.calls.employeeCompletions, 0);
});
