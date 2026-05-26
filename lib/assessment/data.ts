import { createAdminClient } from "@/lib/supabase/admin";
import { scoreCompletedApplication } from "@/lib/scoring/service";
import type { QuestionType } from "@/lib/tests/builder-constants";

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
        duration_minutes: number | null;
        id: string;
        status: string;
        title: string;
      }
    | {
        duration_minutes: number | null;
        id: string;
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
  id: string;
  started_at: string | null;
  status: "not_started" | "in_progress" | "completed" | "expired" | "cancelled";
  test_version_id: string;
};

type OptionRecord = {
  id: string;
  order_index: number;
  text: string;
};

type QuestionRecord = {
  answer_options?: OptionRecord[] | null;
  description: string | null;
  id: string;
  order_index: number;
  question_type: QuestionType;
  settings_json: { max?: number; min?: number; required?: boolean } | null;
  text: string;
};

type SectionRecord = {
  description: string | null;
  id: string;
  order_index: number;
  questions?: QuestionRecord[] | null;
  title: string;
};

type AnswerRecord = {
  answer_json: Record<string, unknown> | null;
  answer_text: string | null;
  question_id: string;
  selected_option_id: string | null;
};

export type AssessmentTest = {
  durationMinutes: number | null;
  orderIndex: number;
  title: string;
  versionId: string;
};

export type AssessmentSession = {
  completedAt: string | null;
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

export type FlowQuestion = {
  description: string | null;
  id: string;
  isRequired: boolean;
  options: FlowOption[];
  questionType: QuestionType;
  scaleMax: number;
  scaleMin: number;
  sectionTitle: string;
  text: string;
};

export type FlowSection = {
  description: string | null;
  id: string;
  questions: FlowQuestion[];
  title: string;
};

export type AssessmentQuestionPageData = {
  answers: Record<string, {
    answerJson: Record<string, unknown>;
    answerText: string | null;
    selectedOptionId: string | null;
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
          durationMinutes: version.duration_minutes,
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
        "id, title, department, location, assessment_packages(id, title, description, assessment_package_tests(order_index, test_version_id, test_versions(id, title, duration_minutes, status)))",
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
      .select("id, test_version_id, status, started_at, completed_at")
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
          "id, title, description, order_index, questions(id, question_type, text, description, order_index, settings_json, answer_options(id, text, order_index))",
        )
        .eq("test_version_id", session.test.versionId),
      admin
        .from("candidate_answers")
        .select("question_id, selected_option_id, answer_text, answer_json")
        .eq("session_id", session.id),
    ]);

  if (sectionsError || answersError) {
    throw new Error("Unable to load candidate assessment questions.");
  }

  const sections = ((sectionsData ?? []) as unknown as SectionRecord[])
    .sort((left, right) => left.order_index - right.order_index)
    .map((section) => ({
      description: section.description,
      id: section.id,
      questions: (section.questions ?? [])
        .sort((left, right) => left.order_index - right.order_index)
        .map((question) => {
          const settings = question.settings_json ?? {};

          return {
            description: question.description,
            id: question.id,
            isRequired: settings.required ?? true,
            options: (question.answer_options ?? [])
              .slice()
              .sort((left, right) => left.order_index - right.order_index)
              .map((option) => ({ id: option.id, text: option.text })),
            questionType: question.question_type,
            scaleMax: typeof settings.max === "number" ? settings.max : 5,
            scaleMin: typeof settings.min === "number" ? settings.min : 1,
            sectionTitle: section.title,
            text: question.text,
          };
        }),
      title: section.title,
    }));
  const questions = sections.flatMap((section) => section.questions);

  const answers = (answersData ?? []) as AnswerRecord[];
  return {
    answers: Object.fromEntries(
      answers.map((answer) => [
        answer.question_id,
        {
          answerJson: answer.answer_json ?? {},
          answerText: answer.answer_text,
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
