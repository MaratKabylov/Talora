import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  collectAssessmentDimensions,
  extractScoringDefinitionMetadata,
} from "../lib/assessment-results/collect-dimensions.ts";
import { buildAssessmentHighlights } from "../lib/assessment-results/highlights.ts";
import { resolveAssessmentReportGroup } from "../lib/assessment-results/report-groups.ts";
import { summarizeAssessmentDimensions } from "../lib/assessment-results/summarize-dimensions.ts";

const confidence = {
  confidence_interval: null,
  coverage: { answered_items: 3, eligible_items: 3, ratio: 1 },
  level: "not_available",
  reliability: { method: "not_available", source: null, value: null },
  standard_error: null,
};

function profileResult() {
  return {
    assessmentDomain: "motivation",
    compositeScores: [],
    criterionScores: [],
    definitionVersionId: "version-1",
    engineVersion: "talvia-scoring/2.0.0",
    forcedChoiceScores: [],
    interpretation: null,
    metrics: { attention: null, learning: null },
    overallScore: null,
    resultShape: "profile",
    scaleScores: [
      {
        confidence,
        id: "autonomy",
        norm_score: null,
        normalized_score: 82,
        raw_score: 4.1,
        status: "ok",
      },
      {
        confidence,
        id: "team",
        norm_score: null,
        normalized_score: 38,
        raw_score: 1.9,
        status: "ok",
      },
    ],
    schemaVersion: "2.0",
    scoredAt: "2026-08-31T12:00:00.000Z",
    status: "complete",
    warnings: [],
  };
}

test("report group resolver covers v2 domains and legacy mappings", () => {
  const v2Cases = [
    ["learning", "cognitive"],
    ["attention", "cognitive"],
    ["motivation", "motivation"],
    ["personality", "personality"],
    ["knowledge", "knowledge_skills"],
    ["skills", "knowledge_skills"],
  ] as const;
  for (const [assessmentDomain, expected] of v2Cases) {
    assert.equal(
      resolveAssessmentReportGroup({
        assessmentDomain,
        resultShape: assessmentDomain === "motivation" || assessmentDomain === "personality"
          ? "profile"
          : "score",
        sourceType: "scale",
      }),
      expected,
    );
  }
  assert.equal(
    resolveAssessmentReportGroup({
      assessmentDomain: "behavior",
      resultShape: "profile",
      sourceType: "forced_choice",
    }),
    "behavior",
  );
  for (const [legacyKey, expected] of [
    ["motivation_result", "motivation"],
    ["responsibility", "work_competencies"],
    ["attention_to_detail", "cognitive"],
    ["learning_ability", "cognitive"],
  ] as const) {
    assert.equal(
      resolveAssessmentReportGroup({
        assessmentDomain: "other",
        legacyKey,
        resultShape: "score",
        sourceType: "legacy_competency",
      }),
      expected,
    );
  }
});

test("legacy dimensions use explicit report groups and neutral profile labels", () => {
  const dimensions = collectAssessmentDimensions({
    legacy: [
      {
        isBelowMinimum: false,
        key: "attention_to_detail",
        minimumScore: null,
        percentage: 75,
      },
      {
        isBelowMinimum: false,
        key: "motivation_autonomy",
        minimumScore: null,
        percentage: 82,
      },
    ],
  });

  assert.deepEqual(
    dimensions.map((dimension) => [dimension.key, dimension.reportGroup]),
    [
      ["attention_to_detail", "cognitive"],
      ["motivation_autonomy", "motivation"],
    ],
  );
  assert.equal(dimensions[0].thresholdStatus, "not_configured");
  assert.equal(dimensions[1].title, "Автономия");
  assert.equal(dimensions[1].interpretationDirection, "neutral");
  assert.equal(dimensions[1].thresholdStatus, "not_applicable");
});

test("v2 dimensions use definition titles and replace overlapping legacy profile rows", () => {
  const definition = extractScoringDefinitionMetadata({
    composites: [],
    scales: [
      { displayOrder: 1, id: "autonomy", title: "Самостоятельность" },
      { displayOrder: 2, id: "team", title: "Командная среда" },
    ],
  });
  const dimensions = collectAssessmentDimensions({
    legacy: [
      {
        isBelowMinimum: false,
        key: "motivation_autonomy",
        minimumScore: null,
        percentage: 70,
      },
    ],
    sessions: [{ definition, scoringResult: profileResult() }],
  });

  assert.equal(dimensions.length, 2);
  assert.deepEqual(dimensions.map((dimension) => dimension.title), [
    "Самостоятельность",
    "Командная среда",
  ]);
  assert.ok(dimensions.every((dimension) => dimension.reportGroup === "motivation"));
  assert.ok(dimensions.every((dimension) => dimension.interpretationDirection === "neutral"));
});

test("highlights are deterministic, bounded, and do not call motivation a strength", () => {
  const dimensions = collectAssessmentDimensions({
    sessions: [
      {
        definition: extractScoringDefinitionMetadata({
          scales: [
            { displayOrder: 1, id: "autonomy", title: "Автономия" },
            { displayOrder: 2, id: "team", title: "Команда" },
          ],
        }),
        scoringResult: profileResult(),
      },
    ],
  });
  const groups = summarizeAssessmentDimensions(dimensions);
  const highlights = buildAssessmentHighlights(groups, 5);

  assert.ok(highlights.length <= 5);
  assert.match(highlights[0].text, /Ведущие мотиваторы/);
  assert.doesNotMatch(highlights.map((highlight) => highlight.text).join(" "), /сильн/i);
  assert.deepEqual(highlights, buildAssessmentHighlights(groups, 5));
});

test("candidate and employee reports use the same assessment dimension read model", () => {
  const employeeDataSource = readFileSync(
    new URL("../lib/employee-assessments/data.ts", import.meta.url),
    "utf8",
  );
  const candidateDataSource = readFileSync(
    new URL("../lib/reports/data.ts", import.meta.url),
    "utf8",
  );
  const sharedUiSource = readFileSync(
    new URL("../components/reports/assessment-dimensions-report.tsx", import.meta.url),
    "utf8",
  );

  assert.match(employeeDataSource, /collectAssessmentDimensions/);
  assert.match(candidateDataSource, /collectAssessmentDimensions/);
  assert.match(sharedUiSource, /AssessmentDimensionsReport/);
  assert.doesNotMatch(sharedUiSource, /В норме/);
});
