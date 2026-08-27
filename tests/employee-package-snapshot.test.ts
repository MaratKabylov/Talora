import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260827150000_freeze_employee_assessment_package_sessions.sql",
    import.meta.url,
  ),
  "utf8",
);
const publicActions = readFileSync(
  new URL("../lib/employee-assessments/public-actions.ts", import.meta.url),
  "utf8",
);
const publicData = readFileSync(
  new URL("../lib/employee-assessments/public-data.ts", import.meta.url),
  "utf8",
);
const scoringService = readFileSync(
  new URL("../lib/scoring/service.ts", import.meta.url),
  "utf8",
);

test("employee sessions are initialized once with a frozen package configuration", () => {
  assert.match(migration, /create or replace function public\.prepare_employee_assessment_sessions/);
  assert.match(migration, /for key share/);
  assert.match(
    migration,
    /if exists \([\s\S]*employee_assessment_sessions[\s\S]*return;/,
  );
  assert.match(migration, /package_weight/);
  assert.match(migration, /package_is_required/);
  assert.match(publicActions, /\.rpc\("prepare_employee_assessment_sessions"/);
  assert.doesNotMatch(
    publicActions,
    /from\("employee_assessment_sessions"\)\.upsert/,
  );
});

test("employee public flow and scoring prefer the session snapshot", () => {
  assert.match(publicData, /sessions\.length > 0[\s\S]*sessions\.map/);
  assert.match(publicData, /test_versions\(id, title, description, instructions/);
  assert.match(scoringService, /hasFrozenPackageConfiguration/);
  assert.match(scoringService, /package_weight/);
  assert.match(
    scoringService,
    /hasFrozenPackageConfiguration\s*\? allSessions/,
  );
});

