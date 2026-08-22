import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeRichTextValue } from "@/lib/rich-text.server";
import { scoreCompletedApplication } from "@/lib/scoring/service";
import type { QuestionType } from "@/lib/tests/builder-constants";
import { getTestContentBlocks } from "@/lib/tests/content-blocks";
import {
  normalizePresentationSettings,
  type TestPresentationSettings,
} from "@/lib/tests/presentation-settings";
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

type InvitationStatus =
  | "created"
  | "sent"
  | "opened"
  | "started"
  | "completed"
  | "expired"
  | "cancelled";

type InvitationRecord = {
  application_id: string;
  candidate_id: string;
  company_id: string;
  consent_given_at: string | null;
  expires_at: string | null;
  id: string;
  job_id: string;
  status: InvitationStatus;
};

type CandidateRecord = {
  city: string | null;
  email: string | null;
  full_name: string | null;
  id: string;
  phone: string | null;
  profile_completed_at: string | null;
};

type PackageTestRecord = {
  order_index: number;
  test_version_id: string;
  test_versions:
    | {
        description: string | null;
        duration_minutes: number | null;
        id: string;
        instructions: string | null;
        settings_json: unknown;
        status: string;
        title: string;
      }
    | {
        description: string | null;
        duration_minutes: number | null;
        id: string;
        instructions: string | null;
        settings_json: unknown;
        status: string;
        title: string;
      }[]
    | null;
};

type PackageRecord = {
  assessment_package_tests?: PackageTestRecord[] | null;
  description: string | null;
  id: string;
  title: string;
};

type JobRecord = {
  assessment_packages: PackageRecord | PackageRecord[] | null;
  department: string | null;
  id: string;
  location: string | null;
  title: string;
};

type SessionRecord = {
  completed_at: string | null;
  deadline_at: string | null;
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
  time_spent_seconds: number | null;
};

export type AssessmentTest = {
  description: string | null;
  durationMinutes: number | null;
  instructions: string | null;
  orderIndex: number;
  presentationSettings: TestPresentationSettings;
  title: string;
  versionId: string;
};

export type AssessmentSession = {
  completedAt: string | null;
  deadlineAt: string | null;
  id: string;
  startedAt: string | null;
  status: SessionRecord["status"];
  test: AssessmentTest;
};

export type ActiveAssessment = {
  applicationId: string;
  availability: "active" | "completed";
  candidate: {
    city: string | null;
    email: string | null;
    fullName: string;
    id: string;
    phone: string | null;
    profileCompletedAt: string | null;
  };
  companyName: string;
  consentGivenAt: string | null;
  invitationId: string;
  invitationStatus: InvitationStatus;
  job: {
    department: string | null;
    location: string | null;
    title: string;
  };
  package: {
    description: string | null;
    title: string;
  };
  sessions: AssessmentSession[];
  tests: AssessmentTest[];
  totalDurationMinutes: number;
};

export type AssessmentAvailability =
  | ActiveAssessment
  | { availability: "invalid" | "expired" | "cancelled" };

export type FlowOption = {
  id: string;
  text: string;
};

export type FlowMatchingTarget = {
  id: string;
  text: string;
};

