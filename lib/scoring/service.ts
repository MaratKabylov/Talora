import "server-only";

import {
  COMPETENCIES,
  isMotivationCompetencyKey,
  type CompetencyKey,
} from "@/lib/jobs/constants";
import { calculateFitScore } from "@/lib/scoring/fit-score";
import {
  calculateProfileFit,
  normalizeProfileTargets,
  type ProfileDimensionScore,
} from "@/lib/scoring/profile-fit";
import {
  defaultInterpretationDirection,
  interpretReportScore,
  parseInterpretationPolicy,
  type InterpretationDirection,
  type InterpretationPolicy,
} from "@/lib/scoring/interpretation-policy";
import {
  type LegacyAnswerRecord as AnswerRecord,
  type LegacyCompetencyTotal as CompetencyTotal,
  type LegacyPackageTestRecord as PackageTestRecord,
  type LegacyQuestionRecord as QuestionRecord,
  type LegacyScoringType as ScoringType,
  type LegacySectionRecord as SectionRecord,
  type LegacySessionRecord as SessionRecord,
  type LegacySessionScore as SessionScore,
} from "@/lib/scoring/models/legacy-session";
import {
  calculateAssessmentComposite,
  normalizeAssessmentCompositeConfig,
} from "@/lib/scoring/models/assessment-composite";
import { scoreSession } from "@/lib/scoring/session";
import {
  capHighRiskRecommendation,
  parseRecommendationPolicy,
  recommendWithPolicy,
} from "@/lib/scoring/recommendation-policy";
import { interpretScore as interpretTestScore } from "@/lib/scoring/thresholds";
import {
  SCORING_ENGINE_VERSION,
  SCORING_SCHEMA_VERSION,
  type ScoringResultV2,
} from "@/lib/scoring/types";
import {
  calculateContributingOverall,
  packageTestContributesToOverall,
} from "@/lib/packages/overall-contribution";
import { createAdminClient } from "@/lib/supabase/admin";

type Relation<T> = T | T[] | null;

type JobRecord = {
  assessment_package_id: string | null;
  behavior_target_profile_json: unknown;
  composite_scoring_config_json: unknown;
  id: string;
  interpretation_policy_json: unknown;
  motivation_target_profile_json: unknown;
  passing_score: number | null;
  recommendation_policy_json: unknown;
};

type ApplicationRecord = {
  candidate_id: string;
  id: string;
  job_id: string;
  jobs: Relation<JobRecord>;
  scoring_revision: number;
};

type EmployeeAssessmentScoringRecord = {
  assessment_package_id: string;
  id: string;
  interpretation_policy_json: unknown;
  passing_score: number | null;
  recommendation_policy_json: unknown;
};

type EmployeeParticipantScoringRecord = {
  employee_assessment_id: string;
  employee_assessments: Relation<EmployeeAssessmentScoringRecord>;
  employee_id: string;
  id: string;
  scoring_revision: number;
};

type EmployeeSessionScoringRecord = SessionRecord & {
  package_contributes_to_overall: boolean | null;
  package_is_required: boolean | null;
  package_passing_score: number | null;
  package_weight: number | null;
};

type WeightRecord = {
  competency_key: CompetencyKey;
  is_required: boolean;
  minimum_score: number | null;
  weight: number;
};

const COMPETENCY_LABELS = new Map(
  COMPETENCIES.map((competency) => [competency.key, competency.label]),
);

function related<T>(value: Relation<T>) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function competencyPercentage(total: CompetencyTotal) {
  const range = total.maxScore - total.minScore;
  return range > 0
    ? round(Math.min(Math.max(((total.score - total.minScore) / range) * 100, 0), 100))
    : null;
}

function addCompetencyRange(
  competencies: Map<CompetencyKey, CompetencyTotal>,
  key: CompetencyKey,
  score: number,
  minScore: number,
  maxScore: number,
) {
  if (maxScore <= minScore) return;
  const existing = competencies.get(key) ?? { maxScore: 0, minScore: 0, score: 0 };
  existing.score += Math.min(Math.max(score, minScore), maxScore);
  existing.minScore += minScore;
  existing.maxScore += maxScore;
  competencies.set(key, existing);
}

function getResultLevel(
  value: number | null,
  requiresReview: boolean,
  scoringType: ScoringType,
  configuredLevel?: string | null,
) {
  if (requiresReview || scoringType === "manual") {
    return "requires_review";
  }

  if (scoringType === "competency_profile") {
    return "profile";
  }

  if (value === null) {
    return "not_scored";
  }

  if (configuredLevel) {
    return configuredLevel;
  }

  return interpretTestScore(value)?.code ?? "not_scored";
}

function getV2MetricsSummary(result: ScoringResultV2 | null) {
  if (result?.assessmentDomain === "sjt") {
    const dimensions = result.scaleScores
      .filter((score) => score.status === "ok" && score.normalized_score !== null)
      .map((score) => `${score.id}: ${score.normalized_score}%`)
      .join(", ");
    return `Situational score: ${result.overallScore === null ? "нет данных" : `${result.overallScore}%`}.${dimensions ? ` Dimensions: ${dimensions}.` : ""}`;
  }
  const attention = result?.metrics.attention;
  if (attention) {
    const accuracy = attention.accuracy === null
      ? "нет данных"
      : `${attention.accuracy}%`;
    const time = attention.median_response_time_ms === null
      ? "нет данных"
      : `${attention.median_response_time_ms} мс`;
    return `Точность: ${accuracy}. Ошибки: ${attention.incorrect_count}. Пропуски: ${attention.omitted_count}. Медианное время ответа: ${time}.`;
  }
  const learning = result?.metrics.learning;
  if (learning) {
    const initial = learning.initial_score === null ? "нет данных" : `${learning.initial_score}%`;
    const recovery = learning.recovery_rate === null ? "не применимо" : `${learning.recovery_rate}%`;
    const final = learning.final_score === null ? "нет данных" : `${learning.final_score}%`;
    return `Первичный результат: ${initial}. Recovery: ${recovery}. Learning gain: ${learning.learning_gain ?? "нет данных"}. Итог: ${final}.`;
  }
  return null;
}

