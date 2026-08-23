import assert from "node:assert/strict";
import test from "node:test";

import {
  assessmentCompositeConfigSchema,
  calculateAssessmentComposite,
  normalizeAssessmentCompositeConfig,
} from "../lib/scoring/models/assessment-composite.ts";

const config = assessmentCompositeConfigSchema.parse({
  components: [
    { source: "learning_final", weight: 0.3 },
    { source: "cognitive_ability", weight: 0.2 },
    { source: "leadership", weight: 0.25 },
    { source: "motivation_fit", weight: 0.15 },
    { source: "behavior_fit", weight: 0.1 },
  ],
});

test("assessment composite calculates a weighted score across heterogeneous sources", () => {
  const result = calculateAssessmentComposite(config, {
    behavior_fit: 60,
    cognitive_ability: 80,
    leadership: 90,
    learning_final: 70,
    motivation_fit: 100,
  });

  assert.equal(result.score, 80.5);
  assert.equal(result.status, "complete");
  assert.equal(result.coverage, 100);
  assert.equal(
    result.components.reduce((sum, component) => sum + (component.contribution ?? 0), 0),
    80.5,
  );
});

test("renormalize excludes null sources from both numerator and denominator", () => {
  const result = calculateAssessmentComposite(config, {
    behavior_fit: null,
    cognitive_ability: 80,
    leadership: 90,
    learning_final: 70,
    motivation_fit: null,
  });

  assert.equal(result.score, 79.33);
  assert.equal(result.status, "partial");
  assert.equal(result.coverage, 60);
});

test("fail policy and minimum coverage preserve an explicit null result", () => {
  const failConfig = assessmentCompositeConfigSchema.parse({
    ...config,
    missing_policy: "fail",
  });
  const minimumConfig = assessmentCompositeConfigSchema.parse({
    ...config,
    min_required_components: 4,
  });
  const values = { learning_final: 70, cognitive_ability: 80 };

  assert.equal(calculateAssessmentComposite(failConfig, values).score, null);
  assert.equal(calculateAssessmentComposite(minimumConfig, values).score, null);
  assert.equal(calculateAssessmentComposite(minimumConfig, values).status, "insufficient_data");
});

test("assessment composite validation rejects duplicate or malformed sources", () => {
  const invalid = assessmentCompositeConfigSchema.safeParse({
    components: [
      { source: "leadership", weight: 1 },
      { source: "leadership", weight: 1 },
    ],
    min_required_components: 3,
  });

  assert.equal(invalid.success, false);
  assert.equal(normalizeAssessmentCompositeConfig(null), null);
});
