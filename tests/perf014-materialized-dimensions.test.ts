import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { materializeEmployeeDimensions } from "../lib/assessment-results/materialized-dimensions.ts";
import type { AssessmentDimensionResult } from "../lib/assessment-results/types.ts";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260911120000_perf014_employee_dimension_scores.sql",
    import.meta.url,
  ),
  "utf8",
);
const verification = readFileSync(
  new URL(
    "../supabase/verification/perf014_employee_dimension_scores.sql",
    import.meta.url,
  ),
  "utf8",
);
const scoring = readFileSync(new URL("../lib/scoring/service.ts", import.meta.url), "utf8");
const comparison = readFileSync(
  new URL("../lib/employee-assessments/data.ts", import.meta.url),
  "utf8",
);

test("materialized dimensions preserve the comparison identity, label and value", () => {
  const dimension: AssessmentDimensionResult = {
    assessmentDomain: "motivation",
    id: "version:scale:autonomy",
    interpretation: null,
    interpretationDirection: "neutral",
    key: "autonomy",
    norm: null,
    normalizedScore: 72.5,
    order: 3,
    reportGroup: "motivation",
    resultShape: "profile",
    score: 4,
    sessionId: "session-id",
    sourceType: "scale",
    testTitle: "Motivation profile",
    testVersionId: "version-id",
    threshold: null,
    thresholdStatus: "not_applicable",
    title: "Autonomy",
    valueStatus: "available",
  };

  assert.deepEqual(materializeEmployeeDimensions([dimension]), [{
    assessment_domain: "motivation",
    dimension_id: "version:scale:autonomy",
    dimension_key: "autonomy",
    display_order: 3,
    group_key: "motivation",
    interpretation_direction: "neutral",
    percentage: 72.5,
    session_id: "session-id",
    source_type: "scale",
    test_version_id: "version-id",
    title: "Motivation profile: Autonomy",
  }]);
});

