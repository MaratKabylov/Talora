import { scoreAttention, type AttentionItemInput } from "./models/attention.ts";
import { scoreLearning, type LearningItemInput } from "./models/learning.ts";
import {
  itemsForModel,
  type ModelScoringContext,
  type ModelScoringResult,
} from "./model-registry.ts";
import {
  ScoringDomainError,
  type AssessmentDomain,
  type AttentionMetrics,
  type LearningMetrics,
  type ScoreValue,
  type ScoringWarning,
} from "./types.ts";

export type DomainScoringResult = {
  attentionMetrics: AttentionMetrics | null;
  criterionScores: ScoreValue[];
  learningMetrics: LearningMetrics | null;
  warnings: ScoringWarning[];
};

export type DomainScoringAdapter = {
  domain: AssessmentDomain;
  score(context: ModelScoringContext, modelResult: ModelScoringResult): DomainScoringResult;
};

const learningAdapter: DomainScoringAdapter = {
  domain: "learning",
  score(context, modelResult) {
    const scored = scoreLearning(
      context.definition.learningScoring!,
      buildLearningItems(context, modelResult),
    );
    return {
      attentionMetrics: null,
      criterionScores: scored.scores,
      learningMetrics: scored.metrics,
      warnings: scored.warnings,
    };
  },
};

const attentionAdapter: DomainScoringAdapter = {
  domain: "attention",
  score(context, modelResult) {
    const scored = scoreAttention(buildAttentionItems(context, modelResult));
    return {
      attentionMetrics: scored.metrics,
      criterionScores: scored.scores,
      learningMetrics: null,
      warnings: scored.warnings,
    };
  },
};

export const domainScoringRegistry = new Map<AssessmentDomain, DomainScoringAdapter>([
  [learningAdapter.domain, learningAdapter],
  [attentionAdapter.domain, attentionAdapter],
]);

export function scoreRegisteredDomain(
  context: ModelScoringContext,
  modelResult: ModelScoringResult,
): DomainScoringResult {
  return domainScoringRegistry
    .get(context.definition.assessmentDomain)
    ?.score(context, modelResult) ?? {
    attentionMetrics: null,
    criterionScores: [],
    learningMetrics: null,
    warnings: [],
  };
}

function buildAttentionItems(
  context: ModelScoringContext,
  modelResult: ModelScoringResult,
): AttentionItemInput[] {
  const items = itemsForModel(context.items, "criterion");
  if (
    items.some((item) =>
      typeof context.questionById.get(item.id)?.settings_json?.remediationQuestionId === "string",
    )
  ) {
    throw new ScoringDomainError(
      "INVALID_SCORING_DEFINITION",
      "Attention assessments cannot contain remediation branches.",
      "items",
    );
  }
  return items.map((item) => {
    const answer = context.answerByQuestion.get(item.id);
    const scoredAnswer = answer ? modelResult.answerScores.get(answer.id) : null;
    return {
      answered: Boolean(answer && answer.answer_json?.skipped !== true),
      isCorrect: scoredAnswer?.isCorrect ?? null,
      itemId: item.id,
      targetPresent: item.config.signalClassification?.targetPresent,
      timeSpentSeconds: answer?.time_spent_seconds ?? null,
    };
  });
}

function buildLearningItems(
  context: ModelScoringContext,
  modelResult: ModelScoringResult,
): LearningItemInput[] {
  const items = itemsForModel(context.items, "criterion");
  const itemById = new Map(items.map((item) => [item.id, item]));
  const recoveryIds = new Set<string>();
  for (const item of items) {
    const recoveryId = context.questionById.get(item.id)?.settings_json?.remediationQuestionId;
    if (typeof recoveryId === "string") recoveryIds.add(recoveryId);
  }

  return items
    .filter((item) => !recoveryIds.has(item.id))
    .map((item) => {
      const question = context.questionById.get(item.id);
      const recoveryQuestionId = typeof question?.settings_json?.remediationQuestionId === "string"
        ? question.settings_json.remediationQuestionId
        : null;
      const recoveryItem = recoveryQuestionId ? itemById.get(recoveryQuestionId) : null;
      if (recoveryQuestionId && !recoveryItem) {
        throw new ScoringDomainError(
          "INVALID_SCORING_DEFINITION",
          `Learning recovery question '${recoveryQuestionId}' must use criterion scoring.`,
          `items.${item.id}`,
        );
      }
      const initialAnswer = context.answerByQuestion.get(item.id);
      const initialScore = initialAnswer
        ? modelResult.answerScores.get(initialAnswer.id)
        : null;
      const recoveryAnswer = recoveryQuestionId
        ? context.answerByQuestion.get(recoveryQuestionId)
        : null;
      const recoveryScore = recoveryAnswer
        ? modelResult.answerScores.get(recoveryAnswer.id)
        : null;
      return {
        initial: {
          answered: Boolean(initialAnswer),
          isCorrect: initialScore?.isCorrect ?? null,
          maxPoints: item.config.maxPoints,
          pointsAwarded: initialScore?.pointsAwarded ?? null,
        },
        initialQuestionId: item.id,
        recovery: recoveryItem
          ? {
              answered: Boolean(recoveryAnswer),
              isCorrect: recoveryScore?.isCorrect ?? null,
              maxPoints: recoveryItem.config.maxPoints,
              pointsAwarded: recoveryScore?.pointsAwarded ?? null,
            }
          : null,
        recoveryQuestionId,
      };
    });
}
