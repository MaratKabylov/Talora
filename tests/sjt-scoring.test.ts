import assert from "node:assert/strict";
import test from "node:test";

import { scoreSjt } from "../lib/scoring/models/sjt.ts";
import type { ScaleDefinition, SjtScoringConfig } from "../lib/scoring/types.ts";

const scales: ScaleDefinition[] = [
  {
    aggregation: "sum",
    code: "leadership",
    displayOrder: 0,
    id: "leadership",
    missingPolicy: "insufficient",
    theoreticalMax: 4,
    theoreticalMin: 0,
    title: "Leadership",
  },
  {
    aggregation: "sum",
    code: "communication",
    displayOrder: 1,
    id: "communication",
    missingPolicy: "insufficient",
    theoreticalMax: 2,
    theoreticalMin: 0,
    title: "Communication",
  },
];

function config(options: SjtScoringConfig["options"]): SjtScoringConfig {
  return { maxPoints: 3, minPoints: 0, options };
}

test("SJT separates situational points from multi-dimension effects", () => {
  const result = scoreSjt(scales, [
    {
      config: config([
        {
          dimensionEffects: [
            { effect: 2, scaleId: "leadership" },
            { effect: 1, scaleId: "communication" },
          ],
          optionId: "a",
          points: 3,
        },
        { dimensionEffects: [], optionId: "b", points: 0 },
      ]),
      itemId: "situation_1",
      questionType: "single_choice",
      selectedOptionIds: ["a"],
    },
    {
      config: config([
        {
          dimensionEffects: [{ effect: 1, scaleId: "leadership" }],
          optionId: "c",
          points: 2,
        },
        { dimensionEffects: [], optionId: "d", points: 0 },
      ]),
      itemId: "situation_2",
      questionType: "single_choice",
      selectedOptionIds: ["c"],
    },
  ]);

  assert.equal(result.situationalScores.at(-1)?.id, "sjt_total");
  assert.equal(result.situationalScores.at(-1)?.normalized_score, 83.333333);
  assert.equal(result.dimensionScores.find((score) => score.id === "leadership")?.normalized_score, 75);
  assert.equal(result.dimensionScores.find((score) => score.id === "communication")?.normalized_score, 50);
});

test("SJT multiple choice sums selected options and never emits correctness", () => {
  const result = scoreSjt([], [{
    config: config([
      { dimensionEffects: [], optionId: "a", points: 2 },
      { dimensionEffects: [], optionId: "b", points: 2 },
      { dimensionEffects: [], optionId: "c", points: -1 },
    ]),
    itemId: "multi",
    questionType: "multiple_choice",
    selectedOptionIds: ["a", "b"],
  }]);

  assert.equal(result.itemScores[0].points, 3);
  assert.equal(result.situationalScores[0].normalized_score, 100);
});

test("SJT returns insufficient data instead of scoring an omitted situation as zero", () => {
  const result = scoreSjt(scales, [{
    config: config([{
      dimensionEffects: [{ effect: 2, scaleId: "leadership" }],
      optionId: "a",
      points: 3,
    }]),
    itemId: "missing",
    questionType: "single_choice",
    selectedOptionIds: null,
  }]);

  assert.equal(result.situationalScores.at(-1)?.normalized_score, null);
  assert.equal(result.dimensionScores[0].status, "insufficient_data");
});
