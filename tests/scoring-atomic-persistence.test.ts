import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync(new URL("../lib/scoring/service.ts", import.meta.url), "utf8");
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260824130000_scoring_v2_finalization.sql",
    import.meta.url,
  ),
  "utf8",
);
const conflictRecoveryMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260828130000_scoring_conflict_recovery.sql",
    import.meta.url,
  ),
  "utf8",
);

test("normal completion and recalculation share one atomic persistence RPC", () => {
  assert.equal((service.match(/"try_persist_scoring_snapshot"/g) ?? []).length, 2);
  assert.match(service, /p_scope: "candidate"/);
  assert.match(service, /p_scope: "employee"/);
  assert.match(service, /p_snapshot: \{[\s\S]*competency_scores:[\s\S]*results:[\s\S]*summaries:/);
  assert.doesNotMatch(service, /\.from\("test_results"\)\s*\.upsert/);
  assert.doesNotMatch(service, /\.from\("candidate_reports"\)\.upsert/);
});

test("the persistence wrapper returns stale-writer conflicts without a database error", () => {
  assert.match(
    conflictRecoveryMigration,
    /create or replace function public\.try_persist_scoring_snapshot/,
  );
  assert.equal((conflictRecoveryMigration.match(/for update;/g) ?? []).length, 2);
  assert.ok(
    conflictRecoveryMigration.indexOf("current_revision <> p_expected_revision") <
      conflictRecoveryMigration.indexOf("public.persist_scoring_snapshot("),
  );
  assert.match(conflictRecoveryMigration, /'conflict', true/);
  assert.doesNotMatch(conflictRecoveryMigration, /errcode\s*=\s*'40001'/);
  assert.match(service, /persistenceResult\.conflict/);
  assert.match(service, /persistenceContext !== undefined/);
});

test("RPC locks the aggregate, checks revision, and writes success audit last", () => {
  assert.match(migration, /create or replace function public\.persist_scoring_snapshot/);
  assert.equal((migration.match(/for update;/g) ?? []).length, 2);
  assert.match(migration, /current_revision <> p_expected_revision/);
  assert.match(migration, /errcode = '40001'/);
  assert.match(migration, /next_revision := current_revision \+ 1/);
  assert.ok(
    migration.indexOf("insert into public.scoring_recalculation_history") >
      migration.indexOf("insert into public.employee_assessment_reports"),
  );
});

test("audit failure and any mid-function error roll back the complete snapshot", () => {
  assert.match(migration, /language plpgsql/);
  assert.match(migration, /security definer/);
  assert.match(migration, /previous_revision, new_revision/);
  assert.match(migration, /return jsonb_build_object\('revision', next_revision, 'audit_id', audit_id\)/);
  assert.doesNotMatch(migration, /exception[\s\S]*commit|commit[\s\S]*exception/i);
});
