import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INTERPRETATION_POLICY,
  interpretationDirectionSchema,
  interpretReportScore,
  parseInterpretationPolicy,
} from "../lib/scoring/interpretation-policy.ts";

test("default interpretation policy preserves report boundaries and a neutral zone", () => {
  assert.equal(interpretReportScore(64.99, DEFAULT_INTERPRETATION_POLICY)?.band, "development_area");
  assert.equal(interpretReportScore(65, DEFAULT_INTERPRETATION_POLICY)?.band, "neutral");
  assert.equal(interpretReportScore(74.99, DEFAULT_INTERPRETATION_POLICY)?.band, "neutral");
  assert.equal(interpretReportScore(75, DEFAULT_INTERPRETATION_POLICY)?.band, "strength");
});

test("custom interpretation policy supports exact 40 and 80 boundaries", () => {
  const policy = parseInterpretationPolicy({
    bands: [
      { code: "development_area", min: 0, max: 39.99 },
      { code: "neutral", min: 40, max: 79.99 },
      { code: "strength", min: 80, max: 100 },
    ],
  });

  assert.equal(interpretReportScore(39.99, policy)?.band, "development_area");
  assert.equal(interpretReportScore(40, policy)?.band, "neutral");
  assert.equal(interpretReportScore(79.99, policy)?.band, "neutral");
  assert.equal(interpretReportScore(80, policy)?.band, "strength");
});

test("profile dimensions remain descriptive unless desirability is directed", () => {
  assert.deepEqual(
    interpretReportScore(90, DEFAULT_INTERPRETATION_POLICY, {
      assessmentDomain: "personality",
    }),
    { band: "high", direction: "neutral", evaluative: false },
  );
  assert.deepEqual(
    interpretReportScore(90, DEFAULT_INTERPRETATION_POLICY, {
      direction: "higher_is_better",
    }),
    { band: "strength", direction: "higher_is_better", evaluative: true },
  );
});

test("interpretation policy rejects gaps, overlaps, duplicates and invalid directions", () => {
  for (const bands of [
    [
      { code: "development_area", min: 0, max: 39.99 },
      { code: "neutral", min: 41, max: 79.99 },
      { code: "strength", min: 80, max: 100 },
    ],
    [
      { code: "development_area", min: 0, max: 40 },
      { code: "neutral", min: 40, max: 79.99 },
      { code: "strength", min: 80, max: 100 },
    ],
    [
      { code: "neutral", min: 0, max: 39.99 },
      { code: "neutral", min: 40, max: 79.99 },
      { code: "strength", min: 80, max: 100 },
    ],
  ]) {
    assert.throws(() => parseInterpretationPolicy({ bands }));
  }
  assert.equal(interpretationDirectionSchema.safeParse("up_is_better").success, false);
});
