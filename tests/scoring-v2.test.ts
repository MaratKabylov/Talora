import assert from "node:assert/strict";
import test from "node:test";

import { createCoverageConfidence } from "../lib/scoring/confidence.ts";
import { validateScoringDefinitionV2 } from "../lib/scoring/definition.ts";
import { buildScoringResultV2 } from "../lib/scoring/engine.ts";
import { calculateComposite } from "../lib/scoring/models/composite.ts";
import {
  getForcedChoiceScorer,
  ipsativeForcedChoiceScorer,
} from "../lib/scoring/models/forced-choice.ts";
import { scoreScales } from "../lib/scoring/models/scale.ts";
import { convertNormScore, normScaleDefinitionSchema } from "../lib/scoring/norms.ts";
import { normalizeScore, reverseScore } from "../lib/scoring/normalization.ts";
import { parseScoringResultV2 } from "../lib/scoring/result.ts";
import type {
  CompositeDefinition,
  ScaleDefinition,
  ScoreValue,
  ScoringDefinitionV2,
} from "../lib/scoring/types.ts";

const confidence = createCoverageConfidence(1, 1);

function score(id: string, raw: number | null, normalized: number | null): ScoreValue {
  return {
    confidence,
    id,
    norm_score: null,
    normalized_score: normalized,
    raw_score: raw,
    status: raw === null ? "insufficient_data" : "ok",
  };
}

function definition(overrides: Partial<ScoringDefinitionV2> = {}): ScoringDefinitionV2 {
  return {
    assessmentDomain: "skills",
    composites: [],
    normAssignments: [],
    overallScore: null,
    resultShape: "score",
    scales: [],
    schemaVersion: "2.0",
    ...overrides,
  };
}

function scale(overrides: Partial<ScaleDefinition> = {}): ScaleDefinition {
  return {
    aggregation: "mean",
    code: "achievement",
    displayOrder: 1,
    id: "scale_achievement",
    missingPolicy: "insufficient",
    theoreticalMax: 5,
    theoreticalMin: 1,
    title: "Achievement",
    ...overrides,
  };
}

test("reverse scoring uses configured bounds", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((value) => reverseScore(value, 1, 5)), [5, 4, 3, 2, 1]);
  assert.deepEqual([0, 1, 2, 3, 4].map((value) => reverseScore(value, 0, 4)), [4, 3, 2, 1, 0]);
  assert.equal(reverseScore(2, 1, 7), 6);
});

test("mathematical normalization is distinct and validates the theoretical range", () => {
  assert.equal(normalizeScore(1, 1, 5), 0);
  assert.equal(normalizeScore(3, 1, 5), 50);
  assert.equal(normalizeScore(5, 1, 5), 100);
  assert.throws(() => normalizeScore(1, 1, 1), /positive range/);
  assert.throws(() => normalizeScore(6, 1, 5), /outside the validated theoretical range/);
});

test("coverage does not manufacture reliability, SE or confidence intervals", () => {
  const result = createCoverageConfidence(9, 10);
  assert.equal(result.coverage.ratio, 0.9);
  assert.equal(result.level, "high");
  assert.deepEqual(result.reliability, {
    method: "not_available",
    source: null,
    value: null,
  });
  assert.equal(result.standard_error, null);
  assert.equal(result.confidence_interval, null);
  assert.equal(createCoverageConfidence(0, 0).level, "not_available");
});

test("scale scorer supports direct, reverse and weighted mean bindings", () => {
  const result = scoreScales(
    [scale()],
    [
      {
        config: {
          bindings: [{ direction: 1, scaleId: "scale_achievement", weight: 1 }],
          responseMax: 5,
          responseMin: 1,
        },
        itemId: "q1",
        response: 5,
      },
      {
        config: {
          bindings: [{ direction: -1, scaleId: "scale_achievement", weight: 1 }],
          responseMax: 5,
          responseMin: 1,
        },
        itemId: "q2",
        response: 1,
      },
    ],
  );
  assert.equal(result.scores[0].raw_score, 5);
  assert.equal(result.scores[0].normalized_score, 100);
  assert.equal(result.scores[0].norm_score, null);
  assert.equal(result.scores[0].confidence.coverage.ratio, 1);
});

