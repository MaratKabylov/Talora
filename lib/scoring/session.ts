import { validateScoringDefinitionV2 } from "./definition.ts";
import { scoreRegisteredDomain } from "./domain-registry.ts";
import { buildScoringResultV2 } from "./engine.ts";
import {
  scoreLegacySession,
  type LegacyAnswerRecord,
  type LegacyAnswerScore,
  type LegacyPackageTestRecord,
  type LegacyQuestionRecord,
  type LegacySessionRecord,
  type LegacySessionScore,
  type LegacyVersionRecord,
} from "./models/legacy-session.ts";
import {
  buildCompatibilityCompetencies,
  scoreRegisteredModels,
  type ModelScoringContext,
} from "./model-registry.ts";
import { roundOutput } from "./normalization.ts";
import {
  DERIVED_CRITERION_SCORE_IDS,
  ScoringDomainError,
  type ScoringDefinitionV2,
  type ScoringResultV2,
  type ScoringWarning,
} from "./types.ts";

export type SessionCalculation = {
  answerScores: Map<string, LegacyAnswerScore>;
  score: LegacySessionScore & { scoringResult: ScoringResultV2 | null };
};

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
  if (
    items.some((item) =>
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

  const context: ModelScoringContext = {
    answerByQuestion,
    answers,
    definition,
    items,
    packageTest,
    questionById,
    questions,
    session,
  };
  const modelResult = scoreRegisteredModels(context);
  const domainResult = scoreRegisteredDomain(context, modelResult);
  modelResult.criterionScores.push(...domainResult.criterionScores);

  const openTextItems = items.filter((item) => item.scoringModel === null);
  for (const item of openTextItems) {
    const answer = answerByQuestion.get(item.id);
    if (!answer) continue;
    modelResult.answerScores.set(answer.id, {
      isCorrect: null,
      pointsAwarded: null,
      rawScore: null,
    });
  }
  const warnings: ScoringWarning[] = [
    ...domainResult.warnings,
    ...modelResult.warnings,
  ];
  const requiresReview = openTextItems.length > 0;
  if (requiresReview) {
    warnings.push({
      code: "REQUIRES_REVIEW",
      message: "The assessment contains open-text responses that require manual review.",
    });
  }

  const scoringResult = buildScoringResultV2({
    attentionMetrics: domainResult.attentionMetrics,
    criterionScores: modelResult.criterionScores,
    definition,
    definitionVersionId: session.test_version_id,
    forcedChoiceScores: modelResult.forcedChoiceScores,
    learningMetrics: domainResult.learningMetrics,
    scaleScores: modelResult.scaleScores,
    status: requiresReview
      ? "requires_review"
      : domainResult.warnings.length
        ? "partial"
        : undefined,
    warnings,
  });
  const competencies = buildCompatibilityCompetencies(
    modelResult.criterionCompetencies,
    definition,
    modelResult.scaleScores,
    modelResult.forcedChoiceScores,
  );
  const mappedTotal = definition.overallScore?.sourceType === "criterion"
    ? modelResult.totals.get(definition.overallScore.sourceId)
    : undefined;
  const rawScore = mappedTotal?.rawScore ?? scoringResult.overallScore ?? 0;
  const maxScore = mappedTotal?.maxScore ?? (scoringResult.overallScore === null ? 0 : 100);

  return {
    answerScores: modelResult.answerScores,
    score: {
      competencies,
      hasForcedChoice: modelResult.hasForcedChoice,
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

function related<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
