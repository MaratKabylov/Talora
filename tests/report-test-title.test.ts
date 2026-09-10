import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveReportTestTitle } from "../lib/reports/test-title.ts";

test("uses the logical test title instead of the version title in reports", () => {
  assert.equal(
    resolveReportTestTitle("Обучаемость", "v.2 от 25-08-2026"),
    "Обучаемость",
  );
});

test("falls back to the version title for legacy records without a template", () => {
  assert.equal(resolveReportTestTitle(null, "v.2 от 25-08-2026"), "v.2 от 25-08-2026");
  assert.equal(resolveReportTestTitle(null, null), "Тест");
});

test("report loaders fetch logical template titles with session/version data", () => {
  const candidateDataSource = readFileSync(
    new URL("../lib/reports/data.ts", import.meta.url),
    "utf8",
  );
  const employeeDataSource = readFileSync(
    new URL("../lib/employee-assessments/data.ts", import.meta.url),
    "utf8",
  );

  assert.match(candidateDataSource, /test_versions\([^\n]*test_templates\(title\)/);
  assert.match(employeeDataSource, /from\("test_versions"\)[\s\S]*test_templates\(title\)/);
  assert.doesNotMatch(candidateDataSource, /from\("test_templates"\)\.select\("id, title"\)/);
  assert.doesNotMatch(employeeDataSource, /from\("test_templates"\)\.select\("id, title"\)/);
});

test("report summary loaders leave answers and integrity events to details loaders", () => {
  const candidateDataSource = readFileSync(
    new URL("../lib/reports/data.ts", import.meta.url),
    "utf8",
  );
  const employeeDataSource = readFileSync(
    new URL("../lib/employee-assessments/data.ts", import.meta.url),
    "utf8",
  );

  const candidateSummarySource = candidateDataSource.slice(
    0,
    candidateDataSource.indexOf("async function getCandidateReportDetailsDataUninstrumented"),
  );
  const employeeSummarySource = employeeDataSource.slice(
    0,
    employeeDataSource.indexOf("async function getEmployeeAssessmentReportDetailsDataUninstrumented"),
  );

  assert.doesNotMatch(candidateSummarySource, /from\("candidate_answers"\)/);
  assert.doesNotMatch(candidateSummarySource, /from\("assessment_session_events"\)/);
  assert.doesNotMatch(employeeSummarySource, /from\("employee_assessment_answers"\)/);
  assert.doesNotMatch(employeeSummarySource, /from\("employee_assessment_session_events"\)/);
  assert.match(candidateDataSource, /reports\.candidate_details/);
  assert.match(employeeDataSource, /reports\.employee_details/);
});
