import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL(
  "../supabase/migrations/20260912150000_perf012_confirmed_query_indexes.sql",
  import.meta.url,
), "utf8");
const verification = readFileSync(new URL(
  "../supabase/verification/perf012_confirmed_query_indexes.sql",
  import.meta.url,
), "utf8");

test("confirmed list and builder indexes install idempotently with complete filter/order prefixes", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table public.candidate_applications(id uuid, company_id uuid, job_id uuid, created_at timestamptz, fit_score numeric);
      create table public.employee_assessment_participants(id uuid, company_id uuid, employee_assessment_id uuid, created_at timestamptz, fit_score numeric);
      create table public.test_sections(id uuid, test_version_id uuid, order_index integer);
      create table public.questions(id uuid, section_id uuid, order_index integer);
      create table public.answer_options(id uuid, question_id uuid, order_index integer);
    `);
    await db.exec(migration);
    await db.exec(migration);
    const indexes = await db.query<{ indexname: string; indexdef: string }>(`
      select indexname,indexdef from pg_indexes
      where schemaname='public' and indexname like 'perf012_%' order by indexname
    `);
    assert.equal(indexes.rows.length, 8);
    const definitions = indexes.rows.map((row) => row.indexdef).join("\n");
    assert.match(definitions, /\(company_id, job_id, created_at DESC, id\)/);
    assert.match(definitions, /\(company_id, job_id, fit_score DESC NULLS LAST, id\)/);
    assert.match(definitions, /\(employee_assessment_id, created_at DESC, id\)/);
    assert.match(definitions, /\(test_version_id, order_index, id\)/);
    assert.doesNotMatch(definitions, /public\.jobs/);
    const report = (await db.exec(verification))[0]!.rows[0] as {
      result: { perf012_confirmed_query_indexes: {
        expected_count: number; missing_or_invalid: unknown[]; ready_valid_count: number;
      } };
    };
    assert.deepEqual(report.result.perf012_confirmed_query_indexes, {
      ...report.result.perf012_confirmed_query_indexes,
      expected_count: 8,
      missing_or_invalid: [],
      ready_valid_count: 8,
    });
  } finally {
    await db.close();
  }
});
