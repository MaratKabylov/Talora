import { validateScoringDefinitionV2 } from "./definition.ts";
import { calculateCompositeScores } from "./models/composite.ts";
import { interpretScore } from "./thresholds.ts";
import {
  SCORING_ENGINE_VERSION,
  SCORING_SCHEMA_VERSION,
  ScoringDomainError,
  type AttentionMetrics,
  type ForcedChoiceScoreValue,
  type LearningMetrics,
  type ScoreValue,
  type ScoringDefinitionV2,
  type ScoringResultV2,
  type ScoringWarning,
} from "./types.ts";

export type BuildScoringResultInput = {
  attentionMetrics?: AttentionMetrics | null;
  criterionScores: readonly ScoreValue[];
  definition: ScoringDefinitionV2;
  definitionVersionId: string;
  forcedChoiceScores?: readonly ForcedChoiceScoreValue[];
  learningMetrics?: LearningMetrics | null;
  scaleScores: readonly ScoreValue[];
  scoredAt?: string;
  status?: ScoringResultV2["status"];
  warnings?: readonly ScoringWarning[];
};

/**
 * Pure v2 result assembly. Primary item scoring remains behind model-specific
 * scorers; derived composites and overall mapping are centralized here.
 */
export function buildScoringResultV2(input: BuildScoringResultInput): ScoringResultV2 {
  const validation = validateScoringDefinitionV2({
    criterionScoreIds: input.criterionScores.map((score) => score.id),
    definition: input.definition,
    forPublication: false,
  });
  if (!validation.ok) {
    const first = validation.issues[0];
    throw new ScoringDomainError(first.code, first.message, first.path);
  }

  const compositeScores = calculateCompositeScores(input.definition.composites, {
    criterion: input.criterionScores,
    scale: input.scaleScores,
  });
  const overallScore = resolveOverallScore(
    input.definition,
    input.criterionScores,
    compositeScores,
  );
  const allScores = [
    ...input.criterionScores,
    ...input.scaleScores,
    ...(input.forcedChoiceScores ?? []),
    ...compositeScores,
  ];
  const inferredStatus = allScores.some((score) => score.status === "insufficient_data")
    ? allScores.some((score) => score.status === "ok")
      ? "partial"
      : "insufficient_data"
    : "complete";

  return {
    assessmentDomain: input.definition.assessmentDomain,
    compositeScores,
    criterionScores: [...input.criterionScores],
    definitionVersionId: input.definitionVersionId,
    engineVersion: SCORING_ENGINE_VERSION,
    forcedChoiceScores: [...(input.forcedChoiceScores ?? [])],
    interpretation: interpretScore(overallScore, input.definition.thresholds),
    metrics: {
      attention: input.attentionMetrics ?? null,
      learning: input.learningMetrics ?? null,
    },
    overallScore,
    resultShape: input.definition.resultShape,
    scaleScores: [...input.scaleScores],
    schemaVersion: SCORING_SCHEMA_VERSION,
    scoredAt: input.scoredAt ?? new Date().toISOString(),
    status: input.status ?? inferredStatus,
    warnings: [...(input.warnings ?? [])],
  };
}

export function resolveOverallScore(
  definition: ScoringDefinitionV2,
  criterionScores: readonly ScoreValue[],
  compositeScores: readonly ScoreValue[],
) {
  const mapping = definition.overallScore;
  if (!mapping) return null;
  const source =
    mapping.sourceType === "criterion"
      ? criterionScores.find((score) => score.id === mapping.sourceId)
      : compositeScores.find((score) => score.id === mapping.sourceId);
  if (!source || source.status !== "ok") return null;

  return source.normalized_score ?? source.raw_score;
}
