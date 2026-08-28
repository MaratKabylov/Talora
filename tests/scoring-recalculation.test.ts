import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync(
  new URL("../lib/scoring/service.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260824120000_scoring_v2_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);
const finalizationMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260824130000_scoring_v2_finalization.sql",
    import.meta.url,
  ),
  "utf8",
);

test("recalculation delegates to normal parent pipelines and audits both snapshots", () => {
  const entryPoint = service.slice(service.indexOf("export async function recalculateSessionScore"));
  assert.match(entryPoint, /scoreCompletedApplication\(applicationId, \{/);
  assert.match(entryPoint, /scoreCompletedEmployeeAssessmentParticipant\(participantId, \{/);
  assert.match(entryPoint, /expectedRevision: before\.revision/);
  assert.match(service, /\.rpc\(\s*"try_persist_scoring_snapshot"/);
  assert.match(entryPoint, /previous_engine_version/);
  assert.match(entryPoint, /previous_revision/);
  assert.match(entryPoint, /status: "failed"/);
});

test("recalculation reasons and versioned history are constrained", () => {
  for (const reason of ["manual", "scoring_upgrade", "definition_change", "admin_repair"]) {
    assert.match(service, new RegExp(`"${reason}"`));
    assert.match(migration, new RegExp(`'${reason}'`));
  }
  assert.match(migration, /create table if not exists public\.scoring_recalculation_history/);
  assert.match(migration, /previous_result_json jsonb/);
  assert.match(migration, /new_result_json jsonb/);
  assert.match(migration, /previous_aggregate_json jsonb/);
  assert.match(migration, /scoring_schema_version/);
  assert.match(finalizationMigration, /previous_revision integer/);
  assert.match(finalizationMigration, /new_revision integer/);
});

test("raw response columns are read but never updated by the scoring pipeline", () => {
  const updateBlocks = [...service.matchAll(/\.update\(\{([\s\S]*?)\}\)/g)].map((match) => match[1]);
  for (const rawColumn of [
    "selected_option_id",
    "answer_text",
    "answer_json",
    "time_spent_seconds",
  ]) {
    assert.ok(!updateBlocks.some((block) => block.includes(`${rawColumn}:`)), rawColumn);
  }
  assert.match(service, /preserveManualReview/);
  assert.match(service, /question_type === "open_text"/);
});
