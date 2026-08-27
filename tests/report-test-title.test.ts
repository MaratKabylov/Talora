import assert from "node:assert/strict";
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
