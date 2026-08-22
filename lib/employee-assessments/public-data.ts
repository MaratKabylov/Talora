import { scoreCompletedEmployeeAssessmentParticipant } from "@/lib/scoring/service";
import { sanitizeRichTextValue } from "@/lib/rich-text.server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { QuestionType } from "@/lib/tests/builder-constants";
import { getTestContentBlocks, type TestContentBlock } from "@/lib/tests/content-blocks";
import type { QuestionSettings } from "@/lib/tests/remediation";
import {
  createDeterministicShuffledIds,
  isStructuredQuestion,
  normalizeMatchingScoringMode,
  normalizeOrderingScoringMode,
  validateOrderingAnswer,
  type MatchingScoringMode,
  type OrderingScoringMode,
} from "@/lib/structured-questions";
import type { InvitationStatus } from "@/lib/candidates/constants";

type Relation<T> = T | T[] | null;

type InvitationRecord = {
  company_id: string;
  consent_given_at: string | null;
  employee_assessment_id: string;
  employee_id: string;
  expires_at: string | null;
  id: string;
  participant_id: string;
  status: InvitationStatus;
};

type EmployeeRecord = {
  department: string | null;
  email: string;
  full_name: string;
  id: string;
  phone: string | null;
  profile_completed_at: string | null;
  role_title: string | null;
};

type PackageTestRecord = {
  order_index: number;
  test_version_id: string;
  test_versions: Relation<{
    description: string | null;
    duration_minutes: number | null;
    id: string;
    instructions: string | null;
    status: string;
    title: string;
  }>;
};

type PackageRecord = {
  assessment_package_tests?: PackageTestRecord[] | null;
  description: string | null;
  id: string;
  title: string;
};

type EmployeeAssessmentRecord = {
  assessment_packages: Relation<PackageRecord>;
  description: string | null;
  id: string;
  title: string;
};

type SessionRecord = {
  completed_at: string | null;
  id: string;
  started_at: string | null;
  status: "not_started" | "in_progress" | "completed" | "expired" | "cancelled";
  test_version_id: string;
};

type OptionRecord = {
  id: string;
  match_target_id: string;
  match_text: string | null;
  order_index: number;
  text: string;
};

type QuestionRecord = {
  answer_options?: OptionRecord[] | null;
  description: string | null;
  id: string;
  order_index: number;
  question_type: QuestionType;
  settings_json: QuestionSettings | null;
  text: string;
};

type SectionRecord = {
  description: string | null;
  id: string;
  order_index: number;
  questions?: QuestionRecord[] | null;
  settings_json: unknown;
  title: string;
};

type AnswerRecord = {
  answer_json: Record<string, unknown> | null;
  answer_text: string | null;
  is_correct: boolean | null;
  question_id: string;
  selected_option_id: string | null;
};

export type EmployeeAssessmentTest = {
  description: string | null;
  durationMinutes: number | null;
  instructions: string | null;
  orderIndex: number;
  title: string;
  versionId: string;
};

export type EmployeeAssessmentSession = {
  completedAt: string | null;
  id: string;
  startedAt: string | null;
  status: SessionRecord["status"];
  test: EmployeeAssessmentTest;
};

export type ActiveEmployeeAssessment = {
  assessment: {
    description: string | null;
    title: string;
  };
  availability: "active" | "completed";
  companyName: string;
  consentGivenAt: string | null;
  employee: {
    department: string | null;
    email: string;
    fullName: string;
    id: string;
    phone: string | null;
    profileCompletedAt: string | null;
    roleTitle: string | null;
  };
  invitationId: string;
  invitationStatus: InvitationStatus;
  package: {
    description: string | null;
    title: string;
  };
  participantId: string;
  sessions: EmployeeAssessmentSession[];
  tests: EmployeeAssessmentTest[];
  totalDurationMinutes: number;
};

export type EmployeeAssessmentAvailability =
  | ActiveEmployeeAssessment
  | { availability: "invalid" | "expired" | "cancelled" };

export type EmployeeFlowOption = {
  id: string;
  text: string;
};

export type EmployeeFlowMatchingTarget = {
  id: string;
  text: string;
};

