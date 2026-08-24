import assert from "node:assert/strict";
import test from "node:test";

import { buildReportScoringDetails } from "../lib/reports/scoring-details.ts";

const confidence = {
  confidence_interval: null,
  coverage: { answered_items: 2, eligible_items: 3, ratio: 2 / 3 },
  level: "not_available",
  reliability: { method: "not_available", source: null, value: null },
  standard_error: null,
};

test("report details expose attention metrics and dimension coverage from a v2 snapshot", () => {
  const details = buildReportScoringDetails({
    assessmentDomain: "attention",
    compositeScores: [],
    criterionScores: [],
    definitionVersionId: "version-1",
    engineVersion: "talvia-scoring/2.0.0",
    forcedChoiceScores: [],
    interpretation: { code: "good", label: "Уверенный", max: 100, min: 70 },
    metrics: {
      attention: {
        accuracy: 50,
        answered_count: 2,
        completion_rate: 66.666667,
        correct_count: 1,
        false_negative_count: null,
        false_positive_count: null,
        incorrect_count: 1,
        mean_response_time_ms: 4_000,
        median_response_time_ms: 4_000,
        omitted_count: 1,
        speed_percentile: null,
        timed_items: 2,
        total_items: 3,
      },
      learning: null,
    },
    overallScore: 50,
    resultShape: "hybrid",
    scaleScores: [{
      confidence,
      id: "focus",
      norm_score: null,
      normalized_score: 75,
      raw_score: 3,
      status: "ok",
    }],
    schemaVersion: "2.0",
    scoredAt: "2026-08-23T12:00:00.000Z",
    status: "partial",
    warnings: [],
  });

  assert.equal(details?.attention?.omitted_count, 1);
  assert.equal(details?.attention?.true_positive_count, null);
  assert.equal(details?.attention?.true_negative_count, null);
  assert.equal(details?.attention?.hit_rate, null);
  assert.equal(details?.attention?.false_alarm_rate, null);
  assert.equal(details?.interpretation?.label, "Уверенный");
  assert.deepEqual(details?.dimensions[0], {
    answeredItems: 2,
    eligibleItems: 3,
    id: "focus",
    normalizedScore: 75,
    rawScore: 3,
    status: "ok",
  });
});

test("report details reject malformed or legacy result payloads", () => {
  assert.equal(buildReportScoringDetails(null), null);
  assert.equal(buildReportScoringDetails({ schemaVersion: "1.0" }), null);
});
