import { COMPETENCIES, type CompetencyKey } from "../jobs/constants.ts";
import { createCoverageConfidence } from "./confidence.ts";
import { validateScoringDefinitionV2 } from "./definition.ts";
import { buildScoringResultV2 } from "./engine.ts";
import {
  scoreLegacySession,
  type LegacyAnswerRecord,
  type LegacyAnswerScore,
  type LegacyCompetencyTotal,
  type LegacyPackageTestRecord,
  type LegacyQuestionRecord,
  type LegacySessionRecord,
  type LegacySessionScore,
  type LegacyVersionRecord,
} from "./models/legacy-session.ts";
import {
  getForcedChoiceScorer,
  type ForcedChoiceBlockResponse,
} from "./models/forced-choice.ts";
import { scoreScales, type ScaleItemResponse } from "./models/scale.ts";
import { normalizeScore, roundOutput } from "./normalization.ts";
import { scoreLearning, type LearningItemInput } from "./models/learning.ts";
import {
  DERIVED_CRITERION_SCORE_IDS,
  ScoringDomainError,
  type ForcedChoiceScoreValue,
  type ScoreValue,
  type ScoringDefinitionV2,
  type ScoringResultV2,
  type ScoringWarning,
} from "./types.ts";

export type SessionCalculation = {
  answerScores: Map<string, LegacyAnswerScore>;
  score: LegacySessionScore & { scoringResult: ScoringResultV2 | null };
};

const COMPETENCY_KEYS = new Set<string>(
  COMPETENCIES.map((competency) => competency.key),
);

/** Selects v2 only for an explicit schema marker. Every other version is legacy. */
export function scoreSession(
  session: LegacySessionRecord,
  packageTest: LegacyPackageTestRecord,
  questions: LegacyQuestionRecord[],
  answers: LegacyAnswerRecord[],
): SessionCalculation {
  const version = related(session.test_versions);
  if (version?.scoring_schema_version !== "2.0") {
    const legacy = scoreLegacySession(session, packageTest, questions, answers);
    return {
      answerScores: legacy.answerScores,
      score: { ...legacy.score, scoringResult: null },
    };
  }

  return scoreV2Session(session, packageTest, questions, answers);
}