export type EmployeeFlowQuestion = {
  description: string | null;
  id: string;
  incorrectFeedback: string | null;
  isRequired: boolean;
  isStructured: boolean;
  matchingScoringMode: MatchingScoringMode;
  matchingTargets: EmployeeFlowMatchingTarget[];
  forcedChoiceMode: "most_least" | null;
  options: EmployeeFlowOption[];
  orderIndex: number;
  orderingScoringMode: OrderingScoringMode;
  questionType: QuestionType;
  remediationParentId: string | null;
  remediationQuestionId: string | null;
  scaleMax: number;
  scaleMin: number;
  sectionTitle: string;
  text: string;
};

export type EmployeeFlowSection = {
  contentBlocks: TestContentBlock[];
  description: string | null;
  id: string;
  questions: EmployeeFlowQuestion[];
  title: string;
};

export type EmployeeAssessmentQuestionPageData = {
  answers: Record<
    string,
    {
      answerJson: Record<string, unknown>;
      answerText: string | null;
      isCorrect: boolean | null;
      selectedOptionId: string | null;
    }
  >;
  assessment: ActiveEmployeeAssessment;
  questions: EmployeeFlowQuestion[];
  sections: EmployeeFlowSection[];
  session: EmployeeAssessmentSession;
};

function related<T>(value: Relation<T>) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function hasExpired(record: InvitationRecord) {
  return Boolean(record.expires_at && new Date(record.expires_at).getTime() < Date.now());
}

function normalizeTests(assessment: EmployeeAssessmentRecord) {
  const assessmentPackage = related(assessment.assessment_packages);
  const tests = (assessmentPackage?.assessment_package_tests ?? [])
    .flatMap((packageTest) => {
      const version = related(packageTest.test_versions);

      if (!version || version.status !== "published") {
        return [];
      }

      return [
        {
          description: sanitizeRichTextValue(version.description),
          durationMinutes: version.duration_minutes,
          instructions: sanitizeRichTextValue(version.instructions),
          orderIndex: packageTest.order_index,
          title: version.title,
          versionId: version.id,
        },
      ];
    })
    .sort((left, right) => left.orderIndex - right.orderIndex);

  return {
    assessmentPackage,
    tests,
  };
}

