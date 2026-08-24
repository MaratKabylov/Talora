import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RECOMMENDATION_POLICY,
  parseRecommendationPolicy,
  recommendWithPolicy,
} from "../lib/scoring/recommendation-policy.ts";

const scores = (value: number) => ({
  composite_score: value,
  fit_score: value,
  overall_score: value,
});

test("default recommendation policy preserves legacy boundaries", () => {
  const policy = parseRecommendationPolicy(null);
  assert.deepEqual(policy, DEFAULT_RECOMMENDATION_POLICY);
  assert.equal(recommendWithPolicy(policy, scores(84.99)), "invite");
  assert.equal(recommendWithPolicy(policy, scores(85)), "strong_candidate");
  assert.equal(recommendWithPolicy(policy, scores(74.99)), "consider");
  assert.equal(recommendWithPolicy(policy, scores(75)), "invite");
  assert.equal(recommendWithPolicy(policy, scores(64.99)), "backup");
  assert.equal(recommendWithPolicy(policy, scores(65)), "consider");
  assert.equal(recommendWithPolicy(policy, scores(49.99)), "not_recommended");
  assert.equal(recommendWithPolicy(policy, scores(50)), "backup");
});

test("custom recommendation policy selects its explicit score source", () => {
  const policy = parseRecommendationPolicy({
    bands: [
      { code: "decline", label: "Decline", min: 0, max: 64.99 },
      { code: "consider", label: "Consider", min: 65, max: 79.99 },
      { code: "invite", label: "Invite", min: 80, max: 89.99 },
      { code: "strong", label: "Strong", min: 90, max: 100 },
    ],
    source: "composite_score",
  });
  assert.equal(recommendWithPolicy(policy, {
    composite_score: 90,
    fit_score: 10,
    overall_score: 10,
  }), "strong");
  assert.equal(recommendWithPolicy(policy, scores(80)), "invite");
  assert.equal(recommendWithPolicy(policy, scores(65)), "consider");
});

test("invalid recommendation policies fail closed", () => {
  const validBands = [
    { code: "low", label: "Low", min: 0, max: 49.99 },
    { code: "high", label: "High", min: 50, max: 100 },
  ];
  assert.throws(() => parseRecommendationPolicy({ bands: validBands, source: "bad" }));
  assert.throws(() => parseRecommendationPolicy({
    bands: [
      { code: "same", label: "Low", min: 0, max: 60 },
      { code: "same", label: "High", min: 50, max: 100 },
    ],
    source: "fit_score",
  }));
  assert.throws(() => parseRecommendationPolicy({
    bands: [
      { code: "low", label: "Low", min: 0, max: 40 },
      { code: "high", label: "High", min: 50, max: 100 },
    ],
    source: "fit_score",
  }));
});