function scoreV2Session(
  session: LegacySessionRecord,
  packageTest: LegacyPackageTestRecord,
  questions: LegacyQuestionRecord[],
  answers: LegacyAnswerRecord[],
): SessionCalculation {
  const version = related(session.test_versions);
  if (!version) {
    throw new ScoringDomainError(
      "INVALID_SCORING_DEFINITION",
      "A v2 session must reference a test version.",
    );
  }

  const definition = hydrateDefinition(version);
  const rawItems = questions.map((question) => ({
    config: question.scoring_model === null || question.scoring_model === undefined
      ? null
      : question.scoring_config_json,
    id: question.id,
    questionType: question.question_type,
    scoringModel: question.scoring_model ?? null,
  }));
  const validation = validateScoringDefinitionV2({
    criterionScoreIds: DERIVED_CRITERION_SCORE_IDS,
    definition,
    items: rawItems,
  });
  if (!validation.ok) {
    const first = validation.issues[0];
    throw new ScoringDomainError(first.code, first.message, first.path);
  }

  const items = validation.items;
  const answerByQuestion = new Map(answers.map((answer) => [answer.question_id, answer]));
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const criterionItems = items.filter((item) => item.scoringModel === "criterion");
  if (
    criterionItems.some((item) =>
      DERIVED_CRITERION_SCORE_IDS.includes(
        item.id as (typeof DERIVED_CRITERION_SCORE_IDS)[number],
      ),
    )
  ) {
    throw new ScoringDomainError(
      "INVALID_SCORING_DEFINITION",
      "Derived criterion score IDs are reserved and cannot be used as question IDs.",
    );
  }

  const legacyCriterion = scoreLegacySession(
    session,
    packageTest,
    criterionItems.flatMap((item) => {
      const question = questionById.get(item.id);
      return question ? [{ ...question, points: item.config.maxPoints }] : [];
    }),
    answers.filter((answer) => criterionItems.some((item) => item.id === answer.question_id)),
  );
  const answerScores = new Map(legacyCriterion.answerScores);
  const criterionScores = buildCriterionScores(
    criterionItems,
    answerByQuestion,
    answerScores,
  );
  const learningResult = definition.assessmentDomain === "learning"
    ? scoreLearning(
        definition.learningScoring!,
        buildLearningItems(
          criterionItems,
          questionById,
          answerByQuestion,
          answerScores,
        ),
      )
    : null;
  if (learningResult) {
    criterionScores.push(...learningResult.scores);
  }

  const scaleItems: ScaleItemResponse[] = items.flatMap((item) => {
    if (item.scoringModel !== "scale") return [];
    const response = answerByQuestion.get(item.id)?.answer_json?.value;
    return [{
      config: item.config,
      itemId: item.id,
      response: typeof response === "number" && Number.isFinite(response) ? response : null,
    }];
  });
  const scaleResult = scoreScales(definition.scales, scaleItems);

  const forcedChoiceBlocks: ForcedChoiceBlockResponse[] = items.flatMap((item) => {
    if (item.scoringModel !== "forced_choice") return [];
    const answer = answerByQuestion.get(item.id);
    const mostStatementId = answer?.answer_json?.mostOptionId;
    const leastStatementId = answer?.answer_json?.leastOptionId;
    return [{
      config: item.config,
      itemId: item.id,
      response:
        typeof mostStatementId === "string" && typeof leastStatementId === "string"
          ? { leastStatementId, mostStatementId }
          : null,
    }];
  });
  const forcedChoiceResult = scoreForcedChoice(
    definition,
    forcedChoiceBlocks,
  );

  for (const item of items) {
    const answer = answerByQuestion.get(item.id);
    if (!answer || item.scoringModel === "criterion") continue;
    if (item.scoringModel === "scale") {
      const value = answer.answer_json?.value;
      const numeric = typeof value === "number" && Number.isFinite(value) ? value : null;
      answerScores.set(answer.id, {
        isCorrect: null,
        pointsAwarded: numeric === null ? null : roundOutput(numeric),
        rawScore: numeric === null ? null : roundOutput(numeric),
      });
    } else {
      answerScores.set(answer.id, {
        isCorrect: null,
        pointsAwarded: null,
        rawScore: null,
      });
    }
  }

  const openTextItems = items.filter((item) => item.scoringModel === null);
  const warnings: ScoringWarning[] = [
    ...(learningResult?.warnings ?? []),
    ...scaleResult.warnings,
    ...forcedChoiceResult.warnings,
  ];
  const requiresReview = openTextItems.length > 0;
  if (requiresReview) {
    warnings.push({
      code: "REQUIRES_REVIEW",
      message: "The assessment contains open-text responses that require manual review.",
    });
  }

  const scoringResult = buildScoringResultV2({
    criterionScores,
    definition,
    definitionVersionId: session.test_version_id,
    forcedChoiceScores: forcedChoiceResult.scores,
    learningMetrics: learningResult?.metrics,
    scaleScores: scaleResult.scores,
    status: requiresReview
      ? "requires_review"
      : learningResult?.warnings.length
        ? "partial"
        : undefined,
    warnings,
  });
  const competencies = buildCompatibilityCompetencies(
    legacyCriterion.score.competencies,
    definition,
    scaleResult.scores,
    forcedChoiceResult.scores,
  );
  const criterionTotal = definition.assessmentDomain === "learning"
    ? null
    : criterionScores.find((score) => score.id === "criterion_total");
  const criterionMax = criterionItems.reduce((sum, item) => sum + item.config.maxPoints, 0);
  const rawScore = criterionTotal?.raw_score ?? scoringResult.overallScore ?? 0;
  const maxScore = criterionTotal ? criterionMax : scoringResult.overallScore === null ? 0 : 100;

  return {
    answerScores,
    score: {
      competencies,
      hasForcedChoice: forcedChoiceBlocks.length > 0,
      maxScore: roundOutput(maxScore),
      packageTest,
      percentage: scoringResult.overallScore,
      rawScore: roundOutput(rawScore),
      requiresReview,
      scoringResult,
      scoringType:
        definition.resultShape === "profile"
          ? "competency_profile"
          : definition.resultShape === "hybrid"
            ? "mixed"
            : "points",
      session,
    },
  };
}

