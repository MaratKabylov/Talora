import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const employeeAssessmentMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260607100000_employee_assessments.sql",
    import.meta.url,
  ),
  "utf8",
);
const tokenSearchPathFix = readFileSync(
  new URL(
    "../supabase/migrations/20260827140000_fix_employee_invitation_token_search_path.sql",
    import.meta.url,
  ),
  "utf8",
);

test("employee invitation token generation can resolve Supabase pgcrypto", () => {
  assert.match(
    employeeAssessmentMigration,
    /create or replace function public\.invite_employee_to_assessment[\s\S]*gen_random_bytes\(32\)/,
  );
  assert.match(
    tokenSearchPathFix,
    /alter function public\.invite_employee_to_assessment\([\s\S]*set search_path = pg_catalog, extensions;/,
  );
});
