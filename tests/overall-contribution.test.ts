import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  calculateContributingOverall,
  contributesToOverallByDefault,
  contributingWeightPercent,
  initialPackageTestOverallChoice,
  packageTestContributesToOverall,
  packageTestRowState,
} from "../lib/packages/overall-contribution.ts";

test("profile tests default out of overall while score tests default in", () => {
  assert.equal(contributesToOverallByDefault({ resultShape: "profile" }), false);
  assert.equal(contributesToOverallByDefault({ scoringType: "competency_profile" }), false);
  assert.equal(contributesToOverallByDefault({ resultShape: "score" }), true);
});

test("explicit package setting is authoritative for hybrid and legacy tests", () => {
  assert.equal(
    packageTestContributesToOverall({ contributesToOverall: false, resultShape: "score" }),
    false,
  );
  assert.equal(
    packageTestContributesToOverall({
      contributesToOverall: true,
      scoringType: "competency_profile",
    }),
    true,
  );
});

test("only contributing weights must total 100 percent", () => {
  assert.equal(
    contributingWeightPercent([
      { contributesToOverall: true, weightPercent: 60 },
      { contributesToOverall: true, weightPercent: 40 },
      { contributesToOverall: false, weightPercent: 75 },
    ]),
    100,
  );
});

test("excluding a profile preserves the previous renormalized overall", () => {
  const before = calculateContributingOverall([
    { percentage: 80, weight: 0.25 },
    { percentage: 50, weight: 0.25 },
    { percentage: 70, weight: 0.25 },
  ]);
  const afterWeightNormalization = calculateContributingOverall([
    { percentage: 80, weight: 1 / 3 },
    { percentage: 50, weight: 1 / 3 },
    { percentage: 70, weight: 1 / 3 },
  ]);

  assert.equal(before, 66.67);
  assert.equal(afterWeightNormalization, before);
});

test("package UI explicitly labels tests excluded from overall", () => {
  const source = readFileSync(
    new URL("../components/packages/assessment-package-tests-fields.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Не участвует в общем балле/);
  assert.match(source, /required=\{state\.overallRequired\}/);
});

test("package row state validates only included hybrid tests", () => {
  assert.equal(initialPackageTestOverallChoice({ resultShape: "score" }), "true");
  assert.equal(initialPackageTestOverallChoice({ resultShape: "profile" }), "false");
  assert.equal(initialPackageTestOverallChoice({ resultShape: "hybrid" }), "");

  assert.deepEqual(
    packageTestRowState({ included: false, overallChoice: "", resultShape: "hybrid" }),
    {
      fieldsDisabled: true,
      overallRequired: false,
      weightDisabled: true,
      weightPercent: 0,
    },
  );
  assert.equal(
    packageTestRowState({ included: true, overallChoice: "", resultShape: "hybrid" })
      .overallRequired,
    true,
  );
  assert.equal(
    packageTestRowState({ included: true, overallChoice: "false", resultShape: "hybrid" })
      .weightDisabled,
    true,
  );
});

test("server actions coerce excluded test weights to zero", () => {
  for (const path of ["../lib/packages/actions.ts", "../lib/admin/package-actions.ts"]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /contributesToOverall === "false"[\s\S]*?\? "0"/);
    assert.match(source, /test\.contributesToOverall \? test\.weightPercent \/ 100 : 0/);
  }
});

test("migration defaults profiles out, normalizes active weights, and freezes employee settings", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260831120000_assessment_reports_and_overall_contribution.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(migration, /add column if not exists contributes_to_overall boolean not null default true/);
  assert.match(migration, /version\.result_shape = 'profile'/);
  assert.match(migration, /set weight = 0\s+where contributes_to_overall = false/);
  assert.match(migration, /sum\(entry\.weight\) filter \(where entry\.contributes_to_overall\)/);
  assert.match(migration, /package_contributes_to_overall/);
});