function buildLearningItems(
  items: Extract<ReturnType<typeof validateScoringDefinitionV2>, { ok: true }>["items"],
  questionById: Map<string, LegacyQuestionRecord>,
  answerByQuestion: Map<string, LegacyAnswerRecord>,
  answerScores: Map<string, LegacyAnswerScore>,
): LearningItemInput[] {
  const criterionItems = items.filter((item) => item.scoringModel === "criterion");
  const criterionById = new Map(criterionItems.map((item) => [item.id, item]));
  const recoveryIds = new Set<string>();
  for (const item of criterionItems) {
    const recoveryId = questionById.get(item.id)?.settings_json?.remediationQuestionId;
    if (typeof recoveryId === "string") recoveryIds.add(recoveryId);
  }

  return criterionItems
    .filter((item) => !recoveryIds.has(item.id))
    .map((item) => {
      const question = questionById.get(item.id);
      const recoveryQuestionId = typeof question?.settings_json?.remediationQuestionId === "string"
        ? question.settings_json.remediationQuestionId
        : null;
      const recoveryItem = recoveryQuestionId
        ? criterionById.get(recoveryQuestionId)
        : null;
      if (recoveryQuestionId && !recoveryItem) {
        throw new ScoringDomainError(
          "INVALID_SCORING_DEFINITION",
          `Learning recovery question '${recoveryQuestionId}' must use criterion scoring.`,
          `items.${item.id}`,
        );
      }
      const initialAnswer = answerByQuestion.get(item.id);
      const initialScore = initialAnswer ? answerScores.get(initialAnswer.id) : null;
      const recoveryAnswer = recoveryQuestionId
        ? answerByQuestion.get(recoveryQuestionId)
        : null;
      const recoveryScore = recoveryAnswer ? answerScores.get(recoveryAnswer.id) : null;
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

function hydrateDefinition(
  version: LegacyVersionRecord,
): ScoringDefinitionV2 {
  const config = isRecord(version.scoring_config_json) ? version.scoring_config_json : {};
  return {
    ...config,
    assessmentDomain: version.assessment_domain,
    resultShape: version.result_shape,
    schemaVersion: version.scoring_schema_version,
  } as ScoringDefinitionV2;
}

function buildCriterionScores(
  items: Extract<ReturnType<typeof validateScoringDefinitionV2>, { ok: true }>["items"],
  answerByQuestion: Map<string, LegacyAnswerRecord>,
  answerScores: Map<string, LegacyAnswerScore>,
): ScoreValue[] {
  const criterionItems = items.filter((item) => item.scoringModel === "criterion");
  const scores = criterionItems.map((item): ScoreValue => {
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
  if (criterionItems.length === 0) return scores;

  const minimum = criterionItems.reduce(
    (sum, item) => sum + (item.config.minPoints ?? 0),
    0,
  );
  const maximum = criterionItems.reduce((sum, item) => sum + item.config.maxPoints, 0);
  const raw = scores.reduce((sum, score) => sum + (score.raw_score ?? 0), 0);
  scores.push({
    confidence: createCoverageConfidence(
      criterionItems.filter((item) => answerByQuestion.has(item.id)).length,
      criterionItems.length,
    ),
    id: "criterion_total",
    norm_score: null,
    normalized_score: normalizeScore(raw, minimum, maximum),
    raw_score: roundOutput(raw),
    status: "ok",
  });
  return scores;
}

function scoreForcedChoice(
  definition: ScoringDefinitionV2,
  blocks: ForcedChoiceBlockResponse[],
): { scores: ForcedChoiceScoreValue[]; warnings: ScoringWarning[] } {
  if (blocks.length === 0) return { scores: [], warnings: [] };
  const methods = new Set(blocks.map((block) => block.config.method));
  if (methods.size !== 1) {
    throw new ScoringDomainError(
      "INVALID_SCORING_DEFINITION",
      "All forced-choice blocks in one test version must use the same method.",
    );
  }
  const scaleIds = new Set(
    blocks.flatMap((block) => block.config.statements.map((statement) => statement.scaleId)),
  );
  return getForcedChoiceScorer(blocks[0].config.method).score({
    blocks,
    scales: definition.scales.filter((scale) => scaleIds.has(scale.id)),
  });
}

function buildCompatibilityCompetencies(
  criterionCompetencies: Map<CompetencyKey, LegacyCompetencyTotal>,
  definition: ScoringDefinitionV2,
  scaleScores: readonly ScoreValue[],
  forcedChoiceScores: readonly ForcedChoiceScoreValue[],
) {
  const competencies = new Map(criterionCompetencies);
  const scaleById = new Map(definition.scales.map((scale) => [scale.id, scale]));
  for (const score of [...scaleScores, ...forcedChoiceScores]) {
    if (
      !COMPETENCY_KEYS.has(score.id) ||
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

function related<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
