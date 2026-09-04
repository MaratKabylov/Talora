import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../app/(dashboard)/dashboard/employee-assessments/new/page.tsx", import.meta.url),
  "utf8",
);

test("employee assessment creation always reaches server validation", () => {
  assert.match(page, /<form[^>]+action=\{createEmployeeAssessmentAction\}[^>]+noValidate/);
});

test("employee assessment creation shows a pending state", () => {
  assert.match(page, /<PendingSubmitButton pendingText="Создаем оценку\.\.\." type="submit">/);
});
