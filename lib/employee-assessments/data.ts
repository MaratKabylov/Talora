import { createClient } from "@/lib/supabase/server";
import { renderStructuredAnswer } from "@/lib/answers/render-structured-answer";
import type { InvitationStatus, Recommendation, RiskLevel } from "@/lib/candidates/constants";
import type { CompetencyKey } from "@/lib/jobs/constants";
import {
  buildReportScoringDetails,
  type ReportScoringDetails,
} from "@/lib/reports/scoring-details";
import { countAnswerCorrectness } from "@/lib/reports/answer-counts";
import type {
  ReportIntegrityEventType,
  ReportIntegritySummary,
} from "@/lib/reports/data";
import type { QuestionType } from "@/lib/tests/builder-constants";
import { listAccessibleAssessmentPackages } from "@/lib/jobs/package-access";

import type {
  EmployeeAssessmentStatus,
  EmployeeParticipantStatus,
} from "./constants";

export type { AssessmentPackageOption } from "@/lib/jobs/package-access";

type Relation<T> = T | T[] | null;

type PackageRecord = {
  id: string;
  is_system: boolean;
  title: string;
};

type EmployeeAssessmentRecord = {
  assessment_package_id: string;
  assessment_packages: Relation<PackageRecord>;
  created_at: string;
  description: string | null;
  employee_assessment_participants?: Array<{
    fit_score: number | null;
    id: string;
    overall_score: number | null;
    status: EmployeeParticipantStatus;
  }> | null;
  id: string;
  passing_score: number | null;
  status: EmployeeAssessmentStatus;
  title: string;
  updated_at: string;
};

type WeightRecord = {
  competency_key: CompetencyKey;
  is_required: boolean;
  minimum_score: number | null;
  weight: number;
};

type EmployeeRecord = {
  department: string | null;
  email: string;
  full_name: string;
  id: string;
  phone: string | null;
  role_title: string | null;
};

type InvitationRecord = {
  created_at: string;
  expires_at: string | null;
  id: string;
  opened_at: string | null;
  sent_at: string | null;
  status: InvitationStatus;
  token: string;
};

type ParticipantRecord = {
  completed_at: string | null;
  created_at: string;
  current_stage: string | null;
  employee_assessment_invitations?: InvitationRecord[] | null;
  employee_assessment_competency_summary?: SummaryRecord[] | null;
  employee_id: string;
  employees: Relation<EmployeeRecord>;
  fit_score: number | null;
  id: string;
  overall_score: number | null;
  recommendation: Recommendation | string | null;
  requires_review: boolean;
  risk_level: RiskLevel | null;
  status: EmployeeParticipantStatus;
};

type SummaryRecord = {
  competency_key: CompetencyKey;
  percentage: number | null;
};

type ReportRecord = {
  fit_score: number | null;
  id: string;
  interview_questions_json: unknown;
  overall_score: number | null;
  recommendation: string | null;
  report_text: string | null;
  risks_json: unknown;
  strengths_json: unknown;
};

type EmployeeAnswerQuestion = {
  answer_options?: Array<{
    id: string;
    match_target_id: string;
    match_text: string | null;
    order_index: number;
    text: string;
  }> | null;
  order_index: number;
  question_type: QuestionType;
  text: string;
};

type EmployeeAnswerRecord = {
  answer_json: Record<string, unknown> | null;
  answer_text: string | null;
  id: string;
  is_correct: boolean | null;
  points_awarded: number | null;
  questions: Relation<EmployeeAnswerQuestion>;
  selected_option_id: string | null;
};

type SessionRecord = {
  completed_at: string | null;
  employee_assessment_test_results?: Array<{
    id: string;
    level: string | null;
    percentage: number | null;
    raw_score: number | null;
    requires_review: boolean;
    scoring_result_json: unknown;
  }> | null;
  employee_assessment_answers?: EmployeeAnswerRecord[] | null;
  id: string;
  percentage: number | null;
  score: number | null;
  started_at: string | null;
  status: string;
  test_versions: Relation<{
    id: string;
    title: string;
  }>;
};