function combineCompetencies(sessionScores: SessionScore[]) {
  const totals = new Map<CompetencyKey, CompetencyTotal>();

  for (const sessionScore of sessionScores) {
    for (const [key, score] of sessionScore.competencies) {
      addCompetencyRange(totals, key, score.score, score.minScore, score.maxScore);
    }
  }

  return totals;
}

function collectCompetencyDirections(
  sessionScores: Array<SessionScore & { scoringResult?: ScoringResultV2 | null }>,
) {
  const directions = new Map<CompetencyKey, InterpretationDirection>();
  for (const sessionScore of sessionScores) {
    for (const key of sessionScore.competencies.keys()) {
      const direction = defaultInterpretationDirection({
        assessmentDomain: sessionScore.scoringResult?.assessmentDomain,
        competencyKey: key,
      });
      const existing = directions.get(key);
      if (!existing || direction === "neutral") directions.set(key, direction);
    }
  }
  return directions;
}

function collectProfileDimensions(
  sessionScores: Array<{ scoringResult?: ScoringResultV2 | null }>,
  domain: "behavior" | "motivation",
): ProfileDimensionScore[] {
  return sessionScores.flatMap((sessionScore) => {
    const result = sessionScore.scoringResult;
    if (!result || result.assessmentDomain !== domain) return [];

    return [...result.scaleScores, ...result.forcedChoiceScores].flatMap((score) =>
      score.status === "ok" && score.normalized_score !== null
        ? [{ dimensionId: score.id, score: score.normalized_score }]
        : [],
    );
  });
}

function collectCompositeSourceValues(
  sessionScores: Array<SessionScore & { scoringResult?: ScoringResultV2 | null }>,
  reserved: {
    behaviorFit: number | null;
    fitScore: number | null;
    motivationFit: number | null;
    overallScore: number | null;
  },
) {
  const observed = new Map<string, number[]>();
  const add = (source: string, value: number | null | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const values = observed.get(source) ?? [];
    values.push(value);
    observed.set(source, values);
  };

  for (const sessionScore of sessionScores) {
    add(`test:${sessionScore.session.test_version_id}`, sessionScore.percentage);

    const result = sessionScore.scoringResult;
    if (!result) continue;
    add(`domain:${result.assessmentDomain}`, result.overallScore);

    for (const score of [
      ...result.criterionScores,
      ...result.scaleScores,
      ...result.forcedChoiceScores,
      ...result.compositeScores,
    ]) {
      if (score.status !== "ok") continue;
      add(score.id, score.normalized_score);
      add(`score:${score.id}`, score.normalized_score);
    }

    for (const score of [...result.scaleScores, ...result.forcedChoiceScores]) {
      if (score.status === "ok") add(`dimension:${score.id}`, score.normalized_score);
    }
  }

  const values = Object.fromEntries(
    [...observed.entries()].map(([source, scores]) => [
      source,
      scores.reduce((sum, score) => sum + score, 0) / scores.length,
    ]),
  ) as Record<string, number | null>;

  values.overall_score = reserved.overallScore;
  values.fit_score = reserved.fitScore;
  values.competency_fit = reserved.fitScore;
  values.motivation_fit = reserved.motivationFit;
  values.behavior_fit = reserved.behaviorFit;
  return values;
}

function riskLevelForFlags(flags: Array<{ risk_level: "low" | "medium" | "high" }>) {
  if (flags.some((flag) => flag.risk_level === "high")) {
    return "high";
  }

  if (flags.some((flag) => flag.risk_level === "medium")) {
    return "medium";
  }

  return flags.length > 0 ? "low" : null;
}

function createInterviewQuestions(
  summaryRows: Array<{
    competency_key: CompetencyKey;
    interpretation_direction: InterpretationDirection;
    is_below_minimum: boolean;
    percentage: number | null;
  }>,
  requiresReview: boolean,
  interpretationPolicy: InterpretationPolicy,
) {
  const questions = summaryRows
    .filter(
      (row) =>
        row.percentage !== null &&
        (row.is_below_minimum ||
          interpretReportScore(row.percentage, interpretationPolicy, {
            competencyKey: row.competency_key,
            direction: row.interpretation_direction,
          })?.band === "development_area"),
    )
    .map(
      (row) =>
        `Попросите привести пример ситуации, где проявлялась компетенция «${COMPETENCY_LABELS.get(row.competency_key) ?? row.competency_key}», и уточните ход решения.`,
    );

  if (requiresReview) {
    questions.push("Уточните контекст и ход рассуждений в развернутых ответах кандидата.");
  }

  if (questions.length === 0) {
    questions.push("Обсудите наиболее релевантный опыт кандидата и его вклад в похожей роли.");
  }

  return questions;
}

function createStrengths(
  summaryRows: Array<{
    competency_key: CompetencyKey;
    interpretation_direction: InterpretationDirection;
    percentage: number | null;
  }>,
  interpretationPolicy: InterpretationPolicy,
) {
  return summaryRows
    .filter(
      (row) =>
        row.percentage !== null &&
        interpretReportScore(row.percentage, interpretationPolicy, {
          competencyKey: row.competency_key,
          direction: row.interpretation_direction,
        })?.band === "strength",
    )
    .sort((left, right) => (right.percentage ?? 0) - (left.percentage ?? 0))
    .map((row) => ({
      competencyKey: row.competency_key,
      label: COMPETENCY_LABELS.get(row.competency_key) ?? row.competency_key,
      percentage: row.percentage,
    }));
}

