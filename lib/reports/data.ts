import { createClient } from "@/lib/supabase/server";
import { renderStructuredAnswer } from "@/lib/answers/render-structured-answer";
import {
  collectAssessmentDimensions,
  extractScoringDefinitionMetadata,
} from "@/lib/assessment-results/collect-dimensions";
import { buildAssessmentHighlights } from "@/lib/assessment-results/highlights";
import {
  getLegacyAssessmentDimension,
  isLegacyMotivationDimension,
} from "@/lib/assessment-results/legacy-registry";
import { summarizeAssessmentDimensions } from "@/lib/assessment-results/summarize-dimensions";
import type {
  AssessmentDimensionGroup,
  AssessmentDimensionResult,
  AssessmentHighlight,
} from "@/lib/assessment-results/types";

import type { ApplicationStatus } from "@/lib/candidates/constants";
import { COMPETENCIES, type CompetencyKey } from "@/lib/jobs/constants";
import type { QuestionType } from "@/lib/tests/builder-constants";
import {
  normalizeAssessmentCompositeResult,
  type AssessmentCompositeResult,
} from "@/lib/scoring/models/assessment-composite";
import {
  interpretReportScore,
  parseInterpretationPolicy,
  type InterpretationDirection,
  type InterpretationPolicy,
} from "@/lib/scoring/interpretation-policy";
import {
  buildReportScoringDetails,
  type ReportScoringDetails,
} from "@/lib/reports/scoring-details";
import { countAnswerCorrectness } from "@/lib/reports/answer-counts";
import { resolveReportTestTitle } from "@/lib/reports/test-title";

type Relation<T> = T | T[] | null;

type CandidateRecord = {
  city: string | null;
  email: string | null;
  full_name: string | null;
  phone: string | null;
};

type JobRecord = {
  id: string;
  interpretation_policy_json: unknown;
  title: string;
};

type ApplicationRecord = {
  behavior_fit: number | null;
  candidates: Relation<CandidateRecord>;
  completed_at: string | null;
  composite_result_json: unknown;
  composite_score: number | null;
  fit_score: number | null;
  id: string;
  jobs: Relation<JobRecord>;
  motivation_fit: number | null;
  overall_score: number | null;
  recommendation: string | null;
  requires_review: boolean;
  risk_level: "low" | "medium" | "high" | null;
  status: ApplicationStatus;
};

type SummaryRecord = {
  competency_key: CompetencyKey;
  interpretation_direction: InterpretationDirection | null;
  is_below_minimum: boolean;
  percentage: number | null;
  weighted_score: number | null;
};

type RiskRecord = {
  description: string | null;
  id: string;
  risk_level: "low" | "medium" | "high";
  title: string;
};

type VersionRecord = {
  assessment_domain: string | null;
  id: string;
  result_shape: string | null;
  scoring_config_json: unknown;
  scoring_schema_version: string | null;
  scoring_type: string;
  title: string;
};

type SessionRecord = {
  completed_at: string | null;
  deadline_at: string | null;
  id: string;
  percentage: number | null;
  started_at: string | null;
  status: string;
  submission_reason: "candidate" | "time_expired" | null;
  test_versions: Relation<VersionRecord>;
};

type IntegrityQuestionRecord = {
  text: string;
};

type IntegrityEventRecord = {
  client_occurred_at: string | null;
  event_type: ReportIntegrityEventType;
  id: number;
  occurred_at: string;
  questions: Relation<IntegrityQuestionRecord>;
  session_id: string;
};

type ResultRecord = {
  level: string | null;
  max_score: number | null;
  percentage: number | null;
  raw_score: number | null;
  requires_review: boolean;
  scoring_result_json: unknown;
  session_id: string;
  summary: string | null;
};

type OptionRecord = {
  id: string;
  match_target_id: string;
  match_text: string | null;
  order_index: number;
  text: string;
};

type SectionRecord = {
  order_index: number;
  title: string;
};

