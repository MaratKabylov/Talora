import { createCoverageConfidence } from "../confidence.ts";
import { normalizeScore, reverseScore, roundOutput } from "../normalization.ts";
import {
  ScoringDomainError,
  type ScaleDefinition,
  type ScaleScoreValue,
  type ScaleScoringConfig,
  type ScoringWarning,
} from "../types.ts";

export type ScaleItemResponse = {
  config: ScaleScoringConfig;
  itemId: string;
  response: number | null;
};

export function scoreScales(
  scales: readonly ScaleDefinition[],
  items: readonly ScaleItemResponse[],
): { scores: ScaleScoreValue[]; warnings: ScoringWarning[] } {
  const scores: ScaleScoreValue[] = [];
  const warnings: ScoringWarning[] = [];

  for (const scale of [...scales].sort((left, right) => left.displayOrder - right.displayOrder)) {
    const bindings = items.flatMap((item) =>
      item.config.bindings
        .filter((binding) => binding.scaleId === scale.id)
        .map((binding) => ({ binding, item })),
    );
    const answered = bindings.filter(({ item }) => item.response !== null);
    const confidence = createCoverageConfidence(answered.length, bindings.length);
    const requiredCount = Math.max(
      scale.minAnsweredItems ?? 0,
      scale.minAnsweredRatio === null || scale.minAnsweredRatio === undefined
        ? bindings.length
        : Math.ceil(bindings.length * scale.minAnsweredRatio),
    );

    if (bindings.length === 0 || answered.length < requiredCount) {
      scores.push({
        confidence,
        id: scale.id,
        norm_score: null,
        normalized_score: null,
        raw_score: null,
        status: "insufficient_data",
      });
      warnings.push({
        code: "INSUFFICIENT_DATA",
        message: `Scale '${scale.code}' has ${answered.length} of ${bindings.length} eligible item responses.`,
        scoreId: scale.id,
      });
      continue;
    }

    const contributions = answered.map(({ binding, item }) => {
      const response = item.response;
      if (response === null) {
        throw new ScoringDomainError("INVALID_ANSWER_PAYLOAD", "Missing scale response.");
      }
      const keyed =
        binding.direction === -1
          ? reverseScore(response, item.config.responseMin, item.config.responseMax)
          : validateDirectResponse(response, item.config.responseMin, item.config.responseMax);
      return { value: keyed * binding.weight, weight: binding.weight };
    });
    const raw =
      scale.aggregation === "sum"
        ? contributions.reduce((sum, contribution) => sum + contribution.value, 0)
        : contributions.reduce((sum, contribution) => sum + contribution.value, 0) /
          contributions.reduce((sum, contribution) => sum + Math.abs(contribution.weight), 0);
    const rawScore = roundOutput(raw);
    const normalizedScore = normalizeScore(
      rawScore,
      scale.theoreticalMin,
      scale.theoreticalMax,
    );

    scores.push({
      confidence,
      id: scale.id,
      norm_score: null,
      normalized_score: normalizedScore,
      raw_score: rawScore,
      status: "ok",
    });

    if (answered.length < bindings.length && scale.missingPolicy === "prorate") {
      warnings.push({
        code: "PRORATED_SCORE",
        message: `Scale '${scale.code}' was calculated from answered items after meeting its coverage threshold.`,
        scoreId: scale.id,
      });
    }
  }

  return { scores, warnings };
}

function validateDirectResponse(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ScoringDomainError(
      "INVALID_ANSWER_PAYLOAD",
      `Scale response ${value} is outside the configured range ${minimum}..${maximum}.`,
    );
  }
  return value;
}