export type FlowQuestion = {
  description: string | null;
  id: string;
  incorrectFeedback: string | null;
  isRequired: boolean;
  isStructured: boolean;
  matchingScoringMode: MatchingScoringMode;
  matchingTargets: FlowMatchingTarget[];
  maxSelections: number;
  minSelections: number;
  forcedChoiceMode: "most_least" | null;
  options: FlowOption[];
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

export type FlowContentBlock = {
  description: string | null;
  id: string;
  orderIndex: number;
  positionIndex: number;
  title: string;
};

export type FlowSection = {
  contentBlocks: FlowContentBlock[];
  description: string | null;
  id: string;
  questions: FlowQuestion[];
  title: string;
};

export type AssessmentQuestionPageData = {
  answers: Record<string, {
    answerJson: Record<string, unknown>;
    answerText: string | null;
    isCorrect: boolean | null;
    selectedOptionId: string | null;
    timeSpentSeconds: number | null;
  }>;
  assessment: ActiveAssessment;
  questions: FlowQuestion[];
  sections: FlowSection[];
  session: AssessmentSession;
};

function related<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function hasExpired(record: InvitationRecord) {
  return Boolean(record.expires_at && new Date(record.expires_at).getTime() < Date.now());
}

function normalizeTests(job: JobRecord) {
  const assessmentPackage = related(job.assessment_packages);
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
          presentationSettings: normalizePresentationSettings(version.settings_json),
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

export async function getAssessmentByToken(token: string): Promise<AssessmentAvailability> {
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return { availability: "invalid" };
  }

  const admin = createAdminClient();
  const { data: invitationData, error: invitationError } = await admin
    .from("invitations")
    .select(
      "id, company_id, job_id, candidate_id, application_id, status, expires_at, consent_given_at",
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
      await admin.from("invitations").update({ status: "expired" }).eq("id", invitation.id);
      await admin
        .from("test_sessions")
        .update({ status: "expired" })
        .eq("application_id", invitation.application_id)
        .in("status", ["not_started", "in_progress"]);
    }

    return { availability: "expired" };
  }

  if (invitation.status === "sent") {
    const openedAt = new Date().toISOString();
    await admin
      .from("invitations")
      .update({ opened_at: openedAt, status: "opened" })
      .eq("id", invitation.id)
      .eq("status", "sent");
    invitation.status = "opened";
  }

  const [companyResult, jobResult, candidateResult, sessionsResult] = await Promise.all([
    admin.from("companies").select("name").eq("id", invitation.company_id).maybeSingle(),
    admin
      .from("jobs")
      .select(
        "id, title, department, location, assessment_packages(id, title, description, assessment_package_tests(order_index, test_version_id, test_versions(id, title, description, instructions, duration_minutes, settings_json, status)))",
      )
      .eq("id", invitation.job_id)
      .eq("company_id", invitation.company_id)
      .maybeSingle(),
    admin
      .from("candidates")
      .select("id, full_name, email, phone, city, profile_completed_at")
      .eq("id", invitation.candidate_id)
      .eq("company_id", invitation.company_id)
      .maybeSingle(),
    admin
      .from("test_sessions")
      .select("id, test_version_id, status, started_at, completed_at, deadline_at")
      .eq("application_id", invitation.application_id),
  ]);

  if (
    companyResult.error ||
    jobResult.error ||
    candidateResult.error ||
    sessionsResult.error ||
    !companyResult.data ||
    !jobResult.data ||
    !candidateResult.data
  ) {
    return { availability: "invalid" };
  }

  const job = jobResult.data as unknown as JobRecord;
  const candidate = candidateResult.data as CandidateRecord;
  const { assessmentPackage, tests } = normalizeTests(job);
  const testsByVersion = new Map(tests.map((test) => [test.versionId, test]));
  const sessions = ((sessionsResult.data ?? []) as SessionRecord[])
    .flatMap((session) => {
      const test = testsByVersion.get(session.test_version_id);
      return test ? [{ ...session, test }] : [];
    })
    .map((session) => ({
      completedAt: session.completed_at,
      deadlineAt: session.deadline_at,
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
    await scoreCompletedApplication(invitation.application_id);
    const [{ error: invitationUpdateError }, { error: applicationUpdateError }] =
      await Promise.all([
        admin.from("invitations").update({ status: "completed" }).eq("id", invitation.id),
        admin
          .from("candidate_applications")
          .update({
            completed_at: completedAt,
            current_stage: "assessment_completed",
            status: "completed",
          })
          .eq("id", invitation.application_id),
      ]);

    if (!invitationUpdateError && !applicationUpdateError) {
      invitation.status = "completed";
    }
  }

  return {
    applicationId: invitation.application_id,
    availability: invitation.status === "completed" ? "completed" : "active",
    candidate: {
      city: candidate.city,
      email: candidate.email,
      fullName: candidate.full_name ?? "",
      id: candidate.id,
      phone: candidate.phone,
      profileCompletedAt: candidate.profile_completed_at,
    },
    companyName: companyResult.data.name,
    consentGivenAt: invitation.consent_given_at,
    invitationId: invitation.id,
    invitationStatus: invitation.status,
    job: {
      department: job.department,
      location: job.location,
      title: job.title,
    },
    package: {
      description: assessmentPackage.description,
      title: assessmentPackage.title,
    },
    sessions,
    tests,
    totalDurationMinutes: tests.reduce((sum, test) => sum + (test.durationMinutes ?? 0), 0),
  };
}

export async function getAssessmentQuestionPageData(
  token: string,
  sessionId: string,
  currentAssessment?: ActiveAssessment,
): Promise<AssessmentQuestionPageData | null> {
  const assessment = currentAssessment ?? (await getAssessmentByToken(token));

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
        .from("candidate_answers")
        .select("question_id, selected_option_id, answer_text, answer_json, is_correct, time_spent_seconds")
        .eq("session_id", session.id),
    ]);

  if (sectionsError || answersError) {
    throw new Error("Unable to load candidate assessment questions.");
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
            maxSelections:
              typeof settings.maxSelections === "number"
                ? settings.maxSelections
                : canonicalOptions.length,
            minSelections:
              typeof settings.minSelections === "number"
                ? settings.minSelections
                : settings.required === false
                  ? 0
                  : 1,
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
          timeSpentSeconds: answer.time_spent_seconds,
        },
      ]),
    ),
    assessment,
    questions,
    sections,
    session,
  };
}