type QuestionRecord = {
  answer_options?: OptionRecord[] | null;
  competency_key: CompetencyKey | null;
  order_index: number;
  question_type: QuestionType;
  test_sections: Relation<SectionRecord>;
  text: string;
};

type AnswerRecord = {
  answer_json: Record<string, unknown> | null;
  answer_text: string | null;
  id: string;
  is_correct: boolean | null;
  points_awarded: number | null;
  questions: Relation<QuestionRecord>;
  selected_option_id: string | null;
  session_id: string;
};

type GeneratedReportRecord = {
  interview_questions_json: unknown;
  report_text: string | null;
  strengths_json: unknown;
};

export type ReportCompetency = {
  interpretationDirection: InterpretationDirection;
  isBelowMinimum: boolean;
  isMotivation: boolean;
  key: CompetencyKey;
  label: string;
  percentage: number | null;
  weightedScore: number | null;
};

export type ReportRisk = {
  description: string | null;
  id: string;
  level: "low" | "medium" | "high";
  title: string;
};

export type ReportAnswer = {
  answer: string;
  competencyLabel: string | null;
  isCorrect: boolean | null;
  pointsAwarded: number | null;
  question: string;
  questionType: QuestionType;
};

export type ReportTest = {
  answers: ReportAnswer[];
  completedAt: string | null;
  correctAnswersCount: number;
  id: string;
  incorrectAnswersCount: number;
  level: string | null;
  percentage: number | null;
  rawScore: number | null;
  maxScore: number | null;
  requiresReview: boolean;
  scoringDetails: ReportScoringDetails | null;
  scoringType: string | null;
  startedAt: string | null;
  status: "not_started" | "in_progress" | "completed" | "expired" | "cancelled";
  summary: string | null;
  title: string;
};

export type ReportIntegrityEventType =
  | "focus_lost"
  | "focus_returned"
  | "clipboard_copy"
  | "clipboard_cut"
  | "clipboard_paste"
  | "concurrent_session_blocked"
  | "session_recovered"
  | "timer_expired";

export type ReportIntegrityEvent = {
  clientOccurredAt: string | null;
  eventType: ReportIntegrityEventType;
  id: number;
  occurredAt: string;
  question: string | null;
  testTitle: string;
};

export type ReportIntegritySummary = {
  clipboardAttemptCount: number;
  concurrentSessionAttemptCount: number;
  events: ReportIntegrityEvent[];
  focusLossCount: number;
  focusLossDurationSeconds: number;
  recoveredSessionCount: number;
  status: "clear" | "attention" | "critical";
  timerExpiredCount: number;
};

export type CandidateReportData = {
  behaviorFit: number | null;
  candidate: {
    city: string | null;
    email: string | null;
    fullName: string;
    phone: string | null;
  };
  completedAt: string | null;
  compositeResult: AssessmentCompositeResult | null;
  compositeScore: number | null;
  competencies: ReportCompetency[];
  dimensions: AssessmentDimensionResult[];
  fitScore: number | null;
  id: string;
  integrity: ReportIntegritySummary;
  groups: AssessmentDimensionGroup[];
  highlights: AssessmentHighlight[];
  interviewQuestions: string[];
  job: { id: string; title: string };
  motivationFit: number | null;
  overallScore: number | null;
  recommendation: string | null;
  reportText: string | null;
  requiresReview: boolean;
  risks: ReportRisk[];
  riskLevel: "low" | "medium" | "high" | null;
  status: ApplicationStatus;
  strengths: ReportCompetency[];
  tests: ReportTest[];
};

const COMPETENCY_LABELS = new Map(
  COMPETENCIES.map((competency) => [competency.key, competency.label]),
);

