import { createClient } from "@/lib/supabase/server";
import { renderStructuredAnswer } from "@/lib/answers/render-structured-answer";
import {
  collectAssessmentDimensions,
  extractScoringDefinitionMetadata,
  type LegacyDimensionInput,
} from "@/lib/assessment-results/collect-dimensions";
import { buildAssessmentHighlights } from "@/lib/assessment-results/highlights";
import { mergeLegacyPresentationInputs } from "@/lib/assessment-results/legacy-inputs";
import { summarizeAssessmentDimensions } from "@/lib/assessment-results/summarize-dimensions";
import type {
  AssessmentDimensionGroup,
  AssessmentDimensionResult,
  AssessmentHighlight,
} from "@/lib/assessment-results/types";
import type { InvitationStatus, Recommendation, RiskLevel } from "@/lib/candidates/constants";
import type { CompetencyKey } from "@/lib/jobs/constants";
import type { InterpretationDirection } from "@/lib/scoring/interpretation-policy";
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
  interpretation_direction: InterpretationDirection | null;
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

type EmployeeAnswerOption = {
  id: string;
  match_target_id?: string | null;
  match_text?: string | null;
  order_index: number;
  question_id: string;
  text: string;
};

type EmployeeAnswerQuestion = {
  answer_options?: EmployeeAnswerOption[] | null;
  id: string;
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
  question_id: string;
  questions: Relation<EmployeeAnswerQuestion>;
  selected_option_id: string | null;
  session_id: string;
};

type EmployeeTestResultRecord = {
  id: string;
  level: string | null;
  percentage: number | null;
  raw_score: number | null;
  requires_review: boolean;
  scoring_result_json: unknown;
  session_id: string;
};

type SessionRecord = {
  completed_at: string | null;
  employee_assessment_test_results?: EmployeeTestResultRecord[] | null;
  employee_assessment_answers?: EmployeeAnswerRecord[] | null;
  id: string;
  percentage: number | null;
  package_passing_score: number | null;
  score: number | null;
  started_at: string | null;
  status: string;
  test_version_id: string;
};

type ReportTestVersionRecord = {
  assessment_domain: string | null;
  id: string;
  result_shape: string | null;
  scoring_config_json: unknown;
  scoring_schema_version: string | null;
  test_template_id: string;
  title: string;
};

type EmployeeIntegrityEventRecord = {
  client_occurred_at: string | null;
  event_type: ReportIntegrityEventType;
  id: number;
  occurred_at: string;
  questions: Relation<{ text: string }>;
  session_id: string;
};

type ReportSummaryRecord = SummaryRecord & {
  is_below_minimum: boolean;
  max_score: number | null;
  score: number | null;
};

type ReportParticipantRecord = ParticipantRecord & {
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
  dimensions: Record<
    string,
    {
      domain: AssessmentDimensionResult["assessmentDomain"];
      group: AssessmentDimensionResult["reportGroup"];
      value: number | null;
    }
  >;
};

export type EmployeeComparisonData = {
  assessment: {
    id: string;
    status: EmployeeAssessmentStatus;
    title: string;
  };
  dimensions: Array<{
    group: AssessmentDimensionResult["reportGroup"];
    id: string;
    key: string;
    order: number | null;
    title: string;
  }>;
  participants: EmployeeComparisonParticipant[];
};

type EmployeeComparisonSessionRecord = {
  id: string;
  package_passing_score: number | null;
  participant_id: string;
  test_version_id: string;
};

type EmployeeComparisonResultRecord = {
  id: string;
  scoring_result_json: unknown;
  session_id: string;
};

type EmployeeLegacyScoreRecord = {
  competency_key: string;
  max_score: number | null;
  participant_id: string;
  percentage: number | null;
  result_id: string | null;
  score: number | null;
};

export type EmployeeAssessmentReportData = {
  assessment: {
    id: string;
    title: string;
  };
  employee: EmployeeAssessmentParticipant["employee"];
  dimensions: AssessmentDimensionResult[];
  groups: AssessmentDimensionGroup[];
  highlights: AssessmentHighlight[];
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
};

