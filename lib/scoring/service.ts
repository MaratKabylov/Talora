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
  type LegacyAnswerRecord as AnswerRecord,
  type LegacyCompetencyTotal as CompetencyTotal,
  type LegacyPackageTestRecord as PackageTestRecord,
  type LegacyQuestionRecord as QuestionRecord,
  type LegacyScoringType as ScoringType,
  type LegacySectionRecord as SectionRecord,
  type LegacySessionRecord as SessionRecord,
  type LegacySessionScore as SessionScore,
} from "@/lib/scoring/models/legacy-session";
import { scoreSession } from "@/lib/scoring/session";
import type { ScoringResultV2 } from "@/lib/scoring/types";
import { createAdminClient } from "@/lib/supabase/admin";

type Relation<T> = T | T[] | null;

type JobRecord = {
  assessment_package_id: string | null;
  behavior_target_profile_json: unknown;
  id: string;
  motivation_target_profile_json: unknown;
  passing_score: number | null;
};

type ApplicationRecord = {
  candidate_id: string;
  id: string;
  job_id: string;
  jobs: Relation<JobRecord>;
};

type EmployeeAssessmentScoringRecord = {
  assessment_package_id: string;
  id: string;
  passing_score: number | null;
};

type EmployeeParticipantScoringRecord = {
  employee_assessment_id: string;
  employee_assessments: Relation<EmployeeAssessmentScoringRecord>;
  employee_id: string;
  id: string;
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

  if (value >= 85) {
    return "strong";
  }

  if (value >= 65) {
    return "meets_expectations";
  }

  return "below_expectations";
}

function recommendationFromScore(value: number | null) {
  if (value === null) {
    return "requires_review";
  }

  if (value >= 85) {
    return "strong_candidate";
  }

  if (value >= 75) {
    return "invite";
  }

  if (value >= 65) {
    return "consider";
  }

  if (value >= 50) {
    return "backup";
  }

  return "not_recommended";
}