export async function scoreCompletedApplication(
  applicationId: string,
  persistenceContext?: ScoringPersistenceContext,
) {
  const admin = createAdminClient();
  const { data: applicationData, error: applicationError } = await admin
    .from("candidate_applications")
    .select("id, candidate_id, job_id, scoring_revision, jobs(id, assessment_package_id, passing_score, motivation_target_profile_json, behavior_target_profile_json, composite_scoring_config_json, recommendation_policy_json, interpretation_policy_json)")
    .eq("id", applicationId)
    .maybeSingle();

  if (applicationError || !applicationData) {
    throw new Error("Unable to load application for scoring.");
  }

  const application = applicationData as unknown as ApplicationRecord;
  const job = related(application.jobs);
  if (!job?.assessment_package_id) {
    throw new Error("Application job has no assessment package.");
  }
  const recommendationPolicy = parseRecommendationPolicy(job.recommendation_policy_json);
  const interpretationPolicy = parseInterpretationPolicy(job.interpretation_policy_json);

  const [sessionsResult, packageTestsResult, weightsResult] = await Promise.all([
    admin
      .from("test_sessions")
      .select("id, status, test_version_id, test_versions(title, scoring_type, scoring_schema_version, assessment_domain, result_shape, scoring_config_json)")
      .eq("application_id", applicationId),
    admin
      .from("assessment_package_tests")
      .select("test_version_id, weight, is_required, passing_score, contributes_to_overall")
      .eq("package_id", job.assessment_package_id),
    admin
      .from("job_competency_weights")
      .select("competency_key, weight, minimum_score, is_required")
      .eq("job_id", application.job_id),
  ]);

  if (sessionsResult.error || packageTestsResult.error || weightsResult.error) {
    throw new Error("Unable to load scoring configuration.");
  }

  const packageTests = (packageTestsResult.data ?? []) as PackageTestRecord[];
  const packageTestsByVersion = new Map(packageTests.map((test) => [test.test_version_id, test]));
  const sessions = ((sessionsResult.data ?? []) as unknown as SessionRecord[]).filter((session) =>
    packageTestsByVersion.has(session.test_version_id),
  );

  if (
    sessions.length !== packageTests.length ||
    sessions.some((session) => session.status !== "completed")
  ) {
    throw new Error("All package test sessions must be completed before scoring.");
  }

  const testVersionIds = sessions.map((session) => session.test_version_id);
  const sessionIds = sessions.map((session) => session.id);
  const [contentResult, answersResult] = await Promise.all([
    admin
      .from("test_sections")
      .select(
        "test_version_id, questions(id, question_type, points, competency_key, settings_json, scoring_model, scoring_config_json, answer_options(id, is_correct, points, competency_effect_json, match_target_id, order_index))",
      )
      .in("test_version_id", testVersionIds),
    admin
      .from("candidate_answers")
      .select("id, session_id, question_id, selected_option_id, answer_text, answer_json, time_spent_seconds, is_correct, points_awarded, raw_score")
      .in("session_id", sessionIds),
  ]);

  if (contentResult.error || answersResult.error) {
    throw new Error("Unable to load submitted answers for scoring.");
  }

  const sections = (contentResult.data ?? []) as unknown as SectionRecord[];
  const answers = (answersResult.data ?? []) as unknown as AnswerRecord[];
  const questionsByVersion = new Map<string, QuestionRecord[]>();
  const answersBySession = new Map<string, AnswerRecord[]>();

  for (const section of sections) {
    const existing = questionsByVersion.get(section.test_version_id) ?? [];
    existing.push(...(section.questions ?? []));
    questionsByVersion.set(section.test_version_id, existing);
  }

  for (const answer of answers) {
    const existing = answersBySession.get(answer.session_id) ?? [];
    existing.push(answer);
    answersBySession.set(answer.session_id, existing);
  }
  const candidateAnswerById = new Map(answers.map((answer) => [answer.id, answer]));
  const candidateQuestionById = new Map(
    [...questionsByVersion.values()].flat().map((question) => [question.id, question]),
  );

  const calculations = sessions.map((session) =>
    scoreSession(
      session,
      packageTestsByVersion.get(session.test_version_id)!,
      questionsByVersion.get(session.test_version_id) ?? [],
      answersBySession.get(session.id) ?? [],
    ),
  );

  const answerUpdates = calculations.flatMap((calculation) =>
    [...calculation.answerScores.entries()].flatMap(([answerId, scoredAnswer]) => {
      const storedAnswer = candidateAnswerById.get(answerId);
      const preserveManualReview =
        candidateQuestionById.get(storedAnswer?.question_id ?? "")?.question_type === "open_text" &&
        storedAnswer !== undefined &&
        [storedAnswer.is_correct, storedAnswer.points_awarded, storedAnswer.raw_score].some(
          (value) => value !== null && value !== undefined,
        );
      return preserveManualReview
        ? []
        : [{
            id: answerId,
            is_correct: scoredAnswer.isCorrect,
            points_awarded: scoredAnswer.pointsAwarded,
            raw_score: scoredAnswer.rawScore,
          }];
    }),
  );

  const sessionScores = calculations.map((calculation) => calculation.score);
  const resultRows = sessionScores.map((score) => ({
        application_id: application.id,
        candidate_id: application.candidate_id,
        max_score: score.maxScore,
        percentage: score.percentage,
        raw_score: score.rawScore,
        requires_review: score.requiresReview,
        scored_at: score.scoringResult?.scoredAt ?? null,
        scoring_engine_version: score.scoringResult?.engineVersion ?? null,
        scoring_schema_version: score.scoringResult?.schemaVersion ?? null,
        scoring_result_json: score.scoringResult,
        session_id: score.session.id,
        summary: (!score.requiresReview ? getV2MetricsSummary(score.scoringResult) : null) ?? (score.requiresReview
          ? "Содержит ответы, требующие ручной проверки."
          : score.hasForcedChoice && score.percentage !== null
            ? `Качество рабочих решений: ${score.percentage} / 100. Forced Choice формирует отдельный профиль компетенций.`
            : score.hasForcedChoice
              ? "Forced Choice формирует профиль компетенций без оценки правильности."
          : score.scoringType === "competency_profile"
            ? "Профильная шкала без оценки правильности."
            : null),
        test_version_id: score.session.test_version_id,
        level: getResultLevel(
          score.percentage,
          score.requiresReview,
          score.scoringType,
          score.scoringResult?.interpretation?.code,
        ),
      }));

  const competencyRows = sessionScores.flatMap((score) => {
    return [...score.competencies.entries()].map(([key, total]) => ({
      application_id: application.id,
      competency_key: key,
      max_score: round(total.maxScore),
      percentage: competencyPercentage(total),
      score: round(total.score),
      session_id: score.session.id,
    }));
  });

  const weights = (weightsResult.data ?? []) as unknown as WeightRecord[];
  const weightsByCompetency = new Map(weights.map((weight) => [weight.competency_key, weight]));
  const competencyTotals = combineCompetencies(sessionScores);
  const competencyDirections = collectCompetencyDirections(sessionScores);
  const summaryRows = [...competencyTotals.entries()].map(([key, total]) => {
    const value = competencyPercentage(total);
    const weight = weightsByCompetency.get(key);
    const isBelowMinimum =
      !isMotivationCompetencyKey(key) &&
      Boolean(weight?.is_required && weight.minimum_score !== null && value !== null && value < weight.minimum_score);

    return {
      application_id: application.id,
      competency_key: key,
      interpretation_direction:
        competencyDirections.get(key) ?? defaultInterpretationDirection({ competencyKey: key }),
      is_below_minimum: isBelowMinimum,
      max_score: round(total.maxScore),
      percentage: value,
      score: round(total.score),
      weighted_score: value !== null && weight ? round(value * Number(weight.weight)) : null,
    };
  });


  // Profile and manually reviewed tests are preserved in results without lowering overall score.
  const autoScoredTests = sessionScores.filter(
    (score) => {
      const version = related(score.session.test_versions);
      return (
        !score.requiresReview &&
        score.percentage !== null &&
        packageTestContributesToOverall({
          contributesToOverall: score.packageTest.contributes_to_overall,
          resultShape: version?.result_shape,
          scoringType: score.scoringType,
        })
      );
    },
  );
  const overallScore = calculateContributingOverall(
    autoScoredTests.map((score) => ({
      percentage: score.percentage,
      weight: Number(score.packageTest.weight),
    })),
  );

  // Motivation needs a job-side target profile before it can fairly influence fit.
  const fitScore = calculateFitScore(summaryRows, weights);
  const motivationFit = calculateProfileFit(
    collectProfileDimensions(sessionScores, "motivation"),
    normalizeProfileTargets(job.motivation_target_profile_json),
  )?.score ?? null;
  const behaviorFit = calculateProfileFit(
    collectProfileDimensions(sessionScores, "behavior"),
    normalizeProfileTargets(job.behavior_target_profile_json),
  )?.score ?? null;
  const compositeConfig = normalizeAssessmentCompositeConfig(job.composite_scoring_config_json);
  const compositeResult = compositeConfig
    ? calculateAssessmentComposite(
        compositeConfig,
        collectCompositeSourceValues(sessionScores, {
          behaviorFit,
          fitScore,
          motivationFit,
          overallScore,
        }),
      )
    : null;
  const compositeScore = compositeResult?.score ?? null;

  const riskFlags: Array<{
    application_id: string;
    description: string;
    risk_key: string;
    risk_level: "low" | "medium" | "high";
    source: string;
    title: string;
  }> = [];

  for (const row of summaryRows) {
    const weight = weightsByCompetency.get(row.competency_key);
    const minimumScore = weight?.minimum_score;
    if (row.is_below_minimum && minimumScore !== null && minimumScore !== undefined) {
      riskFlags.push({
        application_id: application.id,
        description: `Результат ${row.percentage}% ниже обязательного минимума ${minimumScore}%.`,
        risk_key: `minimum_${row.competency_key}`,
        risk_level: "high",
        source: "scoring",
        title: `Минимальный уровень не достигнут: ${COMPETENCY_LABELS.get(row.competency_key) ?? row.competency_key}`,
      });
    }
  }

  for (const score of autoScoredTests) {
    if (
      score.packageTest.passing_score !== null &&
      score.percentage !== null &&
      score.percentage < score.packageTest.passing_score
    ) {
      riskFlags.push({
        application_id: application.id,
        description: `Результат теста ${score.percentage}% ниже проходного балла ${score.packageTest.passing_score}%.`,
        risk_key: `test_threshold_${score.session.test_version_id}`,
        risk_level: "medium",
        source: "scoring",
        title: "Не достигнут проходной балл теста",
      });
    }
  }

  if (job.passing_score !== null && overallScore !== null && overallScore < job.passing_score) {
    riskFlags.push({
      application_id: application.id,
      description: `Общий результат ${overallScore}% ниже проходного балла вакансии ${job.passing_score}%.`,
      risk_key: "job_passing_score",
      risk_level: "medium",
      source: "scoring",
      title: "Не достигнут проходной балл вакансии",
    });
  }

  const requiresReview = sessionScores.some((score) => score.requiresReview);
  const riskLevel = riskLevelForFlags(riskFlags);
  const baseRecommendation = requiresReview
    ? "requires_review"
    : recommendWithPolicy(recommendationPolicy, {
        composite_score: compositeScore,
        fit_score: fitScore,
        overall_score: overallScore,
      });
  const recommendation =
    riskLevel === "high"
      ? capHighRiskRecommendation(baseRecommendation, recommendationPolicy)
      : baseRecommendation;
  const strengths = createStrengths(summaryRows, interpretationPolicy);
  const interviewQuestions = createInterviewQuestions(
    summaryRows,
    requiresReview,
    interpretationPolicy,
  );

  const aggregate = {
      behavior_fit: behaviorFit,
      composite_result_json: compositeResult,
      composite_score: compositeScore,
      fit_score: fitScore,
      motivation_fit: motivationFit,
      overall_score: overallScore,
      recommendation,
      requires_review: requiresReview,
      risk_level: riskLevel,
    };
  const comparison = {
      application_id: application.id,
      candidate_id: application.candidate_id,
      completed_required_tests: packageTests
        .filter((test) => test.is_required)
        .every((test) => sessions.some((session) => session.test_version_id === test.test_version_id && session.status === "completed")),
      behavior_fit: behaviorFit,
      composite_score: compositeScore,
      fit_score: fitScore,
      job_id: application.job_id,
      motivation_fit: motivationFit,
      overall_score: overallScore,
      recommendation,
      risk_level: riskLevel,
    };
  const report = {
      application_id: application.id,
      behavior_fit: behaviorFit,
      candidate_id: application.candidate_id,
      composite_result_json: compositeResult,
      composite_score: compositeScore,
      fit_score: fitScore,
      interview_questions_json: interviewQuestions,
      motivation_fit: motivationFit,
      overall_score: overallScore,
      recommendation,
      report_text: requiresReview
        ? "Оценка завершена. Перед выводом по кандидату требуется ручная проверка текстовых ответов."
        : "Оценка завершена. Результаты отражают предварительное соответствие требованиям вакансии.",
      risks_json: riskFlags,
      strengths_json: strengths,
      suggested_roles_json: [],
    };

  const expectedRevision = persistenceContext?.expectedRevision ?? application.scoring_revision ?? 0;
  const { data: persisted, error: persistenceError } = await admin.rpc(
    "try_persist_scoring_snapshot",
    {
      p_audit: persistenceContext?.audit ?? null,
      p_expected_revision: expectedRevision,
      p_parent_id: application.id,
      p_scope: "candidate",
      p_snapshot: {
        aggregate,
        answers: answerUpdates,
        competency_scores: competencyRows,
        comparison,
        report,
        results: resultRows,
        risks: riskFlags,
        sessions: sessionScores.map((score) => ({
          id: score.session.id,
          max_score: score.maxScore,
          percentage: score.percentage,
          score: score.rawScore,
        })),
        summaries: summaryRows,
      },
    },
  );
  if (persistenceError || !persisted) {
    throw new Error(persistenceError?.message ?? "Unable to persist candidate scoring snapshot.");
  }
  const persistenceResult = persisted as {
    audit_id?: string | null;
    conflict?: boolean;
    revision?: number;
  };
  const persistedRevision = Number(persistenceResult.revision ?? 0);
  if (
    persistenceResult.conflict &&
    (persistenceContext !== undefined || persistedRevision <= expectedRevision)
  ) {
    throw new Error(
      `Scoring revision conflict: expected ${expectedRevision}, found ${persistedRevision}.`,
    );
  }

  return {
    behaviorFit,
    compositeScore,
    fitScore,
    motivationFit,
    overallScore,
    recommendation,
    requiresReview,
    auditId: persistenceResult.audit_id ?? null,
    revision: persistedRevision,
    riskLevel,
  };
}

