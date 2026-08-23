import { createCoverageConfidence } from "../confidence.ts";
import { normalizeScore, roundOutput } from "../normalization.ts";
import type {
  ScaleDefinition,
  ScaleScoreValue,
  ScoreValue,
  ScoringWarning,
  SjtScoringConfig,
} from "../types.ts";
import { ScoringDomainError } from "../types.ts";

export type SjtItemResponse = {
  config: SjtScoringConfig;
  itemId: string;
  questionType: "single_choice" | "multiple_choice";
  selectedOptionIds: string[] | null;
};

export type SjtItemScore = {
  itemId: string;
  points: number | null;
};

export type SjtScoreResult = {
  dimensionScores: ScaleScoreValue[];
  itemScores: SjtItemScore[];
  situationalScores: ScoreValue[];
  warnings: ScoringWarning[];
};

export function scoreSjt(
  scales: readonly ScaleDefinition[],
  items: readonly SjtItemResponse[],
): SjtScoreResult {
  if (items.length === 0) {
    return { dimensionScores: [], itemScores: [], situationalScores: [], warnings: [] };
  }
  const warnings: ScoringWarning[] = [];
  const itemScores = items.map((item): SjtItemScore => {
    if (item.selectedOptionIds === null) return { itemId: item.itemId, points: null };
    const allowed = new Set(item.config.options.map((option) => option.optionId));
    if (
      new Set(item.selectedOptionIds).size !== item.selectedOptionIds.length ||
      item.selectedOptionIds.some((optionId) => !allowed.has(optionId)) ||
      (item.questionType === "single_choice" && item.selectedOptionIds.length !== 1)
    ) {
      throw new ScoringDomainError(
        "INVALID_ANSWER_PAYLOAD",
        `Invalid SJT option selection for item '${item.itemId}'.`,
      );
    }
    const selected = new Set(item.selectedOptionIds);
    const raw = item.config.options
      .filter((option) => selected.has(option.optionId))
      .reduce((sum, option) => sum + option.points, 0);
    return {
      itemId: item.itemId,
      points: roundOutput(Math.min(Math.max(raw, item.config.minPoints), item.config.maxPoints)),
    };
  });
  const situationalScores = buildSituationalScores(items, itemScores, warnings);
  const dimensionScores = buildDimensionScores(scales, items, warnings);
  return { dimensionScores, itemScores, situationalScores, warnings };
}

function buildSituationalScores(
  items: readonly SjtItemResponse[],
  itemScores: readonly SjtItemScore[],
  warnings: ScoringWarning[],
) {
  const scores = itemScores.map((itemScore): ScoreValue => {
    const item = items.find((candidate) => candidate.itemId === itemScore.itemId)!;
    return {
      confidence: createCoverageConfidence(itemScore.points === null ? 0 : 1, 1),
      id: item.itemId,
      norm_score: null,
      normalized_score: itemScore.points === null
        ? null
        : normalizeScore(itemScore.points, item.config.minPoints, item.config.maxPoints),
      raw_score: itemScore.points,
      status: itemScore.points === null ? "insufficient_data" : "ok",
    };
  });
  const answered = itemScores.filter((item) => item.points !== null);
  const minimum = items.reduce((sum, item) => sum + item.config.minPoints, 0);
  const maximum = items.reduce((sum, item) => sum + item.config.maxPoints, 0);
  const raw = answered.reduce((sum, item) => sum + (item.points ?? 0), 0);
  const complete = answered.length === items.length && items.length > 0;

  scores.push({
    confidence: createCoverageConfidence(answered.length, items.length),
    id: "sjt_total",
    norm_score: null,
    normalized_score: complete ? normalizeScore(raw, minimum, maximum) : null,
    raw_score: complete ? roundOutput(raw) : null,
    status: complete ? "ok" : "insufficient_data",
  });
  if (!complete) {
    warnings.push({
      code: "INSUFFICIENT_DATA",
      message: `SJT has ${answered.length} of ${items.length} situational responses.`,
      scoreId: "sjt_total",
    });
  }
  return scores;
}

function buildDimensionScores(
  scales: readonly ScaleDefinition[],
  items: readonly SjtItemResponse[],
  warnings: ScoringWarning[],
) {
  return [...scales]
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((scale): ScaleScoreValue => {
      const eligible = items.filter((item) =>
        item.config.options.some((option) =>
          option.dimensionEffects.some((effect) => effect.scaleId === scale.id),
        ),
      );
      const answered = eligible.filter((item) => item.selectedOptionIds !== null);
      const requiredCount = Math.max(
        scale.minAnsweredItems ?? 0,
        scale.minAnsweredRatio === null || scale.minAnsweredRatio === undefined
          ? eligible.length
          : Math.ceil(eligible.length * scale.minAnsweredRatio),
      );
      const confidence = createCoverageConfidence(answered.length, eligible.length);

      if (eligible.length === 0 || answered.length < requiredCount) {
        warnings.push({
          code: "INSUFFICIENT_DATA",
          message: `SJT dimension '${scale.code}' has ${answered.length} of ${eligible.length} eligible responses.`,
          scoreId: scale.id,
        });
        return {
          confidence,
          id: scale.id,
          norm_score: null,
          normalized_score: null,
          raw_score: null,
          status: "insufficient_data",
        };
      }

      const contributions = answered.map((item) => {
        const selected = new Set(item.selectedOptionIds ?? []);
        return item.config.options
          .filter((option) => selected.has(option.optionId))
          .flatMap((option) => option.dimensionEffects)
          .filter((effect) => effect.scaleId === scale.id)
          .reduce((sum, effect) => sum + effect.effect, 0);
      });
      const raw = scale.aggregation === "sum"
        ? contributions.reduce((sum, value) => sum + value, 0)
        : contributions.reduce((sum, value) => sum + value, 0) / contributions.length;
      const rawScore = roundOutput(raw);

      if (answered.length < eligible.length && scale.missingPolicy === "prorate") {
        warnings.push({
          code: "PRORATED_SCORE",
          message: `SJT dimension '${scale.code}' was calculated from answered items.`,
          scoreId: scale.id,
        });
      }
      return {
        confidence,
        id: scale.id,
        norm_score: null,
        normalized_score: normalizeScore(rawScore, scale.theoreticalMin, scale.theoreticalMax),
        raw_score: rawScore,
        status: "ok",
      };
    });
}
