import assert from "node:assert/strict";
import test from "node:test";

import { validateScoringDefinitionV2 } from "../lib/scoring/definition.ts";
import {
  scoreLearning,
  type LearningItemInput,
} from "../lib/scoring/models/learning.ts";

const config = { initialWeight: 0.4, recoveryWeight: 0.6 };

test("learning config requires explicit weights summing to one", () => {
  const base = {
    assessmentDomain: "learning",
    composites: [],
    normAssignments: [],
    overallScore: { sourceId: "learning_final", sourceType: "criterion" },
    resultShape: "score",
    scales: [],
    schemaVersion: "2.0",
  };
  assert.equal(validateScoringDefinitionV2({ definition: base }).ok, false);
  assert.equal(
    validateScoringDefinitionV2({
      definition: {
        ...base,
        learningScoring: { initialWeight: 0.4, recoveryWeight: 0.5 },
      },
    }).ok,
    false,
  );
  assert.equal(
    validateScoringDefinitionV2({
      criterionScoreIds: ["learning_final"],
      definition: { ...base, learningScoring: config },
    }).ok,
    true,
  );
});

function item(overrides: Partial<LearningItemInput> = {}): LearningItemInput {
  return {
    initial: {
      answered: true,
      isCorrect: false,
      maxPoints: 1,
      pointsAwarded: 0,
    },
    initialQuestionId: "initial",
    recovery: {
      answered: true,
      isCorrect: true,
      maxPoints: 1,
      pointsAwarded: 1,
    },
    recoveryQuestionId: "recovery",
    ...overrides,
  };
}

test("learning: correct on the first attempt needs no recovery component", () => {
  const result = scoreLearning(config, [
    item({
      initial: { answered: true, isCorrect: true, maxPoints: 1, pointsAwarded: 1 },
      recovery: null,
      recoveryQuestionId: null,
    }),
  ]);
  assert.equal(result.metrics.initial_score, 100);
  assert.equal(result.metrics.recovery_rate, null);
  assert.equal(result.metrics.learning_gain, 0);
  assert.equal(result.metrics.final_score, 100);
  assert.equal(result.metrics.items[0].initial_correct, true);
  assert.equal(result.metrics.items[0].recovered, null);
});

test("learning: failed initial item can be recovered after feedback", () => {
  const result = scoreLearning(config, [
    item(),
    item({
      initial: { answered: true, isCorrect: true, maxPoints: 1, pointsAwarded: 1 },
      initialQuestionId: "initial_2",
      recovery: null,
      recoveryQuestionId: null,
    }),
  ]);
  assert.equal(result.metrics.initial_score, 50);
  assert.equal(result.metrics.recovery_rate, 100);
  assert.equal(result.metrics.post_feedback_score, 100);
  assert.equal(result.metrics.learning_gain, 50);
  assert.equal(result.metrics.final_score, 80);
  assert.equal(result.metrics.items[0].recovered, true);
  assert.equal(result.scores.find((score) => score.id === "learning_final")?.normalized_score, 80);
});

test("learning: failed recovery remains a failed recovery", () => {
  const result = scoreLearning(config, [
    item({
      recovery: { answered: true, isCorrect: false, maxPoints: 1, pointsAwarded: 0 },
    }),
  ]);
  assert.equal(result.metrics.initial_score, 0);
  assert.equal(result.metrics.recovery_rate, 0);
  assert.equal(result.metrics.learning_gain, 0);
  assert.equal(result.metrics.final_score, 0);
  assert.equal(result.metrics.items[0].recovered, false);
});

test("learning: missing recovery is explicit and lowers coverage", () => {
  const result = scoreLearning(config, [
    item(),
    item({
      initialQuestionId: "initial_2",
      recovery: { answered: false, isCorrect: null, maxPoints: 1, pointsAwarded: null },
      recoveryQuestionId: "recovery_2",
    }),
  ]);
  assert.equal(result.metrics.eligible_failed_items, 2);
  assert.equal(result.metrics.remediation_answered_items, 1);
  assert.equal(result.metrics.recovery_rate, 50);
  assert.equal(result.metrics.final_score, 30);
  assert.equal(result.metrics.items[1].recovered, null);
  assert.equal(result.warnings[0]?.scoreId, "learning_recovery");
});

test("learning: no eligible failed items returns null recovery rate", () => {
  const result = scoreLearning(config, [
    item({
      initial: { answered: true, isCorrect: true, maxPoints: 2, pointsAwarded: 2 },
      recovery: { answered: true, isCorrect: true, maxPoints: 1, pointsAwarded: 1 },
    }),
  ]);
  assert.equal(result.metrics.eligible_failed_items, 0);
  assert.equal(result.metrics.recovered_items, 0);
  assert.equal(result.metrics.recovery_rate, null);
  assert.equal(result.metrics.final_score, 100);
  assert.equal(result.metrics.items[0].recovered, null);
});