export async function scoreCompletedEmployeeAssessmentParticipant(
  participantId: string,
  persistenceContext?: ScoringPersistenceContext,
) {
  const admin = createAdminClient();
  const { data: participantData, error: participantError } = await admin
    .from("employee_assessment_participants")
    .select("id, employee_id, employee_assessment_id, scoring_revision, employee_assessments(id, assessment_package_id, passing_score, recommendation_policy_json, interpretation_policy_json)")
    .eq("id", participantId)
    .maybeSingle();

  if (participantError || !participantData) {
    throw new Error("Unable to load employee assessment participant for scoring.");
  }

  const participant = participantData as unknown as EmployeeParticipantScoringRecord;
  const assessment = related(participant.employee_assessments);
  if (!assessment?.assessment_package_id) {
    throw new Error("Employee assessment has no assessment package.");
  }
  const recommendationPolicy = parseRecommendationPolicy(
    assessment.recommendation_policy_json,
  );
  const interpretationPolicy = parseInterpretationPolicy(
    assessment.interpretation_policy_json,
  );

  const [sessionsResult, packageTestsResult, weightsResult] = await Promise.all([
    admin
      .from("employee_assessment_sessions")
      .select("id, status, test_version_id, package_weight, package_is_required, package_passing_score, package_contributes_to_overall, test_versions(title, scoring_type, scoring_schema_version, assessment_domain, result_shape, scoring_config_json)")
      .eq("participant_id", participantId),
    admin
      .from("assessment_package_tests")
      .select("test_version_id, weight, is_required, passing_score, contributes_to_overall")
      .eq("package_id", assessment.assessment_package_id),
    admin
      .from("employee_assessment_competency_weights")
      .select("competency_key, weight, minimum_score, is_required")
      .eq("employee_assessment_id", participant.employee_assessment_id),
  ]);

  if (sessionsResult.error || packageTestsResult.error || weightsResult.error) {
    throw new Error("Unable to load employee scoring configuration.");
  }

  const allSessions = (sessionsResult.data ?? []) as unknown as EmployeeSessionScoringRecord[];
  const hasFrozenPackageConfiguration =
    allSessions.length > 0 &&
    allSessions.every(
      (session) =>
        session.package_weight !== null &&
        session.package_is_required !== null &&
        session.package_contributes_to_overall !== null,
    );
  const packageTests = hasFrozenPackageConfiguration
      ? allSessions.map((session) => ({
        contributes_to_overall: session.package_contributes_to_overall!,
        is_required: session.package_is_required!,
        passing_score: session.package_passing_score,
        test_version_id: session.test_version_id,
        weight: session.package_weight!,
      }))
    : (packageTestsResult.data ?? []) as PackageTestRecord[];
  const packageTestsByVersion = new Map(packageTests.map((test) => [test.test_version_id, test]));
  const sessions = hasFrozenPackageConfiguration
    ? allSessions
    : allSessions.filter((session) => packageTestsByVersion.has(session.test_version_id));

  if (
    sessions.length !== packageTests.length ||
    sessions.some((session) => session.status !== "completed")
  ) {
    throw new Error("All employee assessment package test sessions must be completed before scoring.");
  }

  const testVersionIds = sessions.map((session) => session.test_version_id);
  const sessionIds = sessions.map((session) => session.id);
  const [contentResult, answersResult] = await Promise.all([
    admin
      .from("test_sections")
      .select(
        "test_version_id, questions(id, question_type, points, competency_key, settings_json, scoring_model, scoring_config_json, answer_options(id, is_correct, points, competency_effect_json, match_target_id, order_index))",
      )
      .in("test_version_id", testVersionIds),
    admin
      .from("employee_assessment_answers")
      .select("id, session_id, question_id, selected_option_id, answer_text, answer_json, time_spent_seconds, is_correct, points_awarded, raw_score")
      .in("session_id", sessionIds),
  ]);

  if (contentResult.error || answersResult.error) {
    throw new Error("Unable to load submitted employee answers for scoring.");
  }

  const sections = (contentResult.data ?? []) as unknown as SectionRecord[];
  const answers = (answersResult.data ?? []) as unknown as AnswerRecord[];
  const questionsByVersion = new Map<string, QuestionRecord[]>();
  const answersBySession = new Map<string, AnswerRecord[]>();

  for (const section of sections) {
    const existing = questionsByVersion.get(section.test_version_id) ?? [];
    existing.push(...(section.questions ?? []));
    questionsByVersion.set(section.test_version_id, existing);
  }

  for (const answer of answers) {
    const existing = answersBySession.get(answer.session_id) ?? [];
    existing.push(answer);
    answersBySession.set(answer.session_id, existing);
  }
  const employeeAnswerById = new Map(answers.map((answer) => [answer.id, answer]));
  const employeeQuestionById = new Map(
    [...questionsByVersion.values()].flat().map((question) => [question.id, question]),
  );

  const calculations = sessions.map((session) =>
    scoreSession(
      session,
      packageTestsByVersion.get(session.test_version_id)!,
      questionsByVersion.get(session.test_version_id) ?? [],
      answersBySession.get(session.id) ?? [],
    ),
  );

  const answerUpdates = calculations.flatMap((calculation) =>
    [...calculation.answerScores.entries()].flatMap(([answerId, scoredAnswer]) => {
      const storedAnswer = employeeAnswerById.get(answerId);
      const preserveManualReview =
        employeeQuestionById.get(storedAnswer?.question_id ?? "")?.question_type === "open_text" &&
        storedAnswer !== undefined &&
        [storedAnswer.is_correct, storedAnswer.points_awarded, storedAnswer.raw_score].some(
          (value) => value !== null && value !== undefined,
        );
      return preserveManualReview
        ? []
        : [{
            id: answerId,
            is_correct: scoredAnswer.isCorrect,
            points_awarded: scoredAnswer.pointsAwarded,
            raw_score: scoredAnswer.rawScore,
          }];
    }),
  );

  const sessionScores = calculations.map((calculation) => calculation.score);
  const resultRows = sessionScores.map((score) => ({
        employee_id: participant.employee_id,
        max_score: score.maxScore,
        participant_id: participant.id,
        percentage: score.percentage,
        raw_score: score.rawScore,
        requires_review: score.requiresReview,
        scored_at: score.scoringResult?.scoredAt ?? null,
        scoring_engine_version: score.scoringResult?.engineVersion ?? null,
        scoring_schema_version: score.scoringResult?.schemaVersion ?? null,
        scoring_result_json: score.scoringResult,
        session_id: score.session.id,
        summary: (!score.requiresReview ? getV2MetricsSummary(score.scoringResult) : null) ?? (score.requiresReview
          ? "Содержит ответы, требующие ручной проверки."
          : score.hasForcedChoice && score.percentage !== null
            ? `Качество рабочих решений: ${score.percentage} / 100. Forced Choice формирует отдельный профиль компетенций.`
            : score.hasForcedChoice
              ? "Forced Choice формирует профиль компетенций без оценки правильности."
          : score.scoringType === "competency_profile"
            ? "Профильная шкала без оценки правильности."
            : null),
        test_version_id: score.session.test_version_id,
        level: getResultLevel(
          score.percentage,
          score.requiresReview,
          score.scoringType,
          score.scoringResult?.interpretation?.code,
        ),
      }));

  const competencyRows = sessionScores.flatMap((score) => {
    return [...score.competencies.entries()].map(([key, total]) => ({
      competency_key: key,
      max_score: round(total.maxScore),
      participant_id: participant.id,
      percentage: competencyPercentage(total),
      score: round(total.score),
      session_id: score.session.id,
    }));
  });

  const weights = (weightsResult.data ?? []) as unknown as WeightRecord[];
  const weightsByCompetency = new Map(weights.map((weight) => [weight.competency_key, weight]));
  const competencyTotals = combineCompetencies(sessionScores);
  const competencyDirections = collectCompetencyDirections(sessionScores);
  const summaryRows = [...competencyTotals.entries()].map(([key, total]) => {
    const value = competencyPercentage(total);
    const weight = weightsByCompetency.get(key);
    const isBelowMinimum =
      !isMotivationCompetencyKey(key) &&
      Boolean(weight?.is_required && weight.minimum_score !== null && value !== null && value < weight.minimum_score);

    return {
      competency_key: key,
      interpretation_direction:
        competencyDirections.get(key) ?? defaultInterpretationDirection({ competencyKey: key }),
      is_below_minimum: isBelowMinimum,
      max_score: round(total.maxScore),
      participant_id: participant.id,
      percentage: value,
      score: round(total.score),
      weighted_score: value !== null && weight ? round(value * Number(weight.weight)) : null,
    };
  });


  const autoScoredTests = sessionScores.filter(
    (score) => {
      const version = related(score.session.test_versions);
      return (
        !score.requiresReview &&
        score.percentage !== null &&
        packageTestContributesToOverall({
          contributesToOverall: score.packageTest.contributes_to_overall,
          resultShape: version?.result_shape,
          scoringType: score.scoringType,
        })
      );
    },
  );
  const overallScore = calculateContributingOverall(
    autoScoredTests.map((score) => ({
      percentage: score.percentage,
      weight: Number(score.packageTest.weight),
    })),
  );

  const fitScore = calculateFitScore(summaryRows, weights) ?? overallScore;

  const riskFlags: Array<{
    description: string;
    participant_id: string;
    risk_key: string;
    risk_level: "low" | "medium" | "high";
    source: string;
    title: string;
  }> = [];

  for (const row of summaryRows) {
    const weight = weightsByCompetency.get(row.competency_key);
    const minimumScore = weight?.minimum_score;
    if (row.is_below_minimum && minimumScore !== null && minimumScore !== undefined) {
      riskFlags.push({
        description: `Результат ${row.percentage}% ниже обязательного минимума ${minimumScore}%.`,
        participant_id: participant.id,
        risk_key: `minimum_${row.competency_key}`,
        risk_level: "high",
        source: "scoring",
        title: `Минимальный уровень не достигнут: ${COMPETENCY_LABELS.get(row.competency_key) ?? row.competency_key}`,
      });
    }
  }

  for (const score of autoScoredTests) {
    if (
      score.packageTest.passing_score !== null &&
      score.percentage !== null &&
      score.percentage < score.packageTest.passing_score
    ) {
      riskFlags.push({
        description: `Результат теста ${score.percentage}% ниже проходного балла ${score.packageTest.passing_score}%.`,
        participant_id: participant.id,
        risk_key: `test_threshold_${score.session.test_version_id}`,
        risk_level: "medium",
        source: "scoring",
        title: "Не достигнут проходной балл теста",
      });
    }
  }

  if (assessment.passing_score !== null && overallScore !== null && overallScore < assessment.passing_score) {
    riskFlags.push({
      description: `Общий результат ${overallScore}% ниже проходного балла оценки ${assessment.passing_score}%.`,
      participant_id: participant.id,
      risk_key: "employee_assessment_passing_score",
      risk_level: "medium",
      source: "scoring",
      title: "Не достигнут проходной балл оценки",
    });
  }

  const requiresReview = sessionScores.some((score) => score.requiresReview);
  const riskLevel = riskLevelForFlags(riskFlags);
  const baseRecommendation = requiresReview
    ? "requires_review"
    : recommendWithPolicy(recommendationPolicy, {
        composite_score: null,
        fit_score: fitScore,
        overall_score: overallScore,
      });
  const recommendation =
    riskLevel === "high"
      ? capHighRiskRecommendation(baseRecommendation, recommendationPolicy)
      : baseRecommendation;
  const strengths = createStrengths(summaryRows, interpretationPolicy);
  const interviewQuestions = createInterviewQuestions(
    summaryRows,
    requiresReview,
    interpretationPolicy,
  );

  const aggregate = {
      fit_score: fitScore,
      overall_score: overallScore,
      recommendation,
      requires_review: requiresReview,
      risk_level: riskLevel,
    };
  const report = {
      employee_id: participant.employee_id,
      fit_score: fitScore,
      interview_questions_json: interviewQuestions,
      overall_score: overallScore,
      participant_id: participant.id,
      recommendation,
      report_text: requiresReview
        ? "Оценка завершена. Перед выводом по сотруднику требуется ручная проверка текстовых ответов."
        : "Оценка завершена. Результаты отражают предварительный профиль по выбранным компетенциям.",
      risks_json: riskFlags,
      strengths_json: strengths,
      suggested_roles_json: [],
    };

  const expectedRevision = persistenceContext?.expectedRevision ?? participant.scoring_revision ?? 0;
  const { data: persisted, error: persistenceError } = await admin.rpc(
    "try_persist_scoring_snapshot",
    {
      p_audit: persistenceContext?.audit ?? null,
      p_expected_revision: expectedRevision,
      p_parent_id: participant.id,
      p_scope: "employee",
      p_snapshot: {
        aggregate,
        answers: answerUpdates,
        competency_scores: competencyRows,
        report,
        results: resultRows,
        risks: riskFlags,
        sessions: sessionScores.map((score) => ({
          id: score.session.id,
          max_score: score.maxScore,
          percentage: score.percentage,
          score: score.rawScore,
        })),
        summaries: summaryRows,
      },
    },
  );
  if (persistenceError || !persisted) {
    throw new Error(persistenceError?.message ?? "Unable to persist employee scoring snapshot.");
  }
  const persistenceResult = persisted as {
    audit_id?: string | null;
    conflict?: boolean;
    revision?: number;
  };
  const persistedRevision = Number(persistenceResult.revision ?? 0);
  if (
    persistenceResult.conflict &&
    (persistenceContext !== undefined || persistedRevision <= expectedRevision)
  ) {
    throw new Error(
      `Scoring revision conflict: expected ${expectedRevision}, found ${persistedRevision}.`,
    );
  }

  return {
    fitScore,
    overallScore,
    recommendation,
    requiresReview,
    auditId: persistenceResult.audit_id ?? null,
    revision: persistedRevision,
    riskLevel,
  };
}