export async function getEmployeeAssessmentByToken(
  token: string,
): Promise<EmployeeAssessmentAvailability> {
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return { availability: "invalid" };
  }

  const admin = createAdminClient();
  const { data: invitationData, error: invitationError } = await admin
    .from("employee_assessment_invitations")
    .select(
      "id, company_id, employee_assessment_id, employee_id, participant_id, status, expires_at, consent_given_at",
    )
    .eq("token", token)
    .maybeSingle();

  if (invitationError || !invitationData) {
    return { availability: "invalid" };
  }

  const invitation = invitationData as InvitationRecord;

  if (invitation.status === "cancelled") {
    return { availability: "cancelled" };
  }

  if (invitation.status === "expired" || (invitation.status !== "completed" && hasExpired(invitation))) {
    if (invitation.status !== "expired") {
      await admin
        .from("employee_assessment_invitations")
        .update({ status: "expired" })
        .eq("id", invitation.id);
      await admin
        .from("employee_assessment_sessions")
        .update({ status: "expired" })
        .eq("participant_id", invitation.participant_id)
        .in("status", ["not_started", "in_progress"]);
    }

    return { availability: "expired" };
  }

  if (invitation.status === "sent") {
    const openedAt = new Date().toISOString();
    await admin
      .from("employee_assessment_invitations")
      .update({ opened_at: openedAt, status: "opened" })
      .eq("id", invitation.id)
      .eq("status", "sent");
    invitation.status = "opened";
  }

  const [companyResult, assessmentResult, employeeResult, sessionsResult] = await Promise.all([
    admin.from("companies").select("name").eq("id", invitation.company_id).maybeSingle(),
    admin
      .from("employee_assessments")
      .select(
        "id, title, description, assessment_packages(id, title, description, assessment_package_tests(order_index, test_version_id, test_versions(id, title, description, instructions, duration_minutes, status)))",
      )
      .eq("id", invitation.employee_assessment_id)
      .eq("company_id", invitation.company_id)
      .maybeSingle(),
    admin
      .from("employees")
      .select("id, full_name, email, phone, department, role_title, profile_completed_at")
      .eq("id", invitation.employee_id)
      .eq("company_id", invitation.company_id)
      .maybeSingle(),
    admin
      .from("employee_assessment_sessions")
      .select("id, test_version_id, status, started_at, completed_at")
      .eq("participant_id", invitation.participant_id),
  ]);

  if (
    companyResult.error ||
    assessmentResult.error ||
    employeeResult.error ||
    sessionsResult.error ||
    !companyResult.data ||
    !assessmentResult.data ||
    !employeeResult.data
  ) {
    return { availability: "invalid" };
  }

  const assessment = assessmentResult.data as unknown as EmployeeAssessmentRecord;
  const employee = employeeResult.data as EmployeeRecord;
  const { assessmentPackage, tests } = normalizeTests(assessment);
  const testsByVersion = new Map(tests.map((test) => [test.versionId, test]));
  const sessions = ((sessionsResult.data ?? []) as SessionRecord[])
    .flatMap((session) => {
      const test = testsByVersion.get(session.test_version_id);
      return test ? [{ ...session, test }] : [];
    })
    .map((session) => ({
      completedAt: session.completed_at,
      id: session.id,
      startedAt: session.started_at,
      status: session.status,
      test: session.test,
    }))
    .sort((left, right) => left.test.orderIndex - right.test.orderIndex);

  if (!assessmentPackage) {
    return { availability: "invalid" };
  }

  if (
    invitation.status !== "completed" &&
    sessions.length > 0 &&
    sessions.every((session) => session.status === "completed")
  ) {
    const completedAt = new Date().toISOString();
    await scoreCompletedEmployeeAssessmentParticipant(invitation.participant_id);
    const [{ error: invitationUpdateError }, { error: participantUpdateError }] =
      await Promise.all([
        admin
          .from("employee_assessment_invitations")
          .update({ status: "completed" })
          .eq("id", invitation.id),
        admin
          .from("employee_assessment_participants")
          .update({
            completed_at: completedAt,
            current_stage: "assessment_completed",
            status: "completed",
          })
          .eq("id", invitation.participant_id),
      ]);

    if (!invitationUpdateError && !participantUpdateError) {
      invitation.status = "completed";
    }
  }

  return {
    assessment: {
      description: assessment.description,
      title: assessment.title,
    },
    availability: invitation.status === "completed" ? "completed" : "active",
    companyName: companyResult.data.name,
    consentGivenAt: invitation.consent_given_at,
    employee: {
      department: employee.department,
      email: employee.email,
      fullName: employee.full_name,
      id: employee.id,
      phone: employee.phone,
      profileCompletedAt: employee.profile_completed_at,
      roleTitle: employee.role_title,
    },
    invitationId: invitation.id,
    invitationStatus: invitation.status,
    package: {
      description: assessmentPackage.description,
      title: assessmentPackage.title,
    },
    participantId: invitation.participant_id,
    sessions,
    tests,
    totalDurationMinutes: tests.reduce((sum, test) => sum + (test.durationMinutes ?? 0), 0),
  };
}