function related<T>(value: Relation<T>) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function renderAnswer(record: AnswerRecord, question: QuestionRecord) {
  const options = question.answer_options ?? [];
  const structured = renderStructuredAnswer({
    answerJson: record.answer_json,
    options,
    questionType: question.question_type,
  });
  if (structured !== null) return structured;
  if (question.question_type === "single_choice") {
    return options.find((option) => option.id === record.selected_option_id)?.text ?? "Ответ не выбран";
  }

  if (question.question_type === "multiple_choice") {
    const ids = Array.isArray(record.answer_json?.selectedOptionIds)
      ? record.answer_json.selectedOptionIds.filter((id): id is string => typeof id === "string")
      : [];
    const texts = options.filter((option) => ids.includes(option.id)).map((option) => option.text);
    return texts.join(", ") || "Ответ не выбран";
  }

  if (question.question_type === "forced_choice") {
    const mostOptionId = record.answer_json?.mostOptionId;
    const leastOptionId = record.answer_json?.leastOptionId;
    const mostText =
      typeof mostOptionId === "string"
        ? options.find((option) => option.id === mostOptionId)?.text
        : null;
    const leastText =
      typeof leastOptionId === "string"
        ? options.find((option) => option.id === leastOptionId)?.text
        : null;
    return `Больше всего: ${mostText ?? "не выбрано"}\nМеньше всего: ${leastText ?? "не выбрано"}`;
  }

  if (question.question_type === "scale") {
    const value = record.answer_json?.value;
    return typeof value === "number" ? String(value) : "Ответ не выбран";
  }

  return record.answer_text ?? "Ответ не указан";
}

function createInterviewQuestions(
  competencies: ReportCompetency[],
  requiresReview: boolean,
  interpretationPolicy: InterpretationPolicy,
) {
  const questions = competencies
    .filter(
      (competency) =>
        competency.percentage !== null &&
        (competency.isBelowMinimum ||
          interpretReportScore(competency.percentage, interpretationPolicy, {
            competencyKey: competency.key,
            direction: competency.interpretationDirection,
          })?.band === "development_area"),
    )
    .map(
      (competency) =>
        `Попросите привести пример ситуации, где проявлялась компетенция «${competency.label}», и уточните ход решения.`,
    );

  if (requiresReview) {
    questions.push("Уточните контекст и ход рассуждений в развернутых ответах кандидата.");
  }

  return questions.length > 0
    ? questions
    : ["Обсудите наиболее релевантный опыт кандидата и его вклад в похожей роли."];
}

