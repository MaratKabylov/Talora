import "server-only";

import { COMPETENCIES, type CompetencyKey } from "@/lib/jobs/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QuestionType } from "@/lib/tests/builder-constants";

type ScoringType = "points" | "competency_profile" | "manual" | "mixed";

type Relation<T> = T | T[] | null;

type JobRecord = {
  assessment_package_id: string | null;
  id: string;
  passing_score: number | null;
};

type ApplicationRecord = {
  candidate_id: string;
  id: string;
  job_id: string;
  jobs: Relation<JobRecord>;
};

type VersionRecord = {
  scoring_type: ScoringType;
  title: string;
};

type SessionRecord = {
  id: string;
  status: string;
  test_version_id: string;
  test_versions: Relation<VersionRecord>;
};

type PackageTestRecord = {
  is_required: boolean;
  passing_score: number | null;
  test_version_id: string;
  weight: number;
};

type WeightRecord = {
  competency_key: CompetencyKey;
  is_required: boolean;
  minimum_score: number | null;
  weight: number;
};

type OptionRecord = {
  competency_effect_json: Record<string, number> | null;
  id: string;
  is_correct: boolean | null;
  points: number;
};

type QuestionRecord = {
  answer_options?: OptionRecord[] | null;
  competency_key: CompetencyKey | null;
  id: string;
  points: number;
  question_type: QuestionType;
  settings_json: { max?: number; min?: number } | null;
};

type SectionRecord = {
  questions?: QuestionRecord[] | null;
  test_version_id: string;
};

type AnswerRecord = {
  answer_json: Record<string, unknown> | null;
  answer_text: string | null;
  id: string;
  question_id: string;
  selected_option_id: string | null;
  session_id: string;
};

type CompetencyTotal = {
  maxScore: number;
  score: number;
};

type SessionScore = {
  competencies: Map<CompetencyKey, CompetencyTotal>;
  maxScore: number;
  packageTest: PackageTestRecord;
  percentage: number | null;
  rawScore: number;
  requiresReview: boolean;
  scoringType: ScoringType;
  session: SessionRecord;
};

const COMPETENCY_KEYS = new Set<CompetencyKey>(
  COMPETENCIES.map((competency) => competency.key),
);
const COMPETENCY_LABELS = new Map(
  COMPETENCIES.map((competency) => [competency.key, competency.label]),
);

function related<T>(value: Relation<T>) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function percentage(score: number, maxScore: number) {
  return maxScore > 0 ? round(Math.min(Math.max((score / maxScore) * 100, 0), 100)) : null;
}

function isCompetencyKey(value: string): value is CompetencyKey {
  return COMPETENCY_KEYS.has(value as CompetencyKey);
}

function isMotivationCompetency(key: CompetencyKey) {
  return key.startsWith("motivation_");
}

function addCompetency(
  competencies: Map<CompetencyKey, CompetencyTotal>,
  key: CompetencyKey,
  score: number,
  maxScore: number,
) {
  if (maxScore <= 0) {
    return;
  }

  const existing = competencies.get(key) ?? { maxScore: 0, score: 0 };
  existing.score += Math.min(Math.max(score, 0), maxScore);
  existing.maxScore += maxScore;
  competencies.set(key, existing);
}

