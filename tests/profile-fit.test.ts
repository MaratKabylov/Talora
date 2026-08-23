import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateProfileFit,
  normalizeProfileTargets,
  profileTargetListSchema,
} from "../lib/scoring/profile-fit.ts";

test("profile fit is 100 inside the preferred range", () => {
  const result = calculateProfileFit(
    [{ dimensionId: "autonomy", score: 80 }],
    [{ dimension_id: "autonomy", preferred_min: 70, preferred_max: 100, weight: 2 }],
  );

  assert.equal(result?.score, 100);
  assert.equal(result?.coverage, 100);
});

test("profile fit decays toward the scale boundary outside the range", () => {
  const result = calculateProfileFit(
    [
      { dimensionId: "planning", score: 20 },
      { dimensionId: "initiative", score: 80 },
    ],
    [
      { dimension_id: "planning", preferred_min: 40, preferred_max: 60, weight: 1 },
      { dimension_id: "initiative", preferred_min: 40, preferred_max: 60, weight: 1 },
    ],
  );

  assert.equal(result?.score, 50);
});

test("profile fit applies target weights and averages duplicate measured dimensions", () => {
  const result = calculateProfileFit(
    [
      { dimensionId: "autonomy", score: 60 },
      { dimensionId: "autonomy", score: 80 },
      { dimensionId: "stability", score: 100 },
    ],
    [
      { dimension_id: "autonomy", preferred_min: 70, preferred_max: 100, weight: 3 },
      { dimension_id: "stability", preferred_min: 0, preferred_max: 50, weight: 1 },
    ],
  );

  assert.equal(result?.components[0].score, 70);
  assert.equal(result?.score, 75);
});

test("missing dimensions are not scored as zero", () => {
  const result = calculateProfileFit(
    [],
    [{ dimension_id: "autonomy", preferred_min: 70, preferred_max: 100, weight: 1 }],
  );

  assert.equal(result?.score, null);
  assert.equal(result?.coverage, 0);
  assert.equal(calculateProfileFit([], []), null);
});

test("target validation rejects invalid ranges and duplicate dimensions", () => {
  const invalid = profileTargetListSchema.safeParse([
    { dimension_id: "autonomy", preferred_min: 80, preferred_max: 70, weight: 1 },
    { dimension_id: "autonomy", preferred_min: 0, preferred_max: 100, weight: 1 },
  ]);

  assert.equal(invalid.success, false);
  assert.deepEqual(normalizeProfileTargets({}), []);
});