type EmployeeIntegrityEventRecord = {
  client_occurred_at: string | null;
  event_type: ReportIntegrityEventType;
  id: number;
  occurred_at: string;
  questions: Relation<{ text: string }>;
  session_id: string;
};

type ReportParticipantRecord = Omit<ParticipantRecord, "employee_assessment_competency_summary"> & {
  employee_assessment_competency_summary?: Array<
    SummaryRecord & {
      is_below_minimum: boolean;
      max_score: number | null;
      score: number | null;
    }
  > | null;
  employee_assessment_reports: Relation<ReportRecord>;
  employee_assessment_sessions?: SessionRecord[] | null;
  employee_assessments: Relation<{
    id: string;
    title: string;
  }>;
};

export type EmployeeAssessmentListItem = {
  assessmentPackageTitle: string | null;
  completedCount: number;
  createdAt: string;
  description: string | null;
  id: string;
  invitedCount: number;
  averageFitScore: number | null;
  status: EmployeeAssessmentStatus;
  title: string;
  updatedAt: string;
};

export type EmployeeAssessmentDetails = {
  assessmentPackageId: string;
  assessmentPackageTitle: string | null;
  createdAt: string;
  description: string | null;
  id: string;
  passingScore: number | null;
  status: EmployeeAssessmentStatus;
  title: string;
  updatedAt: string;
};

export type EmployeeAssessmentWeight = {
  competencyKey: CompetencyKey;
  isRequired: boolean;
  minimumScore: number | null;
  weightPercent: number;
};

export type EmployeeAssessmentParticipant = {
  completedAt: string | null;
  createdAt: string;
  currentStage: string | null;
  employee: {
    department: string | null;
    email: string;
    fullName: string;
    id: string;
    phone: string | null;
    roleTitle: string | null;
  };
  fitScore: number | null;
  id: string;
  latestInvitation: {
    createdAt: string;
    expiresAt: string | null;
    id: string;
    openedAt: string | null;
    sentAt: string | null;
    status: InvitationStatus;
    token: string;
  } | null;
  overallScore: number | null;
  recommendation: string | null;
  requiresReview: boolean;
  riskLevel: RiskLevel | null;
  status: EmployeeParticipantStatus;
};

export type EmployeeAssessmentPageData = {
  assessment: EmployeeAssessmentDetails;
  packages: Awaited<ReturnType<typeof listAccessibleAssessmentPackages>>;
  participants: EmployeeAssessmentParticipant[];
  weights: EmployeeAssessmentWeight[];
};

export type EmployeeComparisonParticipant = Omit<EmployeeAssessmentParticipant, "latestInvitation"> & {
  competencies: Partial<Record<CompetencyKey, number | null>>;
};

export type EmployeeComparisonData = {
  assessment: {
    id: string;
    status: EmployeeAssessmentStatus;
    title: string;
  };
  participants: EmployeeComparisonParticipant[];
};

export type EmployeeAssessmentReportData = {
  assessment: {
    id: string;
    title: string;
  };
  employee: EmployeeAssessmentParticipant["employee"];
  integrity: ReportIntegritySummary;
  participant: Omit<EmployeeAssessmentParticipant, "employee" | "latestInvitation">;
  report: {
    fitScore: number | null;
    interviewQuestions: unknown[];
    overallScore: number | null;
    recommendation: string | null;
    reportText: string | null;
    risks: unknown[];
    strengths: unknown[];
  } | null;
  sessions: Array<{
    answers: Array<{
      answer: string;
      isCorrect: boolean | null;
      pointsAwarded: number | null;
      question: string;
      questionType: QuestionType;
    }>;
    completedAt: string | null;
    correctAnswersCount: number;
    id: string;
    incorrectAnswersCount: number;
    percentage: number | null;
    resultLevel: string | null;
    scoringDetails: ReportScoringDetails | null;
    score: number | null;
    startedAt: string | null;
    status: string;
    testTitle: string;
  }>;
  summary: Array<{
    competencyKey: CompetencyKey;
    isBelowMinimum: boolean;
    maxScore: number | null;
    percentage: number | null;
    score: number | null;
  }>;
};