function employeeIntegritySummary(
  events: EmployeeIntegrityEventRecord[],
  sessions: SessionRecord[],
  testTitlesByVersionId: ReadonlyMap<string, string>,
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
    sessions.map((session) => [
      session.id,
      testTitlesByVersionId.get(session.test_version_id)!,
    ]),
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
        "id, employee_id, status, current_stage, completed_at, created_at, overall_score, fit_score, recommendation, risk_level, requires_review, employees(id, full_name, email, phone, department, role_title), employee_assessment_competency_summary(competency_key, percentage, interpretation_direction)",
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

  const rawParticipants = (participantsResult.data ?? []) as unknown as ParticipantRecord[];
  const participantIds = rawParticipants.map((participant) => participant.id);
  const sessionsResult =
    participantIds.length === 0
      ? { data: [] as EmployeeComparisonSessionRecord[], error: null }
      : await supabase
          .from("employee_assessment_sessions")
          .select("id, participant_id, test_version_id, package_passing_score")
          .in("participant_id", participantIds);
  if (sessionsResult.error) {
    throw new Error("Unable to load employee comparison dimensions.");
  }

  const sessions = (sessionsResult.data ?? []) as EmployeeComparisonSessionRecord[];
  const sessionIds = sessions.map((session) => session.id);
  const versionIds = Array.from(new Set(sessions.map((session) => session.test_version_id)));
  const [resultsResult, versionsResult, competencyScoresResult] = await Promise.all([
    sessionIds.length === 0
      ? { data: [] as EmployeeComparisonResultRecord[], error: null }
      : supabase
          .from("employee_assessment_test_results")
          .select("id, session_id, scoring_result_json")
          .in("session_id", sessionIds),
    versionIds.length === 0
      ? { data: [] as ReportTestVersionRecord[], error: null }
      : supabase
          .from("test_versions")
          .select(
            "id, title, test_template_id, scoring_schema_version, assessment_domain, result_shape, scoring_config_json",
          )
          .in("id", versionIds),
    participantIds.length === 0
      ? { data: [] as EmployeeLegacyScoreRecord[], error: null }
      : supabase
          .from("employee_assessment_competency_scores")
          .select("result_id, participant_id, competency_key, score, max_score, percentage")
          .in("participant_id", participantIds),
  ]);
  if (resultsResult.error || versionsResult.error || competencyScoresResult.error) {
    throw new Error("Unable to load employee comparison dimensions.");
  }

  const resultBySession = new Map(
    ((resultsResult.data ?? []) as EmployeeComparisonResultRecord[]).map((result) => [
      result.session_id,
      result.scoring_result_json,
    ]),
  );
  const resultById = new Map(
    ((resultsResult.data ?? []) as EmployeeComparisonResultRecord[]).map((result) => [
      result.id,
      result,
    ]),
  );
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const legacyScores = (competencyScoresResult.data ?? []) as EmployeeLegacyScoreRecord[];
  const versionById = new Map(
    ((versionsResult.data ?? []) as ReportTestVersionRecord[]).map((version) => [version.id, version]),
  );
  const sessionsByParticipant = new Map<string, EmployeeComparisonSessionRecord[]>();
  for (const session of sessions) {
    const participantSessions = sessionsByParticipant.get(session.participant_id) ?? [];
    participantSessions.push(session);
    sessionsByParticipant.set(session.participant_id, participantSessions);
  }
  const dimensionMetadata = new Map<string, EmployeeComparisonData["dimensions"][number]>();

  const participants = rawParticipants
    .map((record) => {
      const participant = normalizeParticipant(record);
      if (!participant) {
        return null;
      }

      const participantLinkedLegacy: LegacyDimensionInput[] = [];
      const participantUnlinkedLegacy: LegacyDimensionInput[] = [];
      for (const score of legacyScores.filter((candidate) => candidate.participant_id === record.id)) {
          const result = score.result_id ? resultById.get(score.result_id) : null;
          const session = result ? sessionById.get(result.session_id) : null;
          const version = session ? versionById.get(session.test_version_id) : null;
          const row: LegacyDimensionInput = {
            isBelowMinimum: false,
            key: score.competency_key,
            maxScore: score.max_score,
            minimumScore: null,
            percentage: score.percentage,
            score: score.score,
            sessionId: result && session ? session.id : null,
            testTitle: result && session ? version?.title ?? null : null,
            testVersionId: result && session ? session.test_version_id : null,
          };
          if (result && session) participantLinkedLegacy.push(row);
          else participantUnlinkedLegacy.push(row);
      }
      const participantSummary = (record.employee_assessment_competency_summary ?? []).map((summary) => ({
        interpretationDirection: summary.interpretation_direction,
        isBelowMinimum: false,
        key: summary.competency_key,
        minimumScore: null,
        percentage: summary.percentage,
      }));
      const dimensions = collectAssessmentDimensions({
        legacy: mergeLegacyPresentationInputs({
          linkedRows: participantLinkedLegacy,
          summaryRows: participantSummary,
          unlinkedRows: participantUnlinkedLegacy,
        }),
        sessions: (sessionsByParticipant.get(record.id) ?? []).map((session) => {
          const version = versionById.get(session.test_version_id);
          return {
            definition: extractScoringDefinitionMetadata(version?.scoring_config_json),
            passingScore: session.package_passing_score,
            scoringResult: resultBySession.get(session.id),
            sessionId: session.id,
            testTitle: version?.title ?? null,
            testVersionId: session.test_version_id,
          };
        }),
      });
      for (const dimension of dimensions) {
        dimensionMetadata.set(dimension.id, {
          group: dimension.reportGroup,
          id: dimension.id,
          key: dimension.key,
          order: dimension.order,
          title: dimension.testTitle
            ? `${dimension.testTitle}: ${dimension.title}`
            : dimension.title,
        });
      }

      return {
        completedAt: participant.completedAt,
        createdAt: participant.createdAt,
        currentStage: participant.currentStage,
        dimensions: Object.fromEntries(
          dimensions.map((dimension) => [
            dimension.id,
            {
              domain: dimension.assessmentDomain,
              group: dimension.reportGroup,
              value: dimension.normalizedScore,
            },
          ]),
        ),
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
    dimensions: Array.from(dimensionMetadata.values()).sort(
      (left, right) =>
        (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
        left.title.localeCompare(right.title, "ru") ||
        left.id.localeCompare(right.id),
    ),
    participants,
  } satisfies EmployeeComparisonData;
}

export async function getEmployeeAssessmentReportData(companyId: string, participantId: string) {
  const supabase = await createClient();
  const [participantResult, reportResult, summaryResult, sessionsResult, integrityResult] =
    await Promise.all([
    supabase
      .from("employee_assessment_participants")
      .select(
        "id, employee_id, status, current_stage, completed_at, created_at, overall_score, fit_score, recommendation, risk_level, requires_review, employees(id, full_name, email, phone, department, role_title), employee_assessments(id, title)",
      )
      .eq("company_id", companyId)
      .eq("id", participantId)
      .maybeSingle(),
    supabase
      .from("employee_assessment_reports")
      .select(
        "id, overall_score, fit_score, recommendation, strengths_json, risks_json, suggested_roles_json, interview_questions_json, report_text",
      )
      .eq("participant_id", participantId)
      .maybeSingle(),
    supabase
      .from("employee_assessment_competency_summary")
      .select("competency_key, score, max_score, percentage, is_below_minimum, interpretation_direction")
      .eq("participant_id", participantId),
    supabase
      .from("employee_assessment_sessions")
      .select("id, test_version_id, status, started_at, completed_at, score, percentage, package_passing_score")
      .eq("participant_id", participantId)
      .order("created_at"),
    supabase
      .from("employee_assessment_session_events")
      .select("id, session_id, event_type, occurred_at, client_occurred_at, questions(text)")
      .eq("company_id", companyId)
      .eq("participant_id", participantId)
      .order("occurred_at"),
    ]);
  const { data, error } = participantResult;
  const requiredFailure = [
    { error, query: "participant" },
    { error: reportResult.error, query: "report" },
    { error: summaryResult.error, query: "summary" },
    { error: sessionsResult.error, query: "sessions" },
  ].find((entry) => entry.error);

  if (requiredFailure?.error) {
    console.error("Employee assessment report query failed", {
      code: requiredFailure.error.code,
      details: requiredFailure.error.details,
      hint: requiredFailure.error.hint,
      message: requiredFailure.error.message,
      query: requiredFailure.query,
    });
    throw new Error("Unable to load employee assessment report.");
  }

  if (integrityResult.error) {
    console.error("Employee assessment report integrity query failed", {
      code: integrityResult.error.code,
      details: integrityResult.error.details,
      hint: integrityResult.error.hint,
      message: integrityResult.error.message,
    });
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
  const report = reportResult.data as ReportRecord | null;
  const rawSessions = (sessionsResult.data ?? []) as unknown as SessionRecord[];
  const sessionIds = rawSessions.map((session) => session.id);
  const [testResultsResult, answersResult, competencyScoresResult] =
    sessionIds.length === 0
      ? [
          { data: [] as EmployeeTestResultRecord[], error: null },
          { data: [] as EmployeeAnswerRecord[], error: null },
          { data: [] as EmployeeLegacyScoreRecord[], error: null },
        ]
      : await Promise.all([
          supabase
            .from("employee_assessment_test_results")
            .select(
              "id, session_id, percentage, raw_score, level, requires_review, scoring_result_json",
            )
            .in("session_id", sessionIds),
          supabase
            .from("employee_assessment_answers")
            .select(
              "id, session_id, question_id, selected_option_id, answer_text, answer_json, is_correct, points_awarded",
            )
            .in("session_id", sessionIds),
          supabase
            .from("employee_assessment_competency_scores")
            .select("result_id, participant_id, competency_key, score, max_score, percentage")
            .eq("participant_id", participantId),
        ]);
  const detailFailure = [
    { error: testResultsResult.error, query: "test-results" },
    { error: answersResult.error, query: "answers" },
    { error: competencyScoresResult.error, query: "competency-scores" },
  ].find((entry) => entry.error);

  if (detailFailure?.error) {
    console.error("Employee assessment report detail query failed", {
      code: detailFailure.error.code,
      details: detailFailure.error.details,
      hint: detailFailure.error.hint,
      message: detailFailure.error.message,
      query: detailFailure.query,
    });
    throw new Error("Unable to load employee assessment report details.");
  }

  const rawAnswers = (answersResult.data ?? []) as unknown as Array<
    Omit<EmployeeAnswerRecord, "questions">
  >;
  const questionIds = Array.from(new Set(rawAnswers.map((answer) => answer.question_id)));
  const [questionsResult, optionsResult] =
    questionIds.length === 0
      ? [
          { data: [] as EmployeeAnswerQuestion[], error: null },
          { data: [] as EmployeeAnswerOption[], error: null },
        ]
      : await Promise.all([
          supabase
            .from("questions")
            .select("id, text, question_type, order_index")
            .in("id", questionIds),
          supabase
            .from("answer_options")
            .select("id, question_id, text, order_index")
            .in("question_id", questionIds),
        ]);

  if (questionsResult.error) {
    console.error("Employee assessment report questions query failed", {
      code: questionsResult.error.code,
      details: questionsResult.error.details,
      hint: questionsResult.error.hint,
      message: questionsResult.error.message,
    });
    throw new Error("Unable to load employee assessment report questions.");
  }

  if (optionsResult.error) {
    console.error("Employee assessment report answer options query failed", {
      code: optionsResult.error.code,
      details: optionsResult.error.details,
      hint: optionsResult.error.hint,
      message: optionsResult.error.message,
    });
    throw new Error("Unable to load employee assessment report answer options.");
  }

  if ((questionsResult.data ?? []).length !== questionIds.length) {
    console.error("Employee assessment report questions are incomplete", {
      expectedQuestionIds: questionIds,
      loadedQuestionIds: (questionsResult.data ?? []).map((question) => question.id),
    });
    throw new Error("Unable to load employee assessment report questions.");
  }

  const resultsBySession = new Map(
    ((testResultsResult.data ?? []) as unknown as EmployeeTestResultRecord[]).map((result) => [
      result.session_id,
      result,
    ]),
  );
  const optionsByQuestionId = new Map<string, EmployeeAnswerOption[]>();
  const answerOptions = (optionsResult.data ?? []) as unknown as EmployeeAnswerOption[];
  const loadedOptionIds = new Set(answerOptions.map((option) => option.id));
  const missingSelectedOptionIds = rawAnswers.flatMap((answer) =>
    answer.selected_option_id && !loadedOptionIds.has(answer.selected_option_id)
      ? [answer.selected_option_id]
      : [],
  );
  if (missingSelectedOptionIds.length > 0) {
    console.error("Employee assessment report selected answer options are inaccessible", {
      missingSelectedOptionIds,
    });
    throw new Error("Unable to load employee assessment report answer options.");
  }
  for (const option of answerOptions) {
    const options = optionsByQuestionId.get(option.question_id) ?? [];
    options.push(option);
    optionsByQuestionId.set(option.question_id, options);
  }
  const questionsById = new Map(
    ((questionsResult.data ?? []) as unknown as EmployeeAnswerQuestion[]).map((question) => [
      question.id,
      {
        ...question,
        answer_options: (optionsByQuestionId.get(question.id) ?? []).sort(
          (left, right) => left.order_index - right.order_index,
        ),
      },
    ]),
  );
  const answersBySession = new Map<string, EmployeeAnswerRecord[]>();
  for (const answer of rawAnswers) {
    const answers = answersBySession.get(answer.session_id) ?? [];
    answers.push({ ...answer, questions: questionsById.get(answer.question_id) ?? null });
    answersBySession.set(answer.session_id, answers);
  }
  const sessions = rawSessions.map((session) => {
    const result = resultsBySession.get(session.id);
    return {
      ...session,
      employee_assessment_answers: answersBySession.get(session.id) ?? [],
      employee_assessment_test_results: result ? [result] : [],
    };
  });
  const integrityEvents = (integrityResult.data ?? []) as unknown as EmployeeIntegrityEventRecord[];
  const versionIds = Array.from(new Set(sessions.map((session) => session.test_version_id)));
  const versionsResult =
    versionIds.length === 0
      ? { data: [] as ReportTestVersionRecord[], error: null }
      : await supabase
          .from("test_versions")
          .select(
            "id, title, test_template_id, scoring_schema_version, assessment_domain, result_shape, scoring_config_json",
          )
          .in("id", versionIds);

  if (versionsResult.error) {
    console.error("Employee assessment report test versions query failed", {
      code: versionsResult.error.code,
      details: versionsResult.error.details,
      hint: versionsResult.error.hint,
      message: versionsResult.error.message,
    });
    throw new Error("Unable to load employee assessment report test titles.");
  }

  const versions = (versionsResult.data ?? []) as ReportTestVersionRecord[];
  if (versions.length !== versionIds.length) {
    console.error("Employee assessment report test versions are incomplete", {
      expectedVersionIds: versionIds,
      loadedVersionIds: versions.map((version) => version.id),
    });
    throw new Error("Unable to load employee assessment report test titles.");
  }

  const templateIds = Array.from(
    new Set(versions.map((version) => version.test_template_id)),
  );
  const templatesResult =
    templateIds.length === 0
      ? { data: [] as Array<{ id: string; title: string }>, error: null }
      : await supabase.from("test_templates").select("id, title").in("id", templateIds);

  if (templatesResult.error) {
    console.error("Employee assessment report test templates query failed", {
      code: templatesResult.error.code,
      details: templatesResult.error.details,
      hint: templatesResult.error.hint,
      message: templatesResult.error.message,
    });
    throw new Error("Unable to load employee assessment report test titles.");
  }

  const templateTitlesById = new Map(
    (templatesResult.data ?? []).map((template) => [template.id, template.title]),
  );
  if (templateTitlesById.size !== templateIds.length) {
    console.error("Employee assessment report test templates are incomplete", {
      expectedTemplateIds: templateIds,
      loadedTemplateIds: Array.from(templateTitlesById.keys()),
    });
    throw new Error("Unable to load employee assessment report test titles.");
  }

  const testTitlesByVersionId = new Map(
    versions.map((version) => [version.id, templateTitlesById.get(version.test_template_id)!]),
  );
  const weightsResult = await supabase
    .from("employee_assessment_competency_weights")
    .select("competency_key, minimum_score")
    .eq("employee_assessment_id", assessment.id);
  if (weightsResult.error) {
    console.error("Employee assessment report thresholds query failed", {
      code: weightsResult.error.code,
      details: weightsResult.error.details,
      hint: weightsResult.error.hint,
      message: weightsResult.error.message,
    });
    throw new Error("Unable to load employee assessment report thresholds.");
  }
  const minimumScoreByCompetency = new Map(
    ((weightsResult.data ?? []) as Array<{ competency_key: CompetencyKey; minimum_score: number | null }>).map(
      (weight) => [weight.competency_key, weight.minimum_score],
    ),
  );
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const resultsById = new Map(
    ((testResultsResult.data ?? []) as unknown as EmployeeTestResultRecord[]).map((result) => [
      result.id,
      result,
    ]),
  );
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const linkedLegacy: LegacyDimensionInput[] = [];
  const unlinkedLegacy: LegacyDimensionInput[] = [];
  for (const score of (competencyScoresResult.data ?? []) as EmployeeLegacyScoreRecord[]) {
      const result = score.result_id ? resultsById.get(score.result_id) : null;
      const session = result ? sessionsById.get(result.session_id) : null;
      const row: LegacyDimensionInput = {
        isBelowMinimum: false,
        key: score.competency_key,
        maxScore: score.max_score,
        minimumScore: minimumScoreByCompetency.get(score.competency_key as CompetencyKey) ?? null,
        percentage: score.percentage,
        score: score.score,
        sessionId: result && session ? session.id : null,
        testTitle: result && session ? testTitlesByVersionId.get(session.test_version_id) ?? null : null,
        testVersionId: result && session ? session.test_version_id : null,
      };
      if (result && session) linkedLegacy.push(row);
      else unlinkedLegacy.push(row);
  }
  const legacySummary = ((summaryResult.data ?? []) as unknown as ReportSummaryRecord[]).map(
    (summary) => ({
      interpretationDirection: summary.interpretation_direction,
      isBelowMinimum: summary.is_below_minimum,
      key: summary.competency_key,
      maxScore: summary.max_score,
      minimumScore: minimumScoreByCompetency.get(summary.competency_key) ?? null,
      percentage: summary.percentage,
      score: summary.score,
    }),
  );
  const dimensions = collectAssessmentDimensions({
    legacy: mergeLegacyPresentationInputs({ linkedRows: linkedLegacy, summaryRows: legacySummary, unlinkedRows: unlinkedLegacy }),
    sessions: sessions.map((session) => {
      const version = versionById.get(session.test_version_id);
      return {
        definition: extractScoringDefinitionMetadata(version?.scoring_config_json),
        passingScore: session.package_passing_score,
        scoringResult: session.employee_assessment_test_results?.[0]?.scoring_result_json,
        sessionId: session.id,
        testTitle: testTitlesByVersionId.get(session.test_version_id) ?? version?.title ?? null,
        testVersionId: session.test_version_id,
      };
    }),
  });
  const groups = summarizeAssessmentDimensions(dimensions);
  const highlights = buildAssessmentHighlights(groups);

  return {
    assessment,
    dimensions,
    employee: participant.employee,
    groups,
    highlights,
    integrity: employeeIntegritySummary(integrityEvents, sessions, testTitlesByVersionId),
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
      const result = session.employee_assessment_test_results?.[0] ?? null;
      const storedAnswers = session.employee_assessment_answers ?? [];
      const answers = storedAnswers
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
      const answerCounts = countAnswerCorrectness(
        storedAnswers.map((answer) => ({ isCorrect: answer.is_correct })),
      );

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
        testTitle: testTitlesByVersionId.get(session.test_version_id)!,
      };
    }),
  } satisfies EmployeeAssessmentReportData;
}