export async function getCandidateReportData(companyId: string, applicationId: string) {
  const supabase = await createClient();
  const { data: applicationData, error: applicationError } = await supabase
    .from("candidate_applications")
    .select(
      "id, status, completed_at, overall_score, fit_score, motivation_fit, behavior_fit, composite_score, composite_result_json, recommendation, risk_level, requires_review, candidates(full_name, email, phone, city), jobs(id, title, interpretation_policy_json)",
    )
    .eq("company_id", companyId)
    .eq("id", applicationId)
    .maybeSingle();

  if (applicationError) {
    throw new Error("Unable to load candidate report application.");
  }

  if (!applicationData) {
    return null;
  }

  const application = applicationData as unknown as ApplicationRecord;
  const candidate = related(application.candidates);
  const job = related(application.jobs);
  if (!candidate || !job) {
    return null;
  }
  const interpretationPolicy = parseInterpretationPolicy(job.interpretation_policy_json);

  const [
    summaryResult,
    risksResult,
    sessionsResult,
    resultsResult,
    generatedReportResult,
    integrityEventsResult,
    weightsResult,
  ] =
    await Promise.all([
      supabase
        .from("application_competency_summary")
        .select("competency_key, percentage, weighted_score, is_below_minimum, interpretation_direction")
        .eq("application_id", applicationId),
      supabase
        .from("candidate_risk_flags")
        .select("id, title, description, risk_level")
        .eq("application_id", applicationId)
        .order("created_at"),
      supabase
        .from("test_sessions")
        .select(
          "id, status, percentage, started_at, deadline_at, completed_at, submission_reason, test_versions(id, title, scoring_type, scoring_schema_version, assessment_domain, result_shape, scoring_config_json)",
        )
        .eq("application_id", applicationId)
        .order("created_at"),
      supabase
        .from("test_results")
        .select("session_id, raw_score, max_score, percentage, level, summary, requires_review, scoring_result_json")
        .eq("application_id", applicationId),
      supabase
        .from("candidate_reports")
        .select("strengths_json, interview_questions_json, report_text")
        .eq("application_id", applicationId)
        .maybeSingle(),
      supabase
        .from("assessment_session_events")
        .select(
          "id, session_id, event_type, occurred_at, client_occurred_at, questions(text)",
        )
        .eq("application_id", applicationId)
        .order("occurred_at"),
      supabase
        .from("job_competency_weights")
        .select("competency_key, minimum_score")
        .eq("job_id", job.id),
    ]);

  if (
    summaryResult.error ||
    risksResult.error ||
    sessionsResult.error ||
    resultsResult.error ||
    generatedReportResult.error ||
    integrityEventsResult.error ||
    weightsResult.error
  ) {
    throw new Error("Unable to load candidate report results.");
  }

  const sessions = (sessionsResult.data ?? []) as unknown as SessionRecord[];
  const versionIds = Array.from(
    new Set(
      sessions.flatMap((session) => {
        const version = related(session.test_versions);
        return version ? [version.id] : [];
      }),
    ),
  );
  const versionsResult =
    versionIds.length === 0
      ? { data: [] as Array<{ id: string; test_template_id: string }>, error: null }
      : await supabase.from("test_versions").select("id, test_template_id").in("id", versionIds);
  const templateIds = Array.from(
    new Set((versionsResult.data ?? []).map((version) => version.test_template_id)),
  );
  const templatesResult =
    versionsResult.error || templateIds.length === 0
      ? { data: [] as Array<{ id: string; title: string }>, error: null }
      : await supabase.from("test_templates").select("id, title").in("id", templateIds);
  const templateTitlesById = new Map(
    (templatesResult.data ?? []).map((template) => [template.id, template.title]),
  );
  const templateTitlesByVersionId = new Map(
    (versionsResult.data ?? []).flatMap((version) => {
      const title = templateTitlesById.get(version.test_template_id);
      return title ? [[version.id, title] as const] : [];
    }),
  );
  const testTitleBySession = new Map(
    sessions.map((session) => {
      const version = related(session.test_versions);

      return [
        session.id,
        resolveReportTestTitle(
          version ? templateTitlesByVersionId.get(version.id) : null,
          version?.title,
        ),
      ];
    }),
  );
  const sessionIds = sessions.map((session) => session.id);
  const { data: answersData, error: answersError } =
    sessionIds.length === 0
      ? { data: [] as unknown[], error: null }
      : await supabase
          .from("candidate_answers")
          .select(
            "id, session_id, selected_option_id, answer_text, answer_json, is_correct, points_awarded, questions(text, question_type, competency_key, order_index, test_sections(title, order_index), answer_options(id, text, match_text, match_target_id, order_index))",
          )
          .in("session_id", sessionIds);

  if (answersError) {
    throw new Error("Unable to load candidate answers.");
  }

  for (const answer of (answersData ?? []) as unknown as AnswerRecord[]) {
    const question = related(answer.questions);
    if (
      answer.selected_option_id &&
      question &&
      !(question.answer_options ?? []).some((option) => option.id === answer.selected_option_id)
    ) {
      throw new Error("Unable to load candidate report answer options.");
    }
  }

  const competencies = ((summaryResult.data ?? []) as unknown as SummaryRecord[])
    .map((summary) => {
      const legacyDimension = getLegacyAssessmentDimension(summary.competency_key);
      return {
        isBelowMinimum: summary.is_below_minimum,
        isMotivation: isLegacyMotivationDimension(summary.competency_key),
        interpretationDirection:
          summary.interpretation_direction ??
          (legacyDimension?.interpretationDirection === "neutral" ? "neutral" : "higher_is_better"),
        key: summary.competency_key,
        label: legacyDimension?.title ?? COMPETENCY_LABELS.get(summary.competency_key) ?? summary.competency_key,
        percentage: summary.percentage,
        weightedScore: summary.weighted_score,
      };
    })
    .sort((left, right) => (right.percentage ?? -1) - (left.percentage ?? -1));
  const risks = ((risksResult.data ?? []) as RiskRecord[]).map((risk) => ({
    description: risk.description,
    id: risk.id,
    level: risk.risk_level,
    title: risk.title,
  }));
  const resultsBySession = new Map(
    ((resultsResult.data ?? []) as ResultRecord[]).map((result) => [result.session_id, result]),
  );
  const minimumScoreByCompetency = new Map(
    ((weightsResult.data ?? []) as Array<{
      competency_key: CompetencyKey;
      minimum_score: number | null;
    }>).map((weight) => [weight.competency_key, weight.minimum_score]),
  );
  const dimensions = collectAssessmentDimensions({
    legacy: ((summaryResult.data ?? []) as unknown as SummaryRecord[]).map((summary) => ({
      interpretationDirection: summary.interpretation_direction,
      isBelowMinimum: summary.is_below_minimum,
      key: summary.competency_key,
      minimumScore: minimumScoreByCompetency.get(summary.competency_key) ?? null,
      percentage: summary.percentage,
    })),
    sessions: sessions.map((session) => ({
      definition: extractScoringDefinitionMetadata(related(session.test_versions)?.scoring_config_json),
      scoringResult: resultsBySession.get(session.id)?.scoring_result_json,
    })),
  });
  const groups = summarizeAssessmentDimensions(dimensions);
  const highlights = buildAssessmentHighlights(groups);
  const answersBySession = new Map<string, AnswerRecord[]>();

  for (const answer of (answersData ?? []) as unknown as AnswerRecord[]) {
    const existing = answersBySession.get(answer.session_id) ?? [];
    existing.push(answer);
    answersBySession.set(answer.session_id, existing);
  }

  const tests = sessions.map((session) => {
    const version = related(session.test_versions);
    const result = resultsBySession.get(session.id);
    const scoringDetails = buildReportScoringDetails(result?.scoring_result_json);
    const answers = (answersBySession.get(session.id) ?? [])
      .flatMap((answer) => {
        const question = related(answer.questions);
        return question
          ? [
              {
                answer: renderAnswer(answer, question),
                competencyLabel: question.competency_key
                  ? COMPETENCY_LABELS.get(question.competency_key) ?? question.competency_key
                  : null,
                isCorrect: answer.is_correct,
                pointsAwarded: answer.points_awarded,
                question: question.text,
                questionType: question.question_type,
                sectionIndex: related(question.test_sections)?.order_index ?? 0,
                questionIndex: question.order_index,
              },
            ]
          : [];
      })
      .sort(
        (left, right) =>
          left.sectionIndex - right.sectionIndex || left.questionIndex - right.questionIndex,
      )
      .map((answer) => ({
        answer: answer.answer,
        competencyLabel: answer.competencyLabel,
        isCorrect: answer.isCorrect,
        pointsAwarded: answer.pointsAwarded,
        question: answer.question,
        questionType: answer.questionType,
      }));
    const answerCounts = countAnswerCorrectness(answers);

    return {
      answers,
      completedAt: session.completed_at,
      correctAnswersCount: answerCounts.correct,
      id: session.id,
      incorrectAnswersCount: answerCounts.incorrect,
      level: result?.level ?? null,
      maxScore: result?.max_score ?? null,
      percentage: result?.percentage ?? session.percentage,
      rawScore: result?.raw_score ?? null,
      requiresReview: result?.requires_review ?? false,
      scoringDetails,
      scoringType: version?.scoring_type ?? null,
      startedAt: session.started_at,
      status: session.status as ReportTest["status"],
      summary: result?.summary ?? null,
      title: resolveReportTestTitle(
        version ? templateTitlesByVersionId.get(version.id) : null,
        version?.title,
      ),
    };
  });
  const storedReport = generatedReportResult.data as GeneratedReportRecord | null;
  const strengths = competencies.filter(
    (competency) =>
      competency.percentage !== null &&
      interpretReportScore(competency.percentage, interpretationPolicy, {
        competencyKey: competency.key,
        direction: competency.interpretationDirection,
      })?.band === "strength",
  );
  const storedQuestions = stringArray(storedReport?.interview_questions_json);
  const integrityRecords = (integrityEventsResult.data ?? []) as unknown as IntegrityEventRecord[];
  const focusLossCount = integrityRecords.filter((event) => event.event_type === "focus_lost").length;
  const clipboardAttemptCount = integrityRecords.filter((event) =>
    ["clipboard_copy", "clipboard_cut", "clipboard_paste"].includes(event.event_type),
  ).length;
  const concurrentSessionAttemptCount = integrityRecords.filter(
    (event) => event.event_type === "concurrent_session_blocked",
  ).length;
  const recoveredSessionCount = integrityRecords.filter(
    (event) => event.event_type === "session_recovered",
  ).length;
  const timerExpiredCount = integrityRecords.filter(
    (event) => event.event_type === "timer_expired",
  ).length;
  const focusLostAtBySession = new Map<string, number>();
  let focusLossDurationMs = 0;
  for (const event of integrityRecords) {
    const occurredAt = new Date(event.occurred_at).getTime();
    if (event.event_type === "focus_lost" && !focusLostAtBySession.has(event.session_id)) {
      focusLostAtBySession.set(event.session_id, occurredAt);
    }
    if (event.event_type === "focus_returned") {
      const lostAt = focusLostAtBySession.get(event.session_id);
      if (lostAt !== undefined) {
        focusLossDurationMs += Math.max(occurredAt - lostAt, 0);
        focusLostAtBySession.delete(event.session_id);
      }
    }
  }
  for (const [sessionId, lostAt] of focusLostAtBySession) {
    const session = sessions.find((entry) => entry.id === sessionId);
    const endedAt = session?.completed_at ? new Date(session.completed_at).getTime() : Date.now();
    focusLossDurationMs += Math.max(endedAt - lostAt, 0);
  }
  const focusLossDurationSeconds = Math.round(focusLossDurationMs / 1000);
  const integrityStatus =
    concurrentSessionAttemptCount > 0
      ? "critical"
      : focusLossCount > 0 ||
          clipboardAttemptCount > 0 ||
          recoveredSessionCount > 0 ||
          timerExpiredCount > 0
        ? "attention"
        : "clear";

  return {
    behaviorFit: application.behavior_fit,
    candidate: {
      city: candidate.city,
      email: candidate.email,
      fullName: candidate.full_name ?? "Без имени",
      phone: candidate.phone,
    },
    completedAt: application.completed_at,
    compositeResult: normalizeAssessmentCompositeResult(application.composite_result_json),
    compositeScore: application.composite_score,
    competencies,
    dimensions,
    fitScore: application.fit_score,
    id: application.id,
    integrity: {
      clipboardAttemptCount,
      concurrentSessionAttemptCount,
      events: integrityRecords.map((event) => ({
        clientOccurredAt: event.client_occurred_at,
        eventType: event.event_type,
        id: event.id,
        occurredAt: event.occurred_at,
        question: related(event.questions)?.text ?? null,
        testTitle: testTitleBySession.get(event.session_id) ?? "Тест",
      })),
      focusLossCount,
      focusLossDurationSeconds,
      recoveredSessionCount,
      status: integrityStatus,
      timerExpiredCount,
    },
    groups,
    highlights,
    interviewQuestions:
      storedQuestions.length > 0
        ? storedQuestions
        : createInterviewQuestions(
            competencies,
            application.requires_review,
            interpretationPolicy,
          ),
    job: { id: job.id, title: job.title },
    motivationFit: application.motivation_fit,
    overallScore: application.overall_score,
    recommendation: application.recommendation,
    reportText: storedReport?.report_text ?? null,
    requiresReview: application.requires_review,
    risks,
    riskLevel: application.risk_level,
    status: application.status,
    strengths,
    tests,
  } satisfies CandidateReportData;
}