function employeeIntegritySummary(
  events: EmployeeIntegrityEventRecord[],
  sessions: SessionRecord[],
): ReportIntegritySummary {
  const focusLossCount = events.filter((event) => event.event_type === "focus_lost").length;
  const clipboardAttemptCount = events.filter((event) =>
    ["clipboard_copy", "clipboard_cut", "clipboard_paste"].includes(event.event_type),
  ).length;
  const concurrentSessionAttemptCount = events.filter(
    (event) => event.event_type === "concurrent_session_blocked",
  ).length;
  const recoveredSessionCount = events.filter(
    (event) => event.event_type === "session_recovered",
  ).length;
  const timerExpiredCount = events.filter(
    (event) => event.event_type === "timer_expired",
  ).length;
  const focusLostAtBySession = new Map<string, number>();
  let focusLossDurationMs = 0;

  for (const event of events) {
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

  const testTitleBySession = new Map(
    sessions.map((session) => [session.id, related(session.test_versions)?.title ?? "Тест"]),
  );

  return {
    clipboardAttemptCount,
    concurrentSessionAttemptCount,
    events: events.map((event) => ({
      clientOccurredAt: event.client_occurred_at,
      eventType: event.event_type,
      id: event.id,
      occurredAt: event.occurred_at,
      question: related(event.questions)?.text ?? null,
      testTitle: testTitleBySession.get(event.session_id) ?? "Тест",
    })),
    focusLossCount,
    focusLossDurationSeconds: Math.round(focusLossDurationMs / 1000),
    recoveredSessionCount,
    status:
      concurrentSessionAttemptCount > 0
        ? "critical"
        : focusLossCount > 0 ||
            clipboardAttemptCount > 0 ||
            recoveredSessionCount > 0 ||
            timerExpiredCount > 0
          ? "attention"
          : "clear",
    timerExpiredCount,
  };
}

function renderEmployeeAnswer(
  answer: EmployeeAnswerRecord,
  question: EmployeeAnswerQuestion,
) {
  const options = question.answer_options ?? [];
  const structured = renderStructuredAnswer({
    answerJson: answer.answer_json,
    options,
    questionType: question.question_type,
  });
  if (structured !== null) return structured;
  if (question.question_type === "single_choice") {
    return options.find((option) => option.id === answer.selected_option_id)?.text ?? "Ответ не выбран";
  }
  if (question.question_type === "multiple_choice") {
    const ids = Array.isArray(answer.answer_json?.selectedOptionIds)
      ? answer.answer_json.selectedOptionIds.filter((id): id is string => typeof id === "string")
      : [];
    return options.filter((option) => ids.includes(option.id)).map((option) => option.text).join(", ") || "Ответ не выбран";
  }
  if (question.question_type === "forced_choice") {
    const mostOptionId = answer.answer_json?.mostOptionId;
    const leastOptionId = answer.answer_json?.leastOptionId;
    const mostText = typeof mostOptionId === "string"
      ? options.find((option) => option.id === mostOptionId)?.text
      : null;
    const leastText = typeof leastOptionId === "string"
      ? options.find((option) => option.id === leastOptionId)?.text
      : null;
    return `Больше всего: ${mostText ?? "не выбрано"}\nМеньше всего: ${leastText ?? "не выбрано"}`;
  }
  if (question.question_type === "scale") {
    return typeof answer.answer_json?.value === "number"
      ? String(answer.answer_json.value)
      : "Ответ не выбран";
  }
  return answer.answer_text ?? "Ответ не указан";
}

function related<T>(value: Relation<T>) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function normalizeAssessment(record: EmployeeAssessmentRecord): EmployeeAssessmentDetails {
  const assessmentPackage = related(record.assessment_packages);

  return {
    assessmentPackageId: record.assessment_package_id,
    assessmentPackageTitle: assessmentPackage?.title ?? null,
    createdAt: record.created_at,
    description: record.description,
    id: record.id,
    passingScore: record.passing_score,
    status: record.status,
    title: record.title,
    updatedAt: record.updated_at,
  };
}

function normalizeParticipant(record: ParticipantRecord): EmployeeAssessmentParticipant | null {
  const employee = related(record.employees);
  if (!employee) {
    return null;
  }

  const invitation = (record.employee_assessment_invitations ?? [])
    .slice()
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];

  return {
    completedAt: record.completed_at,
    createdAt: record.created_at,
    currentStage: record.current_stage,
    employee: {
      department: employee.department,
      email: employee.email,
      fullName: employee.full_name,
      id: employee.id,
      phone: employee.phone,
      roleTitle: employee.role_title,
    },
    fitScore: record.fit_score,
    id: record.id,
    latestInvitation: invitation
      ? {
          createdAt: invitation.created_at,
          expiresAt: invitation.expires_at,
          id: invitation.id,
          openedAt: invitation.opened_at,
          sentAt: invitation.sent_at,
          status: invitation.status,
          token: invitation.token,
        }
      : null,
    overallScore: record.overall_score,
    recommendation: record.recommendation,
    requiresReview: record.requires_review,
    riskLevel: record.risk_level,
    status: record.status,
  };
}

function jsonArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export async function listEmployeeAssessments(companyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_assessments")
    .select(
      "id, title, description, status, assessment_package_id, passing_score, created_at, updated_at, assessment_packages(id, title, is_system), employee_assessment_participants(id, status, overall_score, fit_score)",
    )
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error("Unable to load employee assessments.");
  }

  return ((data ?? []) as unknown as EmployeeAssessmentRecord[]).map((record) => {
    const assessment = normalizeAssessment(record);
    const participants = record.employee_assessment_participants ?? [];
    const fitScores = participants.flatMap((participant) =>
      participant.fit_score === null ? [] : [participant.fit_score],
    );

    return {
      assessmentPackageTitle: assessment.assessmentPackageTitle,
      averageFitScore:
        fitScores.length > 0
          ? fitScores.reduce((sum, score) => sum + score, 0) / fitScores.length
          : null,
      completedCount: participants.filter((participant) => participant.status === "completed")
        .length,
      createdAt: assessment.createdAt,
      description: assessment.description,
      id: assessment.id,
      invitedCount: participants.length,
      status: assessment.status,
      title: assessment.title,
      updatedAt: assessment.updatedAt,
    } satisfies EmployeeAssessmentListItem;
  });
}

export async function listEmployeeAssessmentPackages(companyId: string) {
  const supabase = await createClient();
  return listAccessibleAssessmentPackages(supabase, companyId);
}

