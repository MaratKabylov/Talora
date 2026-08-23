import { COMPETENCIES, type CompetencyKey } from "../jobs/constants.ts";
import { createCoverageConfidence } from "./confidence.ts";
import {
  getForcedChoiceScorer,
  type ForcedChoiceBlockResponse,
} from "./models/forced-choice.ts";
import {
  scoreLegacySession,
  type LegacyAnswerRecord,
  type LegacyAnswerScore,
  type LegacyCompetencyTotal,
  type LegacyPackageTestRecord,
  type LegacyQuestionRecord,
  type LegacySessionRecord,
} from "./models/legacy-session.ts";
import { scoreScales, type ScaleItemResponse } from "./models/scale.ts";
import { scoreSjt, type SjtItemResponse } from "./models/sjt.ts";
import { normalizeScore, roundOutput } from "./normalization.ts";
import {
  ScoringDomainError,
  type ForcedChoiceScoreValue,
  type PrimaryScoringModel,
  type ScoreValue,
  type ScoringDefinitionV2,
  type ScoringItemDefinition,
  type ScoringWarning,
} from "./types.ts";

export type ModelScoreTotal = {
  maxScore: number;
  rawScore: number | null;
};

export type ModelScoringContext = {
  answerByQuestion: Map<string, LegacyAnswerRecord>;
  answers: LegacyAnswerRecord[];
  definition: ScoringDefinitionV2;
  items: ScoringItemDefinition[];
  packageTest: LegacyPackageTestRecord;
  questionById: Map<string, LegacyQuestionRecord>;
  questions: LegacyQuestionRecord[];
  session: LegacySessionRecord;
};

export type ModelScoringResult = {
  answerScores: Map<string, LegacyAnswerScore>;
  criterionCompetencies: Map<CompetencyKey, LegacyCompetencyTotal>;
  criterionScores: ScoreValue[];
  forcedChoiceScores: ForcedChoiceScoreValue[];
  hasForcedChoice: boolean;
  scaleScores: ScoreValue[];
  totals: Map<string, ModelScoreTotal>;
  warnings: ScoringWarning[];
};

export type ScoringModelAdapter = {
  model: PrimaryScoringModel;
  score(context: ModelScoringContext, result: ModelScoringResult): void;
};

const criterionAdapter: ScoringModelAdapter = {
  model: "criterion",
  score(context, result) {
    const items = itemsForModel(context.items, "criterion");
    const itemIds = new Set(items.map((item) => item.id));
    const legacy = scoreLegacySession(
      context.session,
      context.packageTest,
      items.flatMap((item) => {
        const question = context.questionById.get(item.id);
        return question ? [{ ...question, points: item.config.maxPoints }] : [];
      }),
      context.answers.filter((answer) => itemIds.has(answer.question_id)),
    );
    legacy.answerScores.forEach((score, answerId) => {
      result.answerScores.set(answerId, score);
    });
    result.criterionCompetencies = legacy.score.competencies;

    const scores = buildCriterionScores(items, context.answerByQuestion, result.answerScores);
    result.criterionScores.push(...scores);
    const total = scores.find((score) => score.id === "criterion_total");
    if (total) {
      result.totals.set("criterion_total", {
        maxScore: items.reduce((sum, item) => sum + item.config.maxPoints, 0),
        rawScore: total.raw_score,
      });
    }
  },
};