test("employee scoring sends dimensions through the existing atomic persistence RPC", () => {
  assert.match(scoring, /materializeEmployeeDimensions\([\s\S]*collectAssessmentDimensions/);
  assert.match(scoring, /p_scope: "employee"[\s\S]*dimensions: dimensionRows/);
  assert.equal((scoring.match(/"try_persist_scoring_snapshot"/g) ?? []).length, 2);
});

test("PERF-014 schema is tenant-scoped, revisioned and written inside the persistence wrapper", () => {
  assert.match(migration, /create table if not exists public\.employee_assessment_dimension_scores/);
  assert.match(migration, /unique \(participant_id, scoring_revision, dimension_id\)/);
  assert.match(migration, /alter table public\.employee_assessment_dimension_scores enable row level security/);
  assert.match(migration, /using \(public\.is_company_member\(company_id\)\)/);
  assert.match(migration, /revoke all on table public\.employee_assessment_dimension_scores from anon, authenticated/);
  assert.match(migration, /revoke all on function public\.persist_scoring_snapshot[\s\S]*from public, anon, authenticated, service_role/);
  assert.ok(
    migration.lastIndexOf("persisted := public.persist_scoring_snapshot") <
      migration.lastIndexOf("perform public.replace_employee_assessment_dimensions"),
  );
  assert.match(migration, /backfill_employee_assessment_dimensions/);
  assert.match(migration, /p_replace_existing boolean default true/);
  assert.match(migration, /session\.participant_id = p_parent_id/);
  assert.match(migration, /session\.test_version_id = \(entry ->> 'test_version_id'\)::uuid/);
});

test("employee comparison prefers materialized rows and bounds legacy fallback to missing participants", () => {
  assert.match(comparison, /from\("employee_assessment_dimension_scores"\)/);
  assert.match(comparison, /\.eq\("company_id", companyId\)/);
  assert.match(comparison, /\.eq\("employee_assessment_id", assessmentId\)/);
  assert.match(comparison, /const missingParticipantIds/);
  assert.match(comparison, /\.in\("participant_id", missingParticipantIds\)/);
});

test("PERF-014 migration replaces dimensions atomically and rejects foreign sessions", async () => {
  const db = new PGlite();
  const ids = Array.from({ length: 8 }, (_, n) =>
    `fa140000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
  );
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.companies(id uuid primary key);
      create table public.employee_assessments(id uuid primary key);
      create table public.test_versions(id uuid primary key);
      create table public.candidate_applications(id uuid primary key, scoring_revision integer not null default 0);
      create table public.employee_assessment_participants(
        id uuid primary key,
        company_id uuid not null references public.companies(id),
        employee_assessment_id uuid not null references public.employee_assessments(id),
        scoring_revision integer not null default 0
      );
      create table public.employee_assessment_sessions(
        id uuid primary key,
        participant_id uuid not null references public.employee_assessment_participants(id),
        test_version_id uuid not null references public.test_versions(id)
      );
      create function public.is_company_member(uuid) returns boolean language sql stable as 'select true';
      create function public.persist_scoring_snapshot(text, uuid, integer, jsonb, jsonb default null)
      returns jsonb language plpgsql security definer set search_path = '' as $$
      declare revision integer;
      begin
        if $1 = 'employee' then
          update public.employee_assessment_participants
          set scoring_revision = scoring_revision + 1
          where id = $2 and scoring_revision = $3
          returning scoring_revision into revision;
        else
          update public.candidate_applications
          set scoring_revision = scoring_revision + 1
          where id = $2 and scoring_revision = $3
          returning scoring_revision into revision;
        end if;
        if revision is null then raise exception 'conflict'; end if;
        return jsonb_build_object('revision', revision, 'audit_id', null);
      end;
      $$;
      insert into public.companies values ('${ids[0]}');
      insert into public.employee_assessments values ('${ids[1]}');
      insert into public.test_versions values ('${ids[2]}'), ('${ids[3]}');
      insert into public.employee_assessment_participants values ('${ids[4]}','${ids[0]}','${ids[1]}',0);
      insert into public.employee_assessment_sessions values ('${ids[5]}','${ids[4]}','${ids[2]}');
      insert into public.employee_assessment_sessions values ('${ids[6]}','${ids[4]}','${ids[3]}');
    `);
    await db.exec(migration);
    const call = (expectedRevision: number, dimensions: unknown[]) => db.query<{ result: Record<string, unknown> }>(
      "select public.try_persist_scoring_snapshot('employee',$1::uuid,$2::integer,$3::jsonb,null) result",
      [ids[4], expectedRevision, JSON.stringify({ dimensions })],
    );
    const row = (dimensionId: string, sessionId = ids[5], versionId = ids[2]) => ({
      assessment_domain: "skills",
      dimension_id: dimensionId,
      dimension_key: "communication",
      display_order: 0,
      group_key: "knowledge_skills",
      interpretation_direction: "higher_better",
      percentage: 80,
      session_id: sessionId,
      source_type: "criterion",
      test_version_id: versionId,
      title: "Communication",
    });

    assert.equal((await call(0, [row("first")])).rows[0].result.conflict, false);
    assert.deepEqual(
      (await db.query<{ dimension_id: string; scoring_revision: number }>(
        "select dimension_id, scoring_revision from public.employee_assessment_dimension_scores",
      )).rows,
      [{ dimension_id: "first", scoring_revision: 1 }],
    );
    await call(1, [row("second", ids[6], ids[3])]);
    assert.deepEqual(
      (await db.query<{ dimension_id: string; scoring_revision: number }>(
        "select dimension_id, scoring_revision from public.employee_assessment_dimension_scores",
      )).rows,
      [{ dimension_id: "second", scoring_revision: 2 }],
    );
    const backfill = await db.query<{ result: Record<string, unknown> }>(
      "select public.backfill_employee_assessment_dimensions($1::uuid,2,$2::jsonb) result",
      [ids[4], JSON.stringify([row("must-not-replace")])],
    );
    assert.equal(backfill.rows[0].result.status, "already_materialized");

    await assert.rejects(call(2, [row("foreign", ids[7], ids[2])]));
    assert.equal(
      (await db.query<{ scoring_revision: number }>(
        "select scoring_revision from public.employee_assessment_participants where id = $1",
        [ids[4]],
      )).rows[0].scoring_revision,
      2,
    );
    assert.equal((await call(1, [row("stale")])).rows[0].result.conflict, true);
    const verified = (await db.query<{
      result: {
        perf014_employee_dimension_scores: {
          catalog: Record<string, boolean>,
          coverage: { scored_participants_without_current_dimensions: number },
          integrity: Record<string, number>,
        },
      },
    }>(verification)).rows[0].result.perf014_employee_dimension_scores;
    for (const [check, passed] of Object.entries(verified.catalog)) {
      assert.equal(passed, true, `catalog check failed: ${check}`);
    }
    assert.equal(verified.coverage.scored_participants_without_current_dimensions, 0);
    assert.equal(verified.integrity.tenant_scope_mismatches, 0);
    assert.equal(verified.integrity.stale_revision_rows, 0);
    assert.equal(verified.integrity.session_scope_mismatches, 0);
  } finally {
    await db.close();
  }
});