export const RECALCULATION_REASONS = [
  "manual",
  "scoring_upgrade",
  "definition_change",
  "admin_repair",
] as const;

export type RecalculationReason = (typeof RECALCULATION_REASONS)[number];

export type RecalculateSessionScoreInput = {
  actorId?: string | null;
  reason: RecalculationReason;
  sessionId: string;
};

type AdminClient = ReturnType<typeof createAdminClient>;

type RecalculationSnapshot = {
  aggregate: Record<string, unknown> | null;
  companyId: string;
  engineVersion: string | null;
  revision: number;
  result: Record<string, unknown> | null;
  schemaVersion: string | null;
};

type AtomicAuditInput = {
  actor_id: string | null;
  previous_aggregate_json: Record<string, unknown> | null;
  previous_engine_version: string | null;
  previous_result_json: Record<string, unknown> | null;
  previous_revision: number;
  previous_schema_version: string | null;
  reason: RecalculationReason;
  session_id: string;
};

type ScoringPersistenceContext = {
  audit: AtomicAuditInput;
  expectedRevision: number;
};

function createAtomicAuditInput(
  request: { actorId?: string | null; reason: RecalculationReason; sessionId: string },
  snapshot: RecalculationSnapshot,
): AtomicAuditInput {
  return {
    actor_id: request.actorId ?? null,
    previous_aggregate_json: snapshot.aggregate,
    previous_engine_version: snapshot.engineVersion,
    previous_result_json: snapshot.result,
    previous_revision: snapshot.revision,
    previous_schema_version: snapshot.schemaVersion,
    reason: request.reason,
    session_id: request.sessionId,
  };
}