export async function getEmployeeAssessmentPageData(companyId: string, assessmentId: string) {
  const supabase = await createClient();
  const [assessmentResult, weightsResult, participantsResult, packages] = await Promise.all([
    supabase
      .from("employee_assessments")
      .select(
        "id, title, description, status, assessment_package_id, passing_score, created_at, updated_at, assessment_packages(id, title, is_system)",
      )
      .eq("company_id", companyId)
      .eq("id", assessmentId)
      .maybeSingle(),
    supabase
      .from("employee_assessment_competency_weights")
      .select("competency_key, weight, minimum_score, is_required")
      .eq("company_id", companyId)
      .eq("employee_assessment_id", assessmentId),
    supabase
      .from("employee_assessment_participants")
      .select(
        "id, employee_id, status, current_stage, overall_score, fit_score, recommendation, risk_level, requires_review, completed_at, created_at, employees(id, full_name, email, phone, department, role_title), employee_assessment_invitations(id, token, status, expires_at, sent_at, opened_at, created_at)",
      )
      .eq("company_id", companyId)
      .eq("employee_assessment_id", assessmentId)
      .order("created_at", { ascending: false }),
    listAccessibleAssessmentPackages(supabase, companyId),
  ]);

  if (assessmentResult.error || weightsResult.error || participantsResult.error) {
    throw new Error("Unable to load employee assessment details.");
  }

  if (!assessmentResult.data) {
    return null;
  }

  return {
    assessment: normalizeAssessment(assessmentResult.data as unknown as EmployeeAssessmentRecord),
    packages,
    participants: ((participantsResult.data ?? []) as unknown as ParticipantRecord[])
      .map(normalizeParticipant)
      .filter((participant): participant is EmployeeAssessmentParticipant => participant !== null),
    weights: ((weightsResult.data ?? []) as WeightRecord[]).map((weight) => ({
      competencyKey: weight.competency_key,
      isRequired: weight.is_required,
      minimumScore: weight.minimum_score,
      weightPercent: Number(weight.weight) * 100,
    })),
  } satisfies EmployeeAssessmentPageData;
}

export async function getEmployeeComparisonData(companyId: string, assessmentId: string) {
  const supabase = await createClient();
  const [assessmentResult, participantsResult] = await Promise.all([
    supabase
      .from("employee_assessments")
      .select("id, title, status")
      .eq("company_id", companyId)
      .eq("id", assessmentId)
      .maybeSingle(),
    supabase
      .from("employee_assessment_participants")
      .select(
        "id, employee_id, status, current_stage, completed_at, created_at, overall_score, fit_score, recommendation, risk_level, requires_review, employees(id, full_name, email, phone, department, role_title), employee_assessment_competency_summary(competency_key, percentage)",
      )
      .eq("company_id", companyId)
      .eq("employee_assessment_id", assessmentId)
      .order("fit_score", { ascending: false, nullsFirst: false })
      .order("completed_at", { ascending: false, nullsFirst: false }),
  ]);

  if (assessmentResult.error || participantsResult.error) {
    throw new Error("Unable to load employee comparison.");
  }

  if (!assessmentResult.data) {
    return null;
  }

  const participants = ((participantsResult.data ?? []) as unknown as ParticipantRecord[])
    .map((record) => {
      const participant = normalizeParticipant(record);
      if (!participant) {
        return null;
      }

      return {
        completedAt: participant.completedAt,
        createdAt: participant.createdAt,
        currentStage: participant.currentStage,
        competencies: Object.fromEntries(
          (record.employee_assessment_competency_summary ?? []).map((summary) => [
            summary.competency_key,
            summary.percentage,
          ]),
        ) as Partial<Record<CompetencyKey, number | null>>,
        employee: participant.employee,
        fitScore: participant.fitScore,
        id: participant.id,
        overallScore: participant.overallScore,
        recommendation: participant.recommendation,
        requiresReview: participant.requiresReview,
        riskLevel: participant.riskLevel,
        status: participant.status,
      } satisfies EmployeeComparisonParticipant;
    })
    .filter((participant): participant is EmployeeComparisonParticipant => participant !== null);

  return {
    assessment: assessmentResult.data as {
      id: string;
      status: EmployeeAssessmentStatus;
      title: string;
    },
    participants,
  } satisfies EmployeeComparisonData;
}