export async function getEmployeeAssessmentQuestionPageData(
  token: string,
  sessionId: string,
  currentAssessment?: ActiveEmployeeAssessment,
): Promise<EmployeeAssessmentQuestionPageData | null> {
  const assessment = currentAssessment ?? (await getEmployeeAssessmentByToken(token));

  if (assessment.availability !== "active" && assessment.availability !== "completed") {
    return null;
  }

  const session = assessment.sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    return null;
  }

  const admin = createAdminClient();
  const [{ data: sectionsData, error: sectionsError }, { data: answersData, error: answersError }] =
    await Promise.all([
      admin
        .from("test_sections")
        .select(
          "id, title, description, order_index, settings_json, questions(id, question_type, text, description, order_index, settings_json, answer_options(id, text, match_text, match_target_id, order_index))",
        )
        .eq("test_version_id", session.test.versionId),
      admin
        .from("employee_assessment_answers")
        .select("question_id, selected_option_id, answer_text, answer_json, is_correct")
        .eq("session_id", session.id),
    ]);

  if (sectionsError || answersError) {
    throw new Error("Unable to load employee assessment questions.");
  }

  const sectionRecords = ((sectionsData ?? []) as unknown as SectionRecord[]).sort(
    (left, right) => left.order_index - right.order_index,
  );
  const answerRecords = (answersData ?? []) as AnswerRecord[];
  const answerByQuestion = new Map(
    answerRecords.map((answer) => [answer.question_id, answer]),
  );
  const remediationParentByTarget = new Map<string, string>();
  for (const question of sectionRecords.flatMap((section) => section.questions ?? [])) {
    const remediationQuestionId = question.settings_json?.remediationQuestionId;
    if (typeof remediationQuestionId === "string") {
      remediationParentByTarget.set(remediationQuestionId, question.id);
    }
  }

  const sections = sectionRecords
    .map((section) => ({
      contentBlocks: getTestContentBlocks(section.settings_json).map((block) => ({
        ...block,
        description: sanitizeRichTextValue(block.description),
      })),
      description: sanitizeRichTextValue(section.description),
      id: section.id,
      questions: (section.questions ?? [])
        .sort((left, right) => left.order_index - right.order_index)
        .map((question) => {
          const settings = question.settings_json ?? {};
          const answer = answerByQuestion.get(question.id);
          const remediationQuestionId =
            typeof settings.remediationQuestionId === "string"
              ? settings.remediationQuestionId
              : null;

          const canonicalOptions = (question.answer_options ?? [])
            .slice()
            .sort((left, right) => left.order_index - right.order_index);
          const structured = isStructuredQuestion(settings);
          const savedOrdering = validateOrderingAnswer(
            { orderedOptionIds: answer?.answer_json?.orderedOptionIds },
            canonicalOptions.map((option) => option.id),
          );
          const presentedOptionIds =
            question.question_type === "ordering" && structured
              ? savedOrdering.ok
                ? savedOrdering.answer.orderedOptionIds
                : createDeterministicShuffledIds(
                    canonicalOptions.map((option) => option.id),
                    `${session.id}:${question.id}:ordering`,
                  )
              : canonicalOptions.map((option) => option.id);
          const optionById = new Map(canonicalOptions.map((option) => [option.id, option]));
          const matchingTargetIds = createDeterministicShuffledIds(
            canonicalOptions.map((option) => option.match_target_id),
            `${session.id}:${question.id}:matching`,
          );
          const targetById = new Map(
            canonicalOptions.flatMap((option) =>
              option.match_text
                ? [[option.match_target_id, { id: option.match_target_id, text: option.match_text }] as const]
                : [],
            ),
          );

          return {
            description: sanitizeRichTextValue(question.description),
            id: question.id,
            incorrectFeedback:
              answer?.is_correct === false && typeof settings.incorrectFeedback === "string"
                ? settings.incorrectFeedback
                : null,
            isRequired: settings.required ?? true,
            isStructured: structured,
            matchingScoringMode: normalizeMatchingScoringMode(settings.matchingScoringMode),
            matchingTargets: matchingTargetIds.flatMap((id) => {
              const target = targetById.get(id);
              return target ? [target] : [];
            }),
            forcedChoiceMode: settings.mode === "most_least" ? settings.mode : null,
            options: presentedOptionIds.flatMap((id) => {
              const option = optionById.get(id);
              return option ? [{ id: option.id, text: option.text }] : [];
            }),
            orderIndex: question.order_index,
            orderingScoringMode: normalizeOrderingScoringMode(settings.orderingScoringMode),
            questionType: question.question_type,
            remediationParentId: remediationParentByTarget.get(question.id) ?? null,
            remediationQuestionId,
            scaleMax: typeof settings.max === "number" ? settings.max : 5,
            scaleMin: typeof settings.min === "number" ? settings.min : 1,
            sectionTitle: section.title,
            text: question.text,
          };
        }),
      title: section.title,
    }));
  const questions = sections.flatMap((section) => section.questions);

  return {
    answers: Object.fromEntries(
      answerRecords.map((answer) => [
        answer.question_id,
        {
          answerJson: answer.answer_json ?? {},
          answerText: answer.answer_text,
          isCorrect: answer.is_correct,
          selectedOptionId: answer.selected_option_id,
        },
      ]),
    ),
    assessment,
    questions,
    sections,
    session,
  };
}
