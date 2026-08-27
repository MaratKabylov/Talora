import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_STATUS_LABELS,
  canCancelCandidateAssessment,
} from "../lib/candidates/constants.ts";

test("candidate assessment can be cancelled before completion", () => {
  assert.equal(canCancelCandidateAssessment("invited"), true);
  assert.equal(canCancelCandidateAssessment("in_progress"), true);
});

test("candidate assessment cannot be cancelled after reaching a terminal status", () => {
  for (const status of [
    "completed",
    "shortlisted",
    "rejected",
    "hired",
    "withdrawn",
    "cancelled",
  ] as const) {
    assert.equal(canCancelCandidateAssessment(status), false);
  }
});

test("cancelled assessment has a distinct user-facing label", () => {
  assert.equal(APPLICATION_STATUS_LABELS.cancelled, "Отменено");
});
