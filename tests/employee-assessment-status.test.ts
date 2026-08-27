import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canCancelEmployeeAssessment,
  EMPLOYEE_PARTICIPANT_STATUS_LABELS,
} from "../lib/employee-assessments/constants.ts";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260827160000_cancel_employee_assessment.sql",
    import.meta.url,
  ),
  "utf8",
);

test("employee assessment can be cancelled before completion", () => {
  assert.equal(canCancelEmployeeAssessment("invited"), true);
  assert.equal(canCancelEmployeeAssessment("in_progress"), true);
});

test("employee assessment cannot be cancelled after reaching a terminal status", () => {
  for (const status of ["completed", "cancelled", "archived"] as const) {
    assert.equal(canCancelEmployeeAssessment(status), false);
  }
});

test("employee assessment cancellation closes the invitation and unfinished sessions atomically", () => {
  assert.match(migration, /create or replace function public\.cancel_employee_assessment/);
  assert.match(
    migration,
    /update public\.employee_assessment_invitations[\s\S]*status in \('created', 'sent', 'opened', 'started'\)/,
  );
  assert.match(
    migration,
    /update public\.employee_assessment_sessions[\s\S]*status in \('not_started', 'in_progress'\)/,
  );
  assert.equal(EMPLOYEE_PARTICIPANT_STATUS_LABELS.cancelled, "Отменен");
});
