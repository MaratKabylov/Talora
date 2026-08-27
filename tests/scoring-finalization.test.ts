import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const candidateData = source("../lib/assessment/data.ts");
const candidateCompletion = source("../lib/assessment/completion.ts");
const employeeData = source("../lib/employee-assessments/public-data.ts");
const employeeCompletion = source("../lib/employee-assessments/completion.ts");
const finalization = source("../lib/scoring/finalization.ts");
const persistenceMigration = source(
  "../supabase/migrations/20260824130000_scoring_v2_finalization.sql",
);

test("public assessment readers do not trigger scoring", () => {
  assert.doesNotMatch(candidateData, /scoreCompletedApplication/);
  assert.doesNotMatch(employeeData, /scoreCompletedEmployeeAssessmentParticipant/);
});

test("explicit candidate and employee completion paths own finalization", () => {
  assert.match(candidateCompletion, /finalizeCompletedCandidateAssessment/);
  assert.match(employeeCompletion, /finalizeCompletedEmployeeAssessment/);
  assert.match(finalization, /scoreCompletedApplication/);
  assert.match(finalization, /scoreCompletedEmployeeAssessmentParticipant/);
});

test("scoring uses an atomic recoverable claim before persistence", () => {
  assert.match(finalization, /SCORING_STAGE = "scoring"/);
  assert.match(finalization, /SCORING_CLAIM_TTL_MS/);
  assert.match(finalization, /\.update\(\{ current_stage: SCORING_STAGE \}\)/);
  assert.match(finalization, /\.in\("status", ACTIVE_PARENT_STATUSES\)/);
  assert.match(finalization, /\.or\(availableClaimFilter\(\)\)/);
  assert.match(finalization, /sessionsResult\.data\.some/);
  assert.match(finalization, /releaseScoringClaim/);
});

test("database scoring revision guard remains enabled", () => {
  assert.match(persistenceMigration, /Scoring revision conflict: expected %, found %/);
  assert.match(persistenceMigration, /errcode = '40001'/);
});