/**
 * Rebuilds a completed assessment from persisted raw answers. This entry point
 * delegates to the same parent pipeline as normal completion, and records the
 * previous snapshot before any derived scoring data is replaced.
 */
export async function recalculateSessionScore(
  input: string | RecalculateSessionScoreInput,
) {
  const request = typeof input === "string"
    ? { actorId: null, reason: "manual" as const, sessionId: input }
    : input;
  if (!RECALCULATION_REASONS.includes(request.reason)) {
    throw new Error("Invalid recalculation reason.");
  }

  const admin = createAdminClient();
  const { data: candidateSession, error: candidateError } = await admin
    .from("test_sessions")
    .select("application_id, status")
    .eq("id", request.sessionId)
    .maybeSingle();
  if (candidateError) {
    throw new Error("Unable to locate candidate session for recalculation.");
  }
  if (candidateSession) {
    if (candidateSession.status !== "completed") {
      throw new Error("Only completed sessions can be recalculated.");
    }
    const applicationId = candidateSession.application_id as string;
    const before = await loadCandidateRecalculationSnapshot(
      admin,
      applicationId,
      request.sessionId,
    );
    try {
      const result = await scoreCompletedApplication(applicationId, {
        audit: createAtomicAuditInput(request, before),
        expectedRevision: before.revision,
      });
      return { auditId: result.auditId, scope: "candidate" as const, result };
    } catch (error) {
      await recordFailedRecalculationAudit(admin, {
        actorId: request.actorId ?? null,
        cause: error,
        reason: request.reason,
        scope: "candidate",
        sessionId: request.sessionId,
        snapshot: before,
      });
      throw error;
    }
  }

  const { data: employeeSession, error: employeeError } = await admin
    .from("employee_assessment_sessions")
    .select("participant_id, status")
    .eq("id", request.sessionId)
    .maybeSingle();
  if (employeeError) {
    throw new Error("Unable to locate employee session for recalculation.");
  }
  if (!employeeSession) {
    throw new Error("Assessment session was not found.");
  }
  if (employeeSession.status !== "completed") {
    throw new Error("Only completed sessions can be recalculated.");
  }

  const participantId = employeeSession.participant_id as string;
  const before = await loadEmployeeRecalculationSnapshot(
    admin,
    participantId,
    request.sessionId,
  );
  try {
    const result = await scoreCompletedEmployeeAssessmentParticipant(participantId, {
      audit: createAtomicAuditInput(request, before),
      expectedRevision: before.revision,
    });
    return { auditId: result.auditId, scope: "employee" as const, result };
  } catch (error) {
    await recordFailedRecalculationAudit(admin, {
      actorId: request.actorId ?? null,
      cause: error,
      reason: request.reason,
      scope: "employee",
      sessionId: request.sessionId,
      snapshot: before,
    });
    throw error;
  }
}

