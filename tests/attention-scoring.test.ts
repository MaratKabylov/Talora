import assert from "node:assert/strict";
import test from "node:test";

import { validateScoringDefinitionV2 } from "../lib/scoring/definition.ts";
import { scoreAttention } from "../lib/scoring/models/attention.ts";

test("attention definition requires accuracy overall and objective items", () => {
  const definition = {
    assessmentDomain: "attention",
    composites: [],
    normAssignments: [],
    overallScore: { sourceId: "attention_accuracy", sourceType: "criterion" },
    resultShape: "score",
    scales: [],
    schemaVersion: "2.0",
  };
  assert.equal(
    validateScoringDefinitionV2({
      criterionScoreIds: ["attention_accuracy"],
      definition,
      items: [{
        config: { maxPoints: 1, minPoints: 0, strategy: "single_choice_points" },
        id: "q1",
        questionType: "single_choice",
        scoringModel: "criterion",
      }],
    }).ok,
    true,
  );
  assert.equal(
    validateScoringDefinitionV2({
      criterionScoreIds: ["attention_accuracy"],
      definition: { ...definition, overallScore: null },
    }).ok,
    false,
  );
  assert.equal(
    validateScoringDefinitionV2({
      criterionScoreIds: ["attention_accuracy"],
      definition,
      items: [{
        config: {
          bindings: [{ direction: 1, scaleId: "focus", weight: 1 }],
          responseMax: 5,
          responseMin: 1,
        },
        id: "q1",
        questionType: "scale",
        scoringModel: "scale",
      }],
    }).ok,
    false,
  );
});

test("attention keeps accuracy, omissions and response time separate", () => {
  const result = scoreAttention([
    { answered: true, isCorrect: true, itemId: "q1", timeSpentSeconds: 2 },
    { answered: true, isCorrect: false, itemId: "q2", timeSpentSeconds: 6 },
    { answered: false, isCorrect: null, itemId: "q3", timeSpentSeconds: 20 },
  ]);

  assert.equal(result.metrics.correct_count, 1);
  assert.equal(result.metrics.incorrect_count, 1);
  assert.equal(result.metrics.omitted_count, 1);
  assert.equal(result.metrics.accuracy, 50);
  assert.equal(result.metrics.completion_rate, 66.666667);
  assert.equal(result.metrics.mean_response_time_ms, 4_000);
  assert.equal(result.metrics.median_response_time_ms, 4_000);
  assert.equal(result.metrics.timed_items, 2);
  assert.equal(result.metrics.speed_percentile, null);
  assert.equal(result.metrics.false_positive_count, null);
  assert.equal(result.metrics.false_negative_count, null);
  assert.equal(result.scores[0].normalized_score, 50);
  assert.equal(result.warnings[0]?.scoreId, "attention_accuracy");
});

test("attention returns null accuracy when every item is omitted", () => {
  const result = scoreAttention([
    { answered: false, isCorrect: null, itemId: "q1", timeSpentSeconds: null },
    { answered: false, isCorrect: null, itemId: "q2", timeSpentSeconds: null },
  ]);
  assert.equal(result.metrics.accuracy, null);
  assert.equal(result.metrics.completion_rate, 0);
  assert.equal(result.metrics.mean_response_time_ms, null);
  assert.equal(result.metrics.median_response_time_ms, null);
  assert.equal(result.scores[0].status, "insufficient_data");
  assert.equal(result.scores[0].raw_score, null);
});

test("signal classification is rejected outside attention and on non-choice items", () => {
  const baseItem = {
    config: {
      maxPoints: 1,
      minPoints: 0,
      signalClassification: { targetPresent: true },
      strategy: "single_choice_points",
    },
    id: "q1",
    questionType: "single_choice",
    scoringModel: "criterion",
  };
  assert.equal(validateScoringDefinitionV2({
    criterionScoreIds: ["criterion_total"],
    definition: {
      assessmentDomain: "knowledge",
      composites: [],
      normAssignments: [],
      overallScore: { sourceId: "criterion_total", sourceType: "criterion" },
      resultShape: "score",
      scales: [],
      schemaVersion: "2.0",
    },
    items: [baseItem],
  }).ok, false);
  assert.equal(validateScoringDefinitionV2({
    criterionScoreIds: ["attention_accuracy"],
    definition: {
      assessmentDomain: "attention",
      composites: [],
      normAssignments: [],
      overallScore: { sourceId: "attention_accuracy", sourceType: "criterion" },
      resultShape: "score",
      scales: [],
      schemaVersion: "2.0",
    },
    items: [{
      ...baseItem,
      config: { ...baseItem.config, strategy: "ordering" },
      questionType: "ordering",
    }],
  }).ok, false);
});

test("attention classifies explicit target and non-target responses", () => {
  const result = scoreAttention([
    { answered: true, isCorrect: true, itemId: "tp", targetPresent: true, timeSpentSeconds: null },
    { answered: true, isCorrect: false, itemId: "fn", targetPresent: true, timeSpentSeconds: null },
    { answered: true, isCorrect: false, itemId: "fp", targetPresent: false, timeSpentSeconds: null },
    { answered: true, isCorrect: true, itemId: "tn", targetPresent: false, timeSpentSeconds: null },
  ]);

  assert.equal(result.metrics.true_positive_count, 1);
  assert.equal(result.metrics.false_negative_count, 1);
  assert.equal(result.metrics.false_positive_count, 1);
  assert.equal(result.metrics.true_negative_count, 1);
  assert.equal(result.metrics.hit_rate, 0.5);
  assert.equal(result.metrics.false_alarm_rate, 0.5);
});

test("attention counts an omitted target as a miss and excludes legacy items", () => {
  const result = scoreAttention([
    { answered: false, isCorrect: null, itemId: "miss", targetPresent: true, timeSpentSeconds: null },
    { answered: false, isCorrect: null, itemId: "legacy", timeSpentSeconds: null },
  ]);

  assert.equal(result.metrics.false_negative_count, 1);
  assert.equal(result.metrics.true_positive_count, 0);
  assert.equal(result.metrics.false_positive_count, 0);
  assert.equal(result.metrics.true_negative_count, 0);
  assert.equal(result.metrics.hit_rate, 0);
  assert.equal(result.metrics.false_alarm_rate, null);
});