export async function getEmployeeAssessmentReportData(companyId: string, participantId: string) {
  const supabase = await createClient();
  const [participantResult, integrityResult] = await Promise.all([
    supabase
      .from("employee_assessment_participants")
      .select(
        "id, employee_id, status, current_stage, completed_at, created_at, overall_score, fit_score, recommendation, risk_level, requires_review, employees(id, full_name, email, phone, department, role_title), employee_assessments(id, title), employee_assessment_reports(id, overall_score, fit_score, recommendation, strengths_json, risks_json, suggested_roles_json, interview_questions_json, report_text), employee_assessment_competency_summary(competency_key, score, max_score, percentage, is_below_minimum), employee_assessment_sessions(id, status, started_at, completed_at, score, percentage, test_versions(id, title), employee_assessment_test_results(id, percentage, raw_score, level, requires_review, scoring_result_json), employee_assessment_answers(id, selected_option_id, answer_text, answer_json, is_correct, points_awarded, questions(text, question_type, order_index, answer_options(id, text, match_text, match_target_id, order_index))))",
      )
      .eq("company_id", companyId)
      .eq("id", participantId)
      .maybeSingle(),
    supabase
      .from("employee_assessment_session_events")
      .select("id, session_id, event_type, occurred_at, client_occurred_at, questions(text)")
      .eq("company_id", companyId)
      .eq("participant_id", participantId)
      .order("occurred_at"),
  ]);
  const { data, error } = participantResult;

  if (error || integrityResult.error) {
    throw new Error("Unable to load employee assessment report.");
  }

  if (!data) {
    return null;
  }

  const record = data as unknown as ReportParticipantRecord;
  const employee = related(record.employees);
  const assessment = related(record.employee_assessments);
  if (!employee || !assessment) {
    return null;
  }

  const participant = normalizeParticipant(record);
  if (!participant) {
    return null;
  }

  const report = related(record.employee_assessment_reports);
  const sessions = record.employee_assessment_sessions ?? [];
  const integrityEvents = (integrityResult.data ?? []) as unknown as EmployeeIntegrityEventRecord[];

  return {
    assessment,
    employee: participant.employee,
    integrity: employeeIntegritySummary(integrityEvents, sessions),
    participant: {
      completedAt: participant.completedAt,
      createdAt: participant.createdAt,
      currentStage: participant.currentStage,
      fitScore: participant.fitScore,
      id: participant.id,
      overallScore: participant.overallScore,
      recommendation: participant.recommendation,
      requiresReview: participant.requiresReview,
      riskLevel: participant.riskLevel,
      status: participant.status,
    },
    report: report
      ? {
          fitScore: report.fit_score,
          interviewQuestions: jsonArray(report.interview_questions_json),
          overallScore: report.overall_score,
          recommendation: report.recommendation,
          reportText: report.report_text,
          risks: jsonArray(report.risks_json),
          strengths: jsonArray(report.strengths_json),
        }
      : null,
    sessions: sessions.map((session) => {
      const version = related(session.test_versions);
      const result = session.employee_assessment_test_results?.[0] ?? null;
      const answers = (session.employee_assessment_answers ?? [])
        .flatMap((answer) => {
          const question = related(answer.questions);
          return question
            ? [{
                answer: renderEmployeeAnswer(answer, question),
                isCorrect: answer.is_correct,
                pointsAwarded: answer.points_awarded,
                question: question.text,
                questionType: question.question_type,
                questionIndex: question.order_index,
              }]
            : [];
        })
        .sort((left, right) => left.questionIndex - right.questionIndex)
        .map((answer) => ({
          answer: answer.answer,
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
        percentage: session.percentage ?? result?.percentage ?? null,
        resultLevel: result?.level ?? null,
        scoringDetails: buildReportScoringDetails(result?.scoring_result_json),
        score: session.score ?? result?.raw_score ?? null,
        startedAt: session.started_at,
        status: session.status,
        testTitle: version?.title ?? "Тест",
      };
    }),
    summary: (record.employee_assessment_competency_summary ?? []).map((summary) => ({
      competencyKey: summary.competency_key,
      isBelowMinimum: summary.is_below_minimum,
      maxScore: summary.max_score,
      percentage: summary.percentage,
      score: summary.score,
    })),
  } satisfies EmployeeAssessmentReportData;
}