test("scale scorer returns insufficient data below the configured coverage boundary", () => {
  const result = scoreScales(
    [scale({ minAnsweredRatio: 0.75, missingPolicy: "prorate" })],
    [0, 1, 2, 3].map((index) => ({
      config: {
        bindings: [{ direction: 1 as const, scaleId: "scale_achievement", weight: 1 }],
        responseMax: 5,
        responseMin: 1,
      },
      itemId: `q${index}`,
      response: index < 2 ? 4 : null,
    })),
  );
  assert.equal(result.scores[0].status, "insufficient_data");
  assert.equal(result.scores[0].raw_score, null);
  assert.equal(result.warnings[0].code, "INSUFFICIENT_DATA");
});

test("definition validation separates response type from scoring model", () => {
  const result = validateScoringDefinitionV2({
    definition: definition({ scales: [scale()] }),
    items: [
      {
        config: {
          bindings: [{ direction: -1, scaleId: "scale_achievement", weight: 1 }],
          responseMax: 7,
          responseMin: 1,
        },
        id: "q_scale",
        questionType: "scale",
        scoringModel: "scale",
      },
    ],
  });
  assert.equal(result.ok, true);

  const incompatible = validateScoringDefinitionV2({
    definition: definition(),
    items: [
      {
        config: null,
        id: "q_open",
        questionType: "open_text",
        scoringModel: "criterion",
      },
    ],
  });
  assert.equal(incompatible.ok, false);
  assert.equal(incompatible.issues[0].code, "INVALID_SCORING_DEFINITION");
});

test("publication validation catches unknown scales, cycles and unsupported TIRT", () => {
  const invalid = validateScoringDefinitionV2({
    definition: definition({
      composites: [
        {
          aggregation: "sum",
          code: "a",
          id: "a",
          inputs: [{ scoreId: "b", source: "composite", value: "raw_score", weight: 1 }],
          missingPolicy: "fail",
          title: "A",
        },
        {
          aggregation: "sum",
          code: "b",
          id: "b",
          inputs: [{ scoreId: "a", source: "composite", value: "raw_score", weight: 1 }],
          missingPolicy: "fail",
          title: "B",
        },
      ],
      scales: [scale()],
    }),
    forPublication: true,
    items: [
      {
        config: {
          centering: "person_mean",
          method: "thurstonian_irt",
          roleWeights: { least: -1, most: 1 },
          statements: [
            { scaleId: "missing_scale", statementId: "s1" },
            { scaleId: "scale_achievement", statementId: "s2" },
          ],
        },
        id: "fc1",
        questionType: "forced_choice",
        scoringModel: "forced_choice",
      },
    ],
  });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.issues.some((entry) => entry.code === "COMPOSITE_CYCLE"));
  assert.ok(invalid.issues.some((entry) => entry.code === "UNSUPPORTED_SCORING_METHOD"));
  assert.ok(invalid.issues.some((entry) => entry.path.endsWith("scaleId")));
});

test("composite respects selected value field and missing policies", () => {
  const composite: CompositeDefinition = {
    aggregation: "weighted_mean",
    code: "readiness",
    id: "readiness",
    inputs: [
      { scoreId: "knowledge", source: "criterion", value: "normalized_score", weight: 3 },
      { scoreId: "behavior", source: "scale", value: "normalized_score", weight: 1 },
    ],
    missingPolicy: "fail",
    outputRange: { max: 100, min: 0 },
    title: "Readiness",
  };
  const result = calculateComposite(composite, {
    criterion: [score("knowledge", 8, 80)],
    scale: [score("behavior", 4, 60)],
  });
  assert.equal(result.raw_score, 75);
  assert.equal(result.normalized_score, 75);

  const insufficient = calculateComposite(composite, {
    criterion: [score("knowledge", 8, 80)],
    scale: [score("behavior", null, null)],
  });
  assert.equal(insufficient.status, "insufficient_data");
});