const sjtAdapter: ScoringModelAdapter = {
  model: "sjt",
  score(context, result) {
    const items = itemsForModel(context.items, "sjt");
    const responses: SjtItemResponse[] = items.map((item) => {
      const answer = context.answerByQuestion.get(item.id);
      const selectedOptionIds = item.questionType === "single_choice"
        ? answer?.selected_option_id
          ? [answer.selected_option_id]
          : null
        : Array.isArray(answer?.answer_json?.selectedOptionIds)
          ? answer.answer_json.selectedOptionIds.filter(
              (optionId): optionId is string => typeof optionId === "string",
            )
          : null;
      return {
        config: item.config,
        itemId: item.id,
        questionType: item.questionType,
        selectedOptionIds,
      };
    });
    const scaleIds = new Set(
      responses.flatMap((item) =>
        item.config.options.flatMap((option) =>
          option.dimensionEffects.map((effect) => effect.scaleId),
        ),
      ),
    );
    const scored = scoreSjt(
      context.definition.scales.filter((scale) => scaleIds.has(scale.id)),
      responses,
    );
    result.criterionScores.push(...scored.situationalScores);
    result.scaleScores.push(...scored.dimensionScores);
    result.warnings.push(...scored.warnings);
    for (const itemScore of scored.itemScores) {
      const answer = context.answerByQuestion.get(itemScore.itemId);
      if (!answer) continue;
      result.answerScores.set(answer.id, {
        isCorrect: null,
        pointsAwarded: itemScore.points,
        rawScore: itemScore.points,
      });
    }
    const total = scored.situationalScores.find((score) => score.id === "sjt_total");
    if (total) {
      result.totals.set("sjt_total", {
        maxScore: responses.reduce((sum, item) => sum + item.config.maxPoints, 0),
        rawScore: total.raw_score,
      });
    }
  },
};

const scaleAdapter: ScoringModelAdapter = {
  model: "scale",
  score(context, result) {
    const items: ScaleItemResponse[] = itemsForModel(context.items, "scale").map((item) => {
      const response = context.answerByQuestion.get(item.id)?.answer_json?.value;
      return {
        config: item.config,
        itemId: item.id,
        response: typeof response === "number" && Number.isFinite(response) ? response : null,
      };
    });
    const occupiedScaleIds = new Set(result.scaleScores.map((score) => score.id));
    const scored = scoreScales(
      context.definition.scales.filter((scale) => !occupiedScaleIds.has(scale.id)),
      items,
    );
    result.scaleScores.push(...scored.scores);
    result.warnings.push(...scored.warnings);
    for (const item of items) {
      const answer = context.answerByQuestion.get(item.itemId);
      if (!answer) continue;
      result.answerScores.set(answer.id, {
        isCorrect: null,
        pointsAwarded: item.response === null ? null : roundOutput(item.response),
        rawScore: item.response === null ? null : roundOutput(item.response),
      });
    }
  },
};

const forcedChoiceAdapter: ScoringModelAdapter = {
  model: "forced_choice",
  score(context, result) {
    const blocks: ForcedChoiceBlockResponse[] = itemsForModel(
      context.items,
      "forced_choice",
    ).map((item) => {
      const answer = context.answerByQuestion.get(item.id);
      const mostStatementId = answer?.answer_json?.mostOptionId;
      const leastStatementId = answer?.answer_json?.leastOptionId;
      return {
        config: item.config,
        itemId: item.id,
        response:
          typeof mostStatementId === "string" && typeof leastStatementId === "string"
            ? { leastStatementId, mostStatementId }
            : null,
      };
    });
    result.hasForcedChoice = blocks.length > 0;
    if (blocks.length === 0) return;

    const methods = new Set(blocks.map((block) => block.config.method));
    if (methods.size !== 1) {
      throw new ScoringDomainError(
        "INVALID_SCORING_DEFINITION",
        "All forced-choice blocks in one test version must use the same method.",
      );
    }
    const scaleIds = new Set(
      blocks.flatMap((block) =>
        block.config.statements.map((statement) => statement.scaleId),
      ),
    );
    const scored = getForcedChoiceScorer(blocks[0].config.method).score({
      blocks,
      scales: context.definition.scales.filter((scale) => scaleIds.has(scale.id)),
    });
    result.forcedChoiceScores.push(...scored.scores);
    result.warnings.push(...scored.warnings);
    for (const block of blocks) {
      const answer = context.answerByQuestion.get(block.itemId);
      if (!answer) continue;
      result.answerScores.set(answer.id, {
        isCorrect: null,
        pointsAwarded: null,
        rawScore: null,
      });
    }
  },
};