async function loadCandidateRecalculationSnapshot(
  admin: AdminClient,
  applicationId: string,
  sessionId: string,
): Promise<RecalculationSnapshot> {
  const [application, result] = await Promise.all([
    admin
      .from("candidate_applications")
      .select("company_id, overall_score, fit_score, motivation_fit, behavior_fit, composite_score, composite_result_json, recommendation, risk_level, requires_review, scoring_revision")
      .eq("id", applicationId)
      .single(),
    admin
      .from("test_results")
      .select("scoring_result_json, scoring_engine_version, scoring_schema_version")
      .eq("session_id", sessionId)
      .maybeSingle(),
  ]);
  if (application.error || !application.data || result.error) {
    throw new Error("Unable to snapshot candidate scoring before recalculation.");
  }
  return {
    aggregate: application.data as Record<string, unknown>,
    companyId: application.data.company_id as string,
    engineVersion: (result.data?.scoring_engine_version as string | null | undefined) ?? null,
    revision: Number(application.data.scoring_revision ?? 0),
    result: (result.data?.scoring_result_json as Record<string, unknown> | null | undefined) ?? null,
    schemaVersion: (result.data?.scoring_schema_version as string | null | undefined) ?? null,
  };
}

async function loadEmployeeRecalculationSnapshot(
  admin: AdminClient,
  participantId: string,
  sessionId: string,
): Promise<RecalculationSnapshot> {
  const [participant, result] = await Promise.all([
    admin
      .from("employee_assessment_participants")
      .select("company_id, overall_score, fit_score, recommendation, risk_level, requires_review, scoring_revision")
      .eq("id", participantId)
      .single(),
    admin
      .from("employee_assessment_test_results")
      .select("scoring_result_json, scoring_engine_version, scoring_schema_version")
      .eq("session_id", sessionId)
      .maybeSingle(),
  ]);
  if (participant.error || !participant.data || result.error) {
    throw new Error("Unable to snapshot employee scoring before recalculation.");
  }
  return {
    aggregate: participant.data as Record<string, unknown>,
    companyId: participant.data.company_id as string,
    engineVersion: (result.data?.scoring_engine_version as string | null | undefined) ?? null,
    revision: Number(participant.data.scoring_revision ?? 0),
    result: (result.data?.scoring_result_json as Record<string, unknown> | null | undefined) ?? null,
    schemaVersion: (result.data?.scoring_schema_version as string | null | undefined) ?? null,
  };
}

async function recordFailedRecalculationAudit(
  admin: AdminClient,
  input: {
    actorId: string | null;
    cause: unknown;
    reason: RecalculationReason;
    scope: "candidate" | "employee";
    sessionId: string;
    snapshot: RecalculationSnapshot;
  },
) {
  await admin
    .from("scoring_recalculation_history")
    .insert({
      actor_id: input.actorId,
      completed_at: new Date().toISOString(),
      company_id: input.snapshot.companyId,
      error_message: (
        input.cause instanceof Error ? input.cause.message : "Unknown scoring error"
      ).slice(0, 4_000),
      new_engine_version: SCORING_ENGINE_VERSION,
      new_revision: null,
      new_schema_version: SCORING_SCHEMA_VERSION,
      previous_aggregate_json: input.snapshot.aggregate,
      previous_engine_version: input.snapshot.engineVersion,
      previous_result_json: input.snapshot.result,
      previous_revision: input.snapshot.revision,
      previous_schema_version: input.snapshot.schemaVersion,
      reason: input.reason,
      scope: input.scope,
      session_id: input.sessionId,
      status: "failed",
    });
}
