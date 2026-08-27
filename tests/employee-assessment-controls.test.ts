import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(path, "utf8");
}

test("employee and candidate routes use the same controlled test session UI", () => {
  const candidatePage = source("app/assessment/[token]/test/[sessionId]/page.tsx");
  const employeePage = source("app/employee-assessment/[token]/test/[sessionId]/page.tsx");
  const sessionUi = source("components/assessment/candidate-test-session.tsx");

  assert.match(candidatePage, /AssessmentTestSession/);
  assert.match(employeePage, /AssessmentTestSession/);
  assert.match(employeePage, /assessmentType="employee"/);
  assert.match(sessionUi, /operation: "claim"/);
  assert.match(sessionUi, /operation: "heartbeat"/);
  assert.match(sessionUi, /operation: "autosave"/);
  assert.match(sessionUi, /operation: "expire"/);
});

test("the shared session timer has a deterministic hydration value", () => {
  const sessionUi = source("components/assessment/candidate-test-session.tsx");

  assert.match(
    sessionUi,
    /const \[remainingSeconds, setRemainingSeconds\] = useState<number \| null>\(null\);/,
  );
});

test("one-question forced choice enables progression after both choices are selected", () => {
  const sessionUi = source("components/assessment/candidate-test-session.tsx");

  assert.match(sessionUi, /onChangeCapture=\{handleOneQuestionChange\}/);
  assert.match(
    sessionUi,
    /const isComplete = hasDraftAnswer\([\s\S]*?draftForQuestion\(event\.currentTarget, activeQuestion\)[\s\S]*?setForcedChoiceCompletion/,
  );
  assert.match(sessionUi, /\[activeQuestion\.id\]: isComplete/);
});

test("employee sessions persist the same deadline and single-client lease controls", () => {
  const migration = source(
    "supabase/migrations/20260827170000_employee_assessment_integrity_controls.sql",
  );
  const completion = source("lib/employee-assessments/completion.ts");

  for (const column of [
    "deadline_at",
    "active_client_id_hash",
    "active_device_id_hash",
    "lease_expires_at",
    "last_heartbeat_at",
    "submission_reason",
  ]) {
    assert.match(migration, new RegExp(column));
  }

  assert.match(completion, /deadline_at: deadlineFrom/);
  assert.match(completion, /submission_reason: reason/);
  assert.match(completion, /"time_expired"/);
});

test("employee answers are autosaved, timed, and rejected after the server deadline", () => {
  const data = source("lib/employee-assessments/public-data.ts");
  const control = source("lib/assessment/session-control.ts");
  const migration = source(
    "supabase/migrations/20260827170000_employee_assessment_integrity_controls.sql",
  );

  assert.match(data, /settings_json/);
  assert.match(data, /time_spent_seconds/);
  assert.match(control, /employee_assessment_answers/);
  assert.match(control, /captureQuestionTime/);
  assert.match(migration, /session\.deadline_at > now\(\)/);
});

test("employee integrity events use a tenant-scoped audit table", () => {
  const migration = source(
    "supabase/migrations/20260827170000_employee_assessment_integrity_controls.sql",
  );
  const report = source("lib/employee-assessments/data.ts");

  assert.match(migration, /create table if not exists public\.employee_assessment_session_events/);
  assert.match(migration, /public\.is_company_member\(company_id\)/);
  assert.match(migration, /concurrent_session_blocked/);
  assert.match(migration, /timer_expired/);
  assert.match(report, /employee_assessment_session_events/);
  assert.match(report, /employeeIntegritySummary/);
});