test("overall is null without explicit mapping and never averages profile scales", () => {
  const profile = buildScoringResultV2({
    criterionScores: [],
    definition: definition({
      assessmentDomain: "motivation",
      resultShape: "profile",
      scales: [scale()],
    }),
    definitionVersionId: "version_1",
    scaleScores: [score("scale_achievement", 4, 75)],
    scoredAt: "2026-08-23T00:00:00.000Z",
  });
  assert.equal(profile.overallScore, null);
  assert.equal(profile.schemaVersion, "2.0");
  assert.equal(profile.scaleScores[0].normalized_score, 75);
  assert.deepEqual(parseScoringResultV2(profile), profile);

  const criterion = buildScoringResultV2({
    criterionScores: [score("criterion_total", 8, 80)],
    definition: definition({
      overallScore: { sourceId: "criterion_total", sourceType: "criterion" },
    }),
    definitionVersionId: "version_2",
    scaleScores: [],
  });
  assert.equal(criterion.overallScore, 80);
});

test("ipsative scorer is within-person only and TIRT has no fallback implementation", () => {
  const result = ipsativeForcedChoiceScorer.score({
    blocks: [
      {
        config: {
          centering: "none",
          method: "ipsative",
          roleWeights: { least: -1, most: 1 },
          statements: [
            { scaleId: "a", statementId: "s1" },
            { scaleId: "b", statementId: "s2" },
          ],
        },
        itemId: "fc1",
        response: { leastStatementId: "s2", mostStatementId: "s1" },
      },
    ],
    scales: [
      scale({ code: "a", id: "a", theoreticalMax: 1, theoreticalMin: -1 }),
      scale({ code: "b", displayOrder: 2, id: "b", theoreticalMax: 1, theoreticalMin: -1 }),
    ],
  });
  assert.equal(result.scores[0].comparability, "within_person_only");
  assert.equal(result.scores[0].norm_score, null);
  assert.equal(result.scores[0].raw_score, 1);
  assert.equal(result.scores[1].raw_score, -1);
  assert.throws(() => getForcedChoiceScorer("thurstonian_irt"), /not implemented/);
});

test("norm conversion uses the exact assigned version and keeps norm metrics separate", () => {
  const assignment = {
    normScaleCode: "achievement",
    normSetId: "norm_kz_working_adults",
    normSetVersion: 2,
    primaryMetric: "percentile" as const,
    scaleId: "scale_achievement",
  };
  const normSet = {
    code: "kz_working_adults",
    id: "norm_kz_working_adults",
    populationLabel: "KZ working adults",
    scales: [
      {
        conversionMethod: "percentile_table" as const,
        parameters: {
          interpolation: "linear" as const,
          points: [
            { percentile: 10, score: 1 },
            { percentile: 90, score: 5 },
          ],
        },
        scaleCode: "achievement",
        scoreBasis: "raw_score" as const,
      },
    ],
    status: "published" as const,
    version: 2,
  };
  const result = convertNormScore({
    assignment,
    normSet,
    normalizedScore: 50,
    rawScore: 3,
  });
  assert.deepEqual(result.primary, { metric: "percentile", value: 50 });
  assert.equal(result.norm_set_version, 2);
  assert.equal(result.population_label, "KZ working adults");

  assert.throws(
    () => convertNormScore({
      assignment: { ...assignment, normSetVersion: 3 },
      normSet,
      normalizedScore: 50,
      rawScore: 3,
    }),
    /exact assigned ID and version/,
  );
  assert.throws(
    () => convertNormScore({
      assignment,
      comparability: "within_person_only",
      normSet,
      normalizedScore: 50,
      rawScore: 3,
    }),
    /cannot be converted with population norms/,
  );
});

test("norm parameter validation rejects non-monotonic tables and non-positive SD", () => {
  const table = normScaleDefinitionSchema.safeParse({
    conversionMethod: "percentile_table",
    parameters: {
      interpolation: "linear",
      points: [
        { percentile: 80, score: 1 },
        { percentile: 70, score: 2 },
      ],
    },
    scaleCode: "achievement",
    scoreBasis: "raw_score",
  });
  assert.equal(table.success, false);

  const zScore = normScaleDefinitionSchema.safeParse({
    conversionMethod: "z_score",
    parameters: { derivedMetrics: ["percentile"], mean: 50, sd: 0 },
    scaleCode: "achievement",
    scoreBasis: "normalized_score",
  });
  assert.equal(zScore.success, false);
});
