import assert from "node:assert/strict";
import test from "node:test";

import {
  correlationIdFrom,
  roundDuration,
  sanitizeRoutePath,
  serverTimingValue,
} from "../lib/observability/performance-core.ts";

test("correlation IDs accept only bounded log-safe values", () => {
  const requestId = "req_0198f2ce-0b34-7abc-8def-1234567890ab";
  assert.equal(correlationIdFrom(requestId), requestId);
  assert.notEqual(correlationIdFrom("a".repeat(64)), "a".repeat(64));
  assert.notEqual(correlationIdFrom("token with spaces"), "token with spaces");
  assert.match(correlationIdFrom(null), /^req_[0-9a-f-]{36}$/);
});

test("route labels remove invitation tokens, UUIDs and query strings", () => {
  const token = "a".repeat(64);
  const sessionId = "0198f2ce-0b34-7abc-8def-1234567890ab";
  assert.equal(
    sanitizeRoutePath(`/assessment/${token}/test/${sessionId}?section=2`),
    "/assessment/[token]/test/[id]",
  );
});

test("durations and Server-Timing values are bounded and normalized", () => {
  assert.equal(roundDuration(-1), 0);
  assert.equal(roundDuration(12.345), 12.35);
  assert.equal(serverTimingValue("Session Control", 12.345), "session_control;dur=12.35");
});
