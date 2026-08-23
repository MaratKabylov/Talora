import { createCoverageConfidence } from "../confidence.ts";
import { normalizeScore, roundOutput } from "../normalization.ts";
import {
  ScoringDomainError,
  type ForcedChoiceScoreValue,
  type ForcedChoiceScoringConfig,
  type ScaleDefinition,
  type ScoringWarning,
} from "../types.ts";

export type ForcedChoiceBlockResponse = {
  config: ForcedChoiceScoringConfig;
  itemId: string;
  response: { leastStatementId: string; mostStatementId: string } | null;
};

export interface ForcedChoiceScorer {
  method: "ipsative" | "thurstonian_irt";
  score(input: {
    blocks: readonly ForcedChoiceBlockResponse[];
    scales: readonly ScaleDefinition[];
  }): { scores: ForcedChoiceScoreValue[]; warnings: ScoringWarning[] };
}

export const ipsativeForcedChoiceScorer: ForcedChoiceScorer = {
  method: "ipsative",
  score: scoreIpsativeForcedChoice,
};

export const forcedChoiceScorerRegistry = new Map<
  ForcedChoiceScorer["method"],
  ForcedChoiceScorer
>([[ipsativeForcedChoiceScorer.method, ipsativeForcedChoiceScorer]]);

export function getForcedChoiceScorer(method: ForcedChoiceScorer["method"]) {
  const scorer = forcedChoiceScorerRegistry.get(method);
  if (!scorer) {
    throw new ScoringDomainError(
      "UNSUPPORTED_SCORING_METHOD",
      `Forced-choice method '${method}' is not implemented.`,
    );
  }
  return scorer;
}

function scoreIpsativeForcedChoice(input: {
  blocks: readonly ForcedChoiceBlockResponse[];
  scales: readonly ScaleDefinition[];
}) {
  const rawByScale = new Map<string, number>();
  const eligibleByScale = new Map<string, number>();
  const answeredByScale = new Map<string, number>();
  const centeringModes = new Set(input.blocks.map((block) => block.config.centering));
  if (centeringModes.size > 1) {
    throw new ScoringDomainError(
      "INVALID_SCORING_DEFINITION",
      "All forced-choice blocks in one score must use the same centering policy.",
    );
  }

  for (const block of input.blocks) {
    if (block.config.method !== "ipsative") {
      throw new ScoringDomainError(
        "UNSUPPORTED_SCORING_METHOD",
        `Ipsative scorer cannot process '${block.config.method}'.`,
      );
    }
    const blockScaleIds = new Set(block.config.statements.map((statement) => statement.scaleId));
    blockScaleIds.forEach((scaleId) => {
      eligibleByScale.set(scaleId, (eligibleByScale.get(scaleId) ?? 0) + 1);
    });
    if (!block.response) continue;

    const most = block.config.statements.find(
      (statement) => statement.statementId === block.response?.mostStatementId,
    );
    const least = block.config.statements.find(
      (statement) => statement.statementId === block.response?.leastStatementId,
    );
    if (!most || !least || most.statementId === least.statementId) {
      throw new ScoringDomainError(
        "INVALID_ANSWER_PAYLOAD",
        `Forced-choice response for '${block.itemId}' is incomplete or references an unknown statement.`,
      );
    }

    const contributions = new Map<string, number>();
    addContribution(
      contributions,
      most.scaleId,
      block.config.roleWeights.most * (most.keyedDirection ?? 1),
    );
    addContribution(
      contributions,
      least.scaleId,
      block.config.roleWeights.least * (least.keyedDirection ?? 1),
    );
    blockScaleIds.forEach((scaleId) => {
      rawByScale.set(scaleId, (rawByScale.get(scaleId) ?? 0) + (contributions.get(scaleId) ?? 0));
      answeredByScale.set(scaleId, (answeredByScale.get(scaleId) ?? 0) + 1);
    });
  }

  if (centeringModes.has("person_mean") && eligibleByScale.size > 0) {
    const mean =
      [...eligibleByScale.keys()].reduce(
        (sum, scaleId) => sum + (rawByScale.get(scaleId) ?? 0),
        0,
      ) / eligibleByScale.size;
    eligibleByScale.forEach((_eligible, scaleId) => {
      rawByScale.set(scaleId, (rawByScale.get(scaleId) ?? 0) - mean);
    });
  }

  const warnings: ScoringWarning[] = [];
  const scores = input.scales.map((scale): ForcedChoiceScoreValue => {
    const eligible = eligibleByScale.get(scale.id) ?? 0;
    const answered = answeredByScale.get(scale.id) ?? 0;
    const confidence = createCoverageConfidence(answered, eligible);
    const requiredCount = Math.max(
      scale.minAnsweredItems ?? 0,
      scale.minAnsweredRatio === null || scale.minAnsweredRatio === undefined
        ? eligible
        : Math.ceil(eligible * scale.minAnsweredRatio),
    );
    if (eligible === 0 || answered < requiredCount) {
      warnings.push({
        code: "INSUFFICIENT_DATA",
        message: `Forced-choice scale '${scale.code}' has insufficient completed blocks.`,
        scoreId: scale.id,
      });
      return {
        comparability: "within_person_only",
        confidence,
        id: scale.id,
        method: "ipsative",
        norm_score: null,
        normalized_score: null,
        raw_score: null,
        status: "insufficient_data",
      };
    }

    const rawScore = roundOutput(rawByScale.get(scale.id) ?? 0);
    const normalizedScore =
      rawScore >= scale.theoreticalMin && rawScore <= scale.theoreticalMax
        ? normalizeScore(rawScore, scale.theoreticalMin, scale.theoreticalMax)
        : null;
    return {
      comparability: "within_person_only",
      confidence,
      id: scale.id,
      method: "ipsative",
      norm_score: null,
      normalized_score: normalizedScore,
      raw_score: rawScore,
      status: "ok",
    };
  });

  return { scores, warnings };
}

function addContribution(values: Map<string, number>, scaleId: string, value: number) {
  values.set(scaleId, (values.get(scaleId) ?? 0) + value);
}