function getV2MetricsSummary(result: ScoringResultV2 | null) {
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
    is_below_minimum: boolean;
    percentage: number | null;
  }>,
  requiresReview: boolean,
) {
  const questions = summaryRows
    .filter(
      (row) =>
        !isMotivationCompetencyKey(row.competency_key) &&
        row.percentage !== null &&
        (row.is_below_minimum || row.percentage < 65),
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

export async function scoreCompletedApplication(applicationId: string) {
  const admin = createAdminClient();
  const { data: applicationData, error: applicationError } = await admin
    .from("candidate_applications")
    .select("id, candidate_id, job_id, jobs(id, assessment_package_id, passing_score, motivation_target_profile_json, behavior_target_profile_json)")
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

  const [sessionsResult, packageTestsResult, weightsResult] = await Promise.all([
    admin
      .from("test_sessions")
      .select("id, status, test_version_id, test_versions(title, scoring_type, scoring_schema_version, assessment_domain, result_shape, scoring_config_json)")
      .eq("application_id", applicationId),
    admin
      .from("assessment_package_tests")
      .select("test_version_id, weight, is_required, passing_score")
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
      .select("id, session_id, question_id, selected_option_id, answer_text, answer_json, time_spent_seconds")
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

  const calculations = sessions.map((session) =>
    scoreSession(
      session,
      packageTestsByVersion.get(session.test_version_id)!,
      questionsByVersion.get(session.test_version_id) ?? [],
      answersBySession.get(session.id) ?? [],
    ),
  );

  const answerUpdates = calculations.flatMap((calculation) =>
    [...calculation.answerScores.entries()].map(([answerId, scoredAnswer]) =>
      admin
        .from("candidate_answers")
        .update({
          is_correct: scoredAnswer.isCorrect,
          points_awarded: scoredAnswer.pointsAwarded,
          raw_score: scoredAnswer.rawScore,
        })
        .eq("id", answerId),
    ),
  );
  const answerUpdateResults = await Promise.all(answerUpdates);
  if (answerUpdateResults.some((result) => result.error)) {
    throw new Error("Unable to save scored answers.");
  }

  const sessionScores = calculations.map((calculation) => calculation.score);
  const sessionUpdateResults = await Promise.all(
    sessionScores.map((score) =>
      admin
        .from("test_sessions")
        .update({
          max_score: score.maxScore,
          percentage: score.percentage,
          score: score.rawScore,
        })
        .eq("id", score.session.id),
    ),
  );
  if (sessionUpdateResults.some((result) => result.error)) {
    throw new Error("Unable to save test session scoring.");
  }

  const { data: storedResults, error: resultsError } = await admin
    .from("test_results")
    .upsert(
      sessionScores.map((score) => ({
        application_id: application.id,
        candidate_id: application.candidate_id,
        max_score: score.maxScore,
        percentage: score.percentage,
        raw_score: score.rawScore,
        requires_review: score.requiresReview,
        scored_at: score.scoringResult?.scoredAt ?? null,
        scoring_engine_version: score.scoringResult?.engineVersion ?? null,
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
      })),
      { onConflict: "session_id" },
    )
    .select("id, session_id");

  if (resultsError || !storedResults) {
    throw new Error("Unable to save test results.");
  }

  const resultIdBySession = new Map(
    storedResults.map((result) => [result.session_id as string, result.id as string]),
  );
  const resultIds = [...resultIdBySession.values()];
  if (resultIds.length > 0) {
    const { error } = await admin.from("competency_scores").delete().in("result_id", resultIds);
    if (error) {
      throw new Error("Unable to replace competency scores.");
    }
  }

  const competencyRows = sessionScores.flatMap((score) => {
    const resultId = resultIdBySession.get(score.session.id);
    if (!resultId) {
      return [];
    }

    return [...score.competencies.entries()].map(([key, total]) => ({
      application_id: application.id,
      competency_key: key,
      max_score: round(total.maxScore),
      percentage: competencyPercentage(total),
      result_id: resultId,
      score: round(total.score),
    }));
  });

  if (competencyRows.length > 0) {
    const { error } = await admin.from("competency_scores").insert(competencyRows);
    if (error) {
      throw new Error("Unable to save competency scores.");
    }
  }

  const weights = (weightsResult.data ?? []) as unknown as WeightRecord[];
  const weightsByCompetency = new Map(weights.map((weight) => [weight.competency_key, weight]));
  const competencyTotals = combineCompetencies(sessionScores);
  const summaryRows = [...competencyTotals.entries()].map(([key, total]) => {
    const value = competencyPercentage(total);
    const weight = weightsByCompetency.get(key);
    const isBelowMinimum =
      !isMotivationCompetencyKey(key) &&
      Boolean(weight?.is_required && weight.minimum_score !== null && value !== null && value < weight.minimum_score);

    return {
      application_id: application.id,
      competency_key: key,
      is_below_minimum: isBelowMinimum,
      max_score: round(total.maxScore),
      percentage: value,
      score: round(total.score),
      weighted_score: value !== null && weight ? round(value * Number(weight.weight)) : null,
    };
  });

  const { error: removeSummaryError } = await admin
    .from("application_competency_summary")
    .delete()
    .eq("application_id", application.id);
  if (removeSummaryError) {
    throw new Error("Unable to replace application competency summary.");
  }

  if (summaryRows.length > 0) {
    const { error } = await admin.from("application_competency_summary").insert(summaryRows);
    if (error) {
      throw new Error("Unable to save application competency summary.");
    }
  }

  // Profile and manually reviewed tests are preserved in results without lowering overall score.
  const autoScoredTests = sessionScores.filter(
    (score) =>
      !score.requiresReview &&
      score.scoringType !== "competency_profile" &&
      score.percentage !== null,
  );
  const overallWeight = autoScoredTests.reduce((sum, score) => sum + Number(score.packageTest.weight), 0);
  const overallScore =
    overallWeight > 0
      ? round(
          autoScoredTests.reduce(
            (sum, score) => sum + (score.percentage ?? 0) * Number(score.packageTest.weight),
            0,
          ) / overallWeight,
        )
      : null;

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

  const { error: removeRiskError } = await admin
    .from("candidate_risk_flags")
    .delete()
    .eq("application_id", application.id)
    .eq("source", "scoring");
  if (removeRiskError) {
    throw new Error("Unable to replace scoring risk flags.");
  }

  if (riskFlags.length > 0) {
    const { error } = await admin.from("candidate_risk_flags").insert(riskFlags);
    if (error) {
      throw new Error("Unable to save risk flags.");
    }
  }

  const requiresReview = sessionScores.some((score) => score.requiresReview);
  const riskLevel = riskLevelForFlags(riskFlags);
  const baseRecommendation = requiresReview
    ? "requires_review"
    : recommendationFromScore(fitScore ?? overallScore);
  const recommendation =
    riskLevel === "high" && (baseRecommendation === "strong_candidate" || baseRecommendation === "invite")
      ? "consider"
      : baseRecommendation;
  const strengths = summaryRows
    .filter(
      (row) =>
        !isMotivationCompetencyKey(row.competency_key) &&
        row.percentage !== null &&
        row.percentage >= 75,
    )
    .sort((left, right) => (right.percentage ?? 0) - (left.percentage ?? 0))
    .map((row) => ({
      competencyKey: row.competency_key,
      label: COMPETENCY_LABELS.get(row.competency_key) ?? row.competency_key,
      percentage: row.percentage,
    }));
  const interviewQuestions = createInterviewQuestions(summaryRows, requiresReview);

  const { error: applicationUpdateError } = await admin
    .from("candidate_applications")
    .update({
      behavior_fit: behaviorFit,
      fit_score: fitScore,
      motivation_fit: motivationFit,
      overall_score: overallScore,
      recommendation,
      requires_review: requiresReview,
      risk_level: riskLevel,
    })
    .eq("id", application.id);
  if (applicationUpdateError) {
    throw new Error("Unable to save application scoring.");
  }

  const { error: comparisonError } = await admin.from("application_comparison_scores").upsert(
    {
      application_id: application.id,
      candidate_id: application.candidate_id,
      completed_required_tests: packageTests
        .filter((test) => test.is_required)
        .every((test) => sessions.some((session) => session.test_version_id === test.test_version_id && session.status === "completed")),
      behavior_fit: behaviorFit,
      fit_score: fitScore,
      job_id: application.job_id,
      motivation_fit: motivationFit,
      overall_score: overallScore,
      recommendation,
      risk_level: riskLevel,
    },
    { onConflict: "application_id" },
  );
  if (comparisonError) {
    throw new Error("Unable to save comparison scoring.");
  }

  const { error: reportError } = await admin.from("candidate_reports").upsert(
    {
      application_id: application.id,
      behavior_fit: behaviorFit,
      candidate_id: application.candidate_id,
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
    },
    { onConflict: "application_id" },
  );
  if (reportError) {
    throw new Error("Unable to save candidate report.");
  }

  return {
    behaviorFit,
    fitScore,
    motivationFit,
    overallScore,
    recommendation,
    requiresReview,
    riskLevel,
  };
}

export async function scoreCompletedEmployeeAssessmentParticipant(participantId: string) {
  const admin = createAdminClient();
  const { data: participantData, error: participantError } = await admin
    .from("employee_assessment_participants")
    .select("id, employee_id, employee_assessment_id, employee_assessments(id, assessment_package_id, passing_score)")
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

  const [sessionsResult, packageTestsResult, weightsResult] = await Promise.all([
    admin
      .from("employee_assessment_sessions")
      .select("id, status, test_version_id, test_versions(title, scoring_type, scoring_schema_version, assessment_domain, result_shape, scoring_config_json)")
      .eq("participant_id", participantId),
    admin
      .from("assessment_package_tests")
      .select("test_version_id, weight, is_required, passing_score")
      .eq("package_id", assessment.assessment_package_id),
    admin
      .from("employee_assessment_competency_weights")
      .select("competency_key, weight, minimum_score, is_required")
      .eq("employee_assessment_id", participant.employee_assessment_id),
  ]);

  if (sessionsResult.error || packageTestsResult.error || weightsResult.error) {
    throw new Error("Unable to load employee scoring configuration.");
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
      .select("id, session_id, question_id, selected_option_id, answer_text, answer_json, time_spent_seconds")
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

  const calculations = sessions.map((session) =>
    scoreSession(
      session,
      packageTestsByVersion.get(session.test_version_id)!,
      questionsByVersion.get(session.test_version_id) ?? [],
      answersBySession.get(session.id) ?? [],
    ),
  );

  const answerUpdates = calculations.flatMap((calculation) =>
    [...calculation.answerScores.entries()].map(([answerId, scoredAnswer]) =>
      admin
        .from("employee_assessment_answers")
        .update({
          is_correct: scoredAnswer.isCorrect,
          points_awarded: scoredAnswer.pointsAwarded,
          raw_score: scoredAnswer.rawScore,
        })
        .eq("id", answerId),
    ),
  );
  const answerUpdateResults = await Promise.all(answerUpdates);
  if (answerUpdateResults.some((result) => result.error)) {
    throw new Error("Unable to save scored employee answers.");
  }

  const sessionScores = calculations.map((calculation) => calculation.score);
  const sessionUpdateResults = await Promise.all(
    sessionScores.map((score) =>
      admin
        .from("employee_assessment_sessions")
        .update({
          max_score: score.maxScore,
          percentage: score.percentage,
          score: score.rawScore,
        })
        .eq("id", score.session.id),
    ),
  );
  if (sessionUpdateResults.some((result) => result.error)) {
    throw new Error("Unable to save employee test session scoring.");
  }

  const { data: storedResults, error: resultsError } = await admin
    .from("employee_assessment_test_results")
    .upsert(
      sessionScores.map((score) => ({
        employee_id: participant.employee_id,
        max_score: score.maxScore,
        participant_id: participant.id,
        percentage: score.percentage,
        raw_score: score.rawScore,
        requires_review: score.requiresReview,
        scored_at: score.scoringResult?.scoredAt ?? null,
        scoring_engine_version: score.scoringResult?.engineVersion ?? null,
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
      })),
      { onConflict: "session_id" },
    )
    .select("id, session_id");

  if (resultsError || !storedResults) {
    throw new Error("Unable to save employee test results.");
  }

  const resultIdBySession = new Map(
    storedResults.map((result) => [result.session_id as string, result.id as string]),
  );
  const resultIds = [...resultIdBySession.values()];
  if (resultIds.length > 0) {
    const { error } = await admin
      .from("employee_assessment_competency_scores")
      .delete()
      .in("result_id", resultIds);
    if (error) {
      throw new Error("Unable to replace employee competency scores.");
    }
  }

  const competencyRows = sessionScores.flatMap((score) => {
    const resultId = resultIdBySession.get(score.session.id);
    if (!resultId) {
      return [];
    }

    return [...score.competencies.entries()].map(([key, total]) => ({
      competency_key: key,
      max_score: round(total.maxScore),
      participant_id: participant.id,
      percentage: competencyPercentage(total),
      result_id: resultId,
      score: round(total.score),
    }));
  });

  if (competencyRows.length > 0) {
    const { error } = await admin.from("employee_assessment_competency_scores").insert(competencyRows);
    if (error) {
      throw new Error("Unable to save employee competency scores.");
    }
  }

  const weights = (weightsResult.data ?? []) as unknown as WeightRecord[];
  const weightsByCompetency = new Map(weights.map((weight) => [weight.competency_key, weight]));
  const competencyTotals = combineCompetencies(sessionScores);
  const summaryRows = [...competencyTotals.entries()].map(([key, total]) => {
    const value = competencyPercentage(total);
    const weight = weightsByCompetency.get(key);
    const isBelowMinimum =
      !isMotivationCompetencyKey(key) &&
      Boolean(weight?.is_required && weight.minimum_score !== null && value !== null && value < weight.minimum_score);

    return {
      competency_key: key,
      is_below_minimum: isBelowMinimum,
      max_score: round(total.maxScore),
      participant_id: participant.id,
      percentage: value,
      score: round(total.score),
      weighted_score: value !== null && weight ? round(value * Number(weight.weight)) : null,
    };
  });

  const { error: removeSummaryError } = await admin
    .from("employee_assessment_competency_summary")
    .delete()
    .eq("participant_id", participant.id);
  if (removeSummaryError) {
    throw new Error("Unable to replace employee competency summary.");
  }

  if (summaryRows.length > 0) {
    const { error } = await admin.from("employee_assessment_competency_summary").insert(summaryRows);
    if (error) {
      throw new Error("Unable to save employee competency summary.");
    }
  }

  const autoScoredTests = sessionScores.filter(
    (score) =>
      !score.requiresReview &&
      score.scoringType !== "competency_profile" &&
      score.percentage !== null,
  );
  const overallWeight = autoScoredTests.reduce((sum, score) => sum + Number(score.packageTest.weight), 0);
  const overallScore =
    overallWeight > 0
      ? round(
          autoScoredTests.reduce(
            (sum, score) => sum + (score.percentage ?? 0) * Number(score.packageTest.weight),
            0,
          ) / overallWeight,
        )
      : null;

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

  const { error: removeRiskError } = await admin
    .from("employee_assessment_risk_flags")
    .delete()
    .eq("participant_id", participant.id)
    .eq("source", "scoring");
  if (removeRiskError) {
    throw new Error("Unable to replace employee scoring risk flags.");
  }

  if (riskFlags.length > 0) {
    const { error } = await admin.from("employee_assessment_risk_flags").insert(riskFlags);
    if (error) {
      throw new Error("Unable to save employee risk flags.");
    }
  }

  const requiresReview = sessionScores.some((score) => score.requiresReview);
  const riskLevel = riskLevelForFlags(riskFlags);
  const baseRecommendation = requiresReview
    ? "requires_review"
    : recommendationFromScore(fitScore ?? overallScore);
  const recommendation =
    riskLevel === "high" && (baseRecommendation === "strong_candidate" || baseRecommendation === "invite")
      ? "consider"
      : baseRecommendation;
  const strengths = summaryRows
    .filter(
      (row) =>
        !isMotivationCompetencyKey(row.competency_key) &&
        row.percentage !== null &&
        row.percentage >= 75,
    )
    .sort((left, right) => (right.percentage ?? 0) - (left.percentage ?? 0))
    .map((row) => ({
      competencyKey: row.competency_key,
      label: COMPETENCY_LABELS.get(row.competency_key) ?? row.competency_key,
      percentage: row.percentage,
    }));
  const interviewQuestions = createInterviewQuestions(summaryRows, requiresReview);

  const { error: participantUpdateError } = await admin
    .from("employee_assessment_participants")
    .update({
      fit_score: fitScore,
      overall_score: overallScore,
      recommendation,
      requires_review: requiresReview,
      risk_level: riskLevel,
    })
    .eq("id", participant.id);
  if (participantUpdateError) {
    throw new Error("Unable to save employee participant scoring.");
  }

  const { error: reportError } = await admin.from("employee_assessment_reports").upsert(
    {
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
    },
    { onConflict: "participant_id" },
  );
  if (reportError) {
    throw new Error("Unable to save employee assessment report.");
  }

  return {
    fitScore,
    overallScore,
    recommendation,
    requiresReview,
    riskLevel,
  };
}

/**
 * Rebuilds a completed assessment from persisted raw answers. The parent-level
 * scorer is used deliberately so aggregate competencies, fit and reports stay
 * consistent with the replaced session snapshot.
 */
export async function recalculateSessionScore(sessionId: string) {
  const admin = createAdminClient();
  const { data: candidateSession, error: candidateError } = await admin
    .from("test_sessions")
    .select("application_id, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (candidateError) {
    throw new Error("Unable to locate candidate session for recalculation.");
  }
  if (candidateSession) {
    if (candidateSession.status !== "completed") {
      throw new Error("Only completed sessions can be recalculated.");
    }
    return {
      scope: "candidate" as const,
      result: await scoreCompletedApplication(candidateSession.application_id as string),
    };
  }

  const { data: employeeSession, error: employeeError } = await admin
    .from("employee_assessment_sessions")
    .select("participant_id, status")
    .eq("id", sessionId)
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
  return {
    scope: "employee" as const,
    result: await scoreCompletedEmployeeAssessmentParticipant(
      employeeSession.participant_id as string,
    ),
  };
}