function getResultLevel(value: number | null, requiresReview: boolean, scoringType: ScoringType) {
  if (requiresReview || scoringType === "manual") {
    return "requires_review";
  }

  if (scoringType === "competency_profile") {
    return "profile";
  }

  if (value === null) {
    return "not_scored";
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

function scoreSession(
  session: SessionRecord,
  packageTest: PackageTestRecord,
  questions: QuestionRecord[],
  answers: AnswerRecord[],
) {
  const version = related(session.test_versions);
  if (!version) {
    throw new Error("Unable to determine test scoring type.");
  }

  const answersByQuestion = new Map(answers.map((answer) => [answer.question_id, answer]));
  const competencies = new Map<CompetencyKey, CompetencyTotal>();
  const answerScores = new Map<string, { isCorrect: boolean | null; pointsAwarded: number | null }>();
  let rawScore = 0;
  let maxScore = 0;
  let requiresReview = version.scoring_type === "manual";

  for (const question of questions) {
    const answer = answersByQuestion.get(question.id);
    const options = question.answer_options ?? [];

    if (question.question_type === "single_choice") {
      const selectedOption = options.find((option) => option.id === answer?.selected_option_id);
      const questionMax = Math.max(
        numberValue(question.points),
        ...options.map((option) => numberValue(option.points)),
        0,
      );
      const pointsAwarded = selectedOption ? numberValue(selectedOption.points) : 0;

      rawScore += pointsAwarded;
      maxScore += questionMax;

      if (answer) {
        answerScores.set(answer.id, {
          isCorrect: selectedOption?.is_correct ?? null,
          pointsAwarded: round(pointsAwarded),
        });
      }

      const effectKeys = new Set(
        options.flatMap((option) => Object.keys(option.competency_effect_json ?? {})),
      );

      if (effectKeys.size > 0) {
        for (const key of effectKeys) {
          if (!isCompetencyKey(key)) {
            continue;
          }

          const effectMax = Math.max(
            ...options.map((option) => numberValue(option.competency_effect_json?.[key])),
            0,
          );
          const selectedEffect = numberValue(selectedOption?.competency_effect_json?.[key]);
          addCompetency(competencies, key, selectedEffect, effectMax);
        }
      } else if (question.competency_key) {
        addCompetency(competencies, question.competency_key, pointsAwarded, questionMax);
      }

      continue;
    }

    if (question.question_type === "scale") {
      const minimum = numberValue(question.settings_json?.min, 1);
      const maximum = numberValue(question.settings_json?.max, 5);
      const answerValue =
        typeof answer?.answer_json?.value === "number" && Number.isFinite(answer.answer_json.value)
          ? answer.answer_json.value
          : null;
      const boundedValue =
        answerValue === null ? 0 : Math.min(Math.max(answerValue, minimum), maximum);

      rawScore += boundedValue;
      maxScore += maximum;

      if (answer) {
        answerScores.set(answer.id, {
          isCorrect: null,
          pointsAwarded: round(boundedValue),
        });
      }

      if (question.competency_key) {
        addCompetency(competencies, question.competency_key, boundedValue, maximum);
      }

      continue;
    }

    // Unsupported and free-text responses must be reviewed before they influence a decision.
    requiresReview = true;
    if (answer) {
      answerScores.set(answer.id, { isCorrect: null, pointsAwarded: null });
    }
  }

  return {
    answerScores,
    score: {
      competencies,
      maxScore: round(maxScore),
      packageTest,
      percentage: percentage(rawScore, maxScore),
      rawScore: round(rawScore),
      requiresReview,
      scoringType: version.scoring_type,
      session,
    } satisfies SessionScore,
  };
}

function combineCompetencies(sessionScores: SessionScore[]) {
  const totals = new Map<CompetencyKey, CompetencyTotal>();

  for (const sessionScore of sessionScores) {
    for (const [key, score] of sessionScore.competencies) {
      addCompetency(totals, key, score.score, score.maxScore);
    }
  }

  return totals;
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

export async function scoreCompletedApplication(applicationId: string) {
  const admin = createAdminClient();
  const { data: applicationData, error: applicationError } = await admin
    .from("candidate_applications")
    .select("id, candidate_id, job_id, jobs(id, assessment_package_id, passing_score)")
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
      .select("id, status, test_version_id, test_versions(title, scoring_type)")
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
        "test_version_id, questions(id, question_type, points, competency_key, settings_json, answer_options(id, is_correct, points, competency_effect_json))",
      )
      .in("test_version_id", testVersionIds),
    admin
      .from("candidate_answers")
      .select("id, session_id, question_id, selected_option_id, answer_text, answer_json")
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
        session_id: score.session.id,
        summary: score.requiresReview
          ? "Содержит ответы, требующие ручной проверки."
          : score.scoringType === "competency_profile"
            ? "Профильная шкала без оценки правильности."
            : null,
        test_version_id: score.session.test_version_id,
        level: getResultLevel(score.percentage, score.requiresReview, score.scoringType),
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
      percentage: percentage(total.score, total.maxScore),
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
    const value = percentage(total.score, total.maxScore);
    const weight = weightsByCompetency.get(key);
    const isBelowMinimum =
      !isMotivationCompetency(key) &&
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
  const fitComponents = summaryRows.filter((row) => {
    const weight = weightsByCompetency.get(row.competency_key);
    return !isMotivationCompetency(row.competency_key) && row.percentage !== null && weight && Number(weight.weight) > 0;
  });
  const fitWeight = fitComponents.reduce(
    (sum, row) => sum + Number(weightsByCompetency.get(row.competency_key)!.weight),
    0,
  );
  const fitScore =
    fitWeight > 0
      ? round(
          fitComponents.reduce(
            (sum, row) =>
              sum + (row.percentage ?? 0) * Number(weightsByCompetency.get(row.competency_key)!.weight),
            0,
          ) / fitWeight,
        )
      : null;

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

  const { error: applicationUpdateError } = await admin
    .from("candidate_applications")
    .update({
      fit_score: fitScore,
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
      fit_score: fitScore,
      job_id: application.job_id,
      overall_score: overallScore,
      recommendation,
      risk_level: riskLevel,
    },
    { onConflict: "application_id" },
  );
  if (comparisonError) {
    throw new Error("Unable to save comparison scoring.");
  }

  return {
    fitScore,
    overallScore,
    recommendation,
    requiresReview,
    riskLevel,
  };
}