/**
 * Execution order is explicit because an adapter may claim a scale before a
 * generic scale adapter runs. Registering a new primary model only changes this
 * module; the session orchestrator consumes the common result contract.
 */
export const scoringModelRegistry: readonly ScoringModelAdapter[] = [
  criterionAdapter,
  sjtAdapter,
  scaleAdapter,
  forcedChoiceAdapter,
];

export function scoreRegisteredModels(
  context: ModelScoringContext,
): ModelScoringResult {
  const result: ModelScoringResult = {
    answerScores: new Map(),
    criterionCompetencies: new Map(),
    criterionScores: [],
    forcedChoiceScores: [],
    hasForcedChoice: false,
    scaleScores: [],
    totals: new Map(),
    warnings: [],
  };
  for (const adapter of scoringModelRegistry) {
    adapter.score(context, result);
  }
  return result;
}

export function itemsForModel<M extends ScoringItemDefinition["scoringModel"]>(
  items: readonly ScoringItemDefinition[],
  model: M,
) {
  return items.filter((item) => item.scoringModel === model) as Array<
    Extract<ScoringItemDefinition, { scoringModel: M }>
  >;
}

function buildCriterionScores(
  items: readonly Extract<ScoringItemDefinition, { scoringModel: "criterion" }>[],
  answerByQuestion: Map<string, LegacyAnswerRecord>,
  answerScores: Map<string, LegacyAnswerScore>,
): ScoreValue[] {
  const scores = items.map((item): ScoreValue => {
    const answer = answerByQuestion.get(item.id);
    const awarded = answer ? answerScores.get(answer.id)?.pointsAwarded : null;
    const raw = Math.min(
      Math.max(awarded ?? item.config.minPoints ?? 0, item.config.minPoints ?? 0),
      item.config.maxPoints,
    );
    return {
      confidence: createCoverageConfidence(answer ? 1 : 0, 1),
      id: item.id,
      norm_score: null,
      normalized_score: normalizeScore(
        raw,
        item.config.minPoints ?? 0,
        item.config.maxPoints,
      ),
      raw_score: roundOutput(raw),
      status: "ok",
    };
  });
  if (items.length === 0) return scores;

  const minimum = items.reduce((sum, item) => sum + (item.config.minPoints ?? 0), 0);
  const maximum = items.reduce((sum, item) => sum + item.config.maxPoints, 0);
  const raw = scores.reduce((sum, score) => sum + (score.raw_score ?? 0), 0);
  scores.push({
    confidence: createCoverageConfidence(
      items.filter((item) => answerByQuestion.has(item.id)).length,
      items.length,
    ),
    id: "criterion_total",
    norm_score: null,
    normalized_score: normalizeScore(raw, minimum, maximum),
    raw_score: roundOutput(raw),
    status: "ok",
  });
  return scores;
}

export function buildCompatibilityCompetencies(
  criterionCompetencies: Map<CompetencyKey, LegacyCompetencyTotal>,
  definition: ScoringDefinitionV2,
  scaleScores: readonly ScoreValue[],
  forcedChoiceScores: readonly ForcedChoiceScoreValue[],
) {
  const competencyKeys = new Set<string>(
    COMPETENCIES.map((competency) => competency.key),
  );
  const competencies = new Map(criterionCompetencies);
  const scaleById = new Map(definition.scales.map((scale) => [scale.id, scale]));
  for (const score of [...scaleScores, ...forcedChoiceScores]) {
    if (
      !competencyKeys.has(score.id) ||
      score.status !== "ok" ||
      score.raw_score === null
    ) continue;
    const scale = scaleById.get(score.id);
    if (!scale) continue;
    competencies.set(score.id as CompetencyKey, {
      maxScore: scale.theoreticalMax,
      minScore: scale.theoreticalMin,
      score: score.raw_score,
    });
  }
  return competencies;
}
