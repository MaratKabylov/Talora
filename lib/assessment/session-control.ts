import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  ForcedChoiceAnswerValidationError,
  validateForcedChoiceAnswer,
} from "@/lib/forced-choice";
import {
  MultipleChoiceAnswerValidationError,
  validateMultipleChoiceAnswer,
} from "@/lib/answers/multiple-choice";
import { normalizePresentationSettings } from "@/lib/tests/presentation-settings";
import {
  isStructuredQuestion,
  validateMatchingAnswer,
  validateOrderingAnswer,
} from "@/lib/structured-questions";
import { completeEmployeeAssessmentSessionAndGetPath } from "@/lib/employee-assessments/completion";
import {
  getEmployeeAssessmentByToken,
  getEmployeeAssessmentQuestionPageData,
} from "@/lib/employee-assessments/public-data";

import { completeCandidateSessionAndGetPath } from "./completion";
import {
  getAssessmentByToken,
  getAssessmentQuestionPageData,
  type AssessmentQuestionPageData,
} from "./data";

const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const SESSION_LEASE_MS = 90_000;

export const ASSESSMENT_INTEGRITY_EVENT_TYPES = [
  "focus_lost",
  "focus_returned",
  "clipboard_copy",
  "clipboard_cut",
  "clipboard_paste",
] as const;

export type AssessmentIntegrityEventType =
  (typeof ASSESSMENT_INTEGRITY_EVENT_TYPES)[number];

export type AssessmentAnswerDraft = {
  answerText?: string | null;
  leastOptionId?: string | null;
  mostOptionId?: string | null;
  matches?: Array<{ optionId: string; targetId: string }>;
  orderedOptionIds?: string[];
  scaleValue?: number | null;
  selectedOptionId?: string | null;
  selectedOptionIds?: string[];
};

export type CandidateSessionControlResponse =
  | {
      answerIsCorrect?: boolean | null;
      deadlineAt: string | null;
      incorrectFeedback?: string | null;
      savedAt?: string;
      status: "active";
    }
  | { retryAfterSeconds: number; status: "blocked" }
  | { redirectTo: string; status: "redirect" };

type InvitationRecord = {
  company_id: string;
  expires_at: string | null;
  id: string;
  owner_id: string;
  status: string;
};

type SessionRecord = {
  active_client_id_hash: string | null;
  active_device_id_hash: string | null;
  deadline_at: string | null;
  id: string;
  last_heartbeat_at: string | null;
  lease_expires_at: string | null;
  started_at: string | null;
  status: string;
  test_version_id: string;
  test_versions:
    | { settings_json: unknown }
    | Array<{ settings_json: unknown }>
    | null;
};

type AssessmentType = "candidate" | "employee";

type CandidateSessionAccess = {
  admin: ReturnType<typeof createAdminClient>;
  assessmentType: AssessmentType;
  invitation: InvitationRecord;
  session: SessionRecord;
};

type ClientIdentity = {
  assessmentType?: AssessmentType;
  clientId: string;
  deviceId: string;
  sessionId: string;
  token: string;
};

type IntegrityEventInput = ClientIdentity & {
  clientEventId: string;
  clientOccurredAt?: string | null;
  eventType: AssessmentIntegrityEventType;
  metadata?: Record<string, unknown>;
  questionId?: string | null;
};

const identitySchema = z.object({
  assessmentType: z.enum(["candidate", "employee"]).default("candidate"),
  clientId: z.string().uuid(),
  deviceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  token: z.string().regex(TOKEN_PATTERN),
});

function assessmentType(identity: ClientIdentity): AssessmentType {
  return identity.assessmentType ?? "candidate";
}

function assessmentRoot(identity: ClientIdentity) {
  return assessmentType(identity) === "employee"
    ? `/employee-assessment/${identity.token}`
    : `/assessment/${identity.token}`;
}

function sessionTable(type: AssessmentType) {
  return type === "employee" ? "employee_assessment_sessions" : "test_sessions";
}

function answerTable(type: AssessmentType) {
  return type === "employee" ? "employee_assessment_answers" : "candidate_answers";
}

function ownerColumn(type: AssessmentType) {
  return type === "employee" ? "participant_id" : "application_id";
}

function hashIdentifier(token: string, value: string) {
  return createHash("sha256").update(`${token}:${value}`).digest("hex");
}

function isPast(value: string | null) {
  return Boolean(value && new Date(value).getTime() <= Date.now());
}

function leaseExpiry() {
  return new Date(Date.now() + SESSION_LEASE_MS).toISOString();
}

function presentationSettingsForSession(session: SessionRecord) {
  const version = Array.isArray(session.test_versions)
    ? session.test_versions[0] ?? null
    : session.test_versions;
  return normalizePresentationSettings(version?.settings_json);
}

async function redirectForAssessment(identity: ClientIdentity) {
  const type = assessmentType(identity);
  const assessment =
    type === "employee"
      ? await getEmployeeAssessmentByToken(identity.token)
      : await getAssessmentByToken(identity.token);
  if (assessment.availability === "completed") {
    return `${assessmentRoot(identity)}/complete`;
  }

  if (assessment.availability !== "active") {
    return assessmentRoot(identity);
  }

  const activeSession = assessment.sessions.find((session) => session.status === "in_progress");
  return activeSession
    ? `${assessmentRoot(identity)}/test/${activeSession.id}`
    : `${assessmentRoot(identity)}/profile`;
}

async function loadCandidateSessionAccess(
  identity: ClientIdentity,
): Promise<CandidateSessionAccess | null> {
  const parsed = identitySchema.safeParse(identity);
  if (!parsed.success) {
    return null;
  }

  const admin = createAdminClient();
  const type = parsed.data.assessmentType;
  const invitationTable =
    type === "employee" ? "employee_assessment_invitations" : "invitations";
  const invitationOwnerColumn = ownerColumn(type);
  const { data: invitationData, error: invitationError } = await admin
    .from(invitationTable)
    .select(`id, company_id, ${invitationOwnerColumn}, status, expires_at`)
    .eq("token", parsed.data.token)
    .maybeSingle();

  if (invitationError || !invitationData) {
    return null;
  }

  const invitationRow = invitationData as unknown as Record<string, unknown>;
  const ownerId = invitationRow[invitationOwnerColumn];
  if (typeof ownerId !== "string") {
    return null;
  }
  const invitation: InvitationRecord = {
    company_id: String(invitationRow.company_id),
    expires_at:
      typeof invitationRow.expires_at === "string" ? invitationRow.expires_at : null,
    id: String(invitationRow.id),
    owner_id: ownerId,
    status: String(invitationRow.status),
  };
  if (
    invitation.status !== "started" ||
    (invitation.expires_at && new Date(invitation.expires_at).getTime() <= Date.now())
  ) {
    return null;
  }

  const { data: sessionData, error: sessionError } = await admin
    .from(sessionTable(type))
    .select(
      "id, test_version_id, status, started_at, deadline_at, active_client_id_hash, active_device_id_hash, lease_expires_at, last_heartbeat_at, test_versions(settings_json)",
    )
    .eq(invitationOwnerColumn, invitation.owner_id)
    .eq("id", parsed.data.sessionId)
    .maybeSingle();

  if (sessionError || !sessionData) {
    return null;
  }

  const session = sessionData as SessionRecord;
  if (session.status === "in_progress" && session.started_at && !session.deadline_at) {
    const { data: versionData, error: versionError } = await admin
      .from("test_versions")
      .select("duration_minutes")
      .eq("id", session.test_version_id)
      .maybeSingle();

    if (versionError) {
      throw new Error("Unable to load the assessment duration.");
    }

    const durationMinutes = versionData?.duration_minutes;
    if (typeof durationMinutes === "number") {
      session.deadline_at = new Date(
        new Date(session.started_at).getTime() + durationMinutes * 60_000,
      ).toISOString();
      const { error: deadlineError } = await admin
        .from(sessionTable(type))
        .update({ deadline_at: session.deadline_at })
        .eq("id", session.id)
        .is("deadline_at", null);

      if (deadlineError) {
        throw new Error("Unable to establish the assessment deadline.");
      }
    }
  }

  return { admin, assessmentType: type, invitation, session };
}

async function insertIntegrityEvent(
  access: CandidateSessionAccess,
  input: {
    clientEventId: string;
    clientOccurredAt?: string | null;
    eventType:
      | AssessmentIntegrityEventType
      | "concurrent_session_blocked"
      | "session_recovered"
      | "timer_expired";
    metadata?: Record<string, unknown>;
    questionId?: string | null;
  },
) {
  const eventTable =
    access.assessmentType === "employee"
      ? "employee_assessment_session_events"
      : "assessment_session_events";
  const eventOwner =
    access.assessmentType === "employee"
      ? { participant_id: access.invitation.owner_id }
      : { application_id: access.invitation.owner_id };
  const { error } = await access.admin.from(eventTable).upsert(
    {
      ...eventOwner,
      client_event_id: input.clientEventId,
      client_occurred_at: input.clientOccurredAt ?? null,
      company_id: access.invitation.company_id,
      event_type: input.eventType,
      metadata: input.metadata ?? {},
      question_id: input.questionId ?? null,
      session_id: access.session.id,
    },
    { ignoreDuplicates: true, onConflict: "session_id,client_event_id" },
  );

  if (error) {
    throw new Error("Unable to record the assessment integrity event.");
  }
}

async function expireCandidateSession(
  identity: ClientIdentity,
  access: CandidateSessionAccess,
  clientEventId: string = randomUUID(),
): Promise<CandidateSessionControlResponse> {
  await insertIntegrityEvent(access, {
    clientEventId,
    eventType: "timer_expired",
  });

  const redirectTo =
    access.assessmentType === "employee"
      ? await (async () => {
          const assessment = await getEmployeeAssessmentByToken(identity.token);
          if (assessment.availability !== "active") {
            return redirectForAssessment(identity);
          }
          return completeEmployeeAssessmentSessionAndGetPath(
            identity.token,
            assessment,
            identity.sessionId,
            "time_expired",
          );
        })()
      : await (async () => {
          const assessment = await getAssessmentByToken(identity.token);
          if (assessment.availability !== "active") {
            return redirectForAssessment(identity);
          }
          return completeCandidateSessionAndGetPath(
            identity.token,
            assessment,
            identity.sessionId,
            "time_expired",
          );
        })();
  return { redirectTo, status: "redirect" };
}

async function touchOwnedLease(
  identity: ClientIdentity,
  access: CandidateSessionAccess,
): Promise<CandidateSessionControlResponse | null> {
  if (access.session.status !== "in_progress") {
    return { redirectTo: await redirectForAssessment(identity), status: "redirect" };
  }

  if (isPast(access.session.deadline_at)) {
    return expireCandidateSession(identity, access);
  }

  const now = new Date().toISOString();
  const clientHash = hashIdentifier(identity.token, identity.clientId);
  const deviceHash = hashIdentifier(identity.token, identity.deviceId);
  const { data, error } = await access.admin
    .from(sessionTable(access.assessmentType))
    .update({ last_heartbeat_at: now, lease_expires_at: leaseExpiry() })
    .eq("id", access.session.id)
    .eq("status", "in_progress")
    .eq("active_client_id_hash", clientHash)
    .eq("active_device_id_hash", deviceHash)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error("Unable to renew the assessment session.");
  }

  return data ? null : { retryAfterSeconds: 90, status: "blocked" };
}

export async function claimCandidateSession(
  identity: ClientIdentity & { clientEventId: string },
): Promise<CandidateSessionControlResponse> {
  const access = await loadCandidateSessionAccess(identity);
  if (!access) {
    return { redirectTo: assessmentRoot(identity), status: "redirect" };
  }

  if (access.session.status !== "in_progress") {
    return { redirectTo: await redirectForAssessment(identity), status: "redirect" };
  }

  if (isPast(access.session.deadline_at)) {
    return expireCandidateSession(identity, access, identity.clientEventId);
  }

  const now = new Date().toISOString();
  const clientHash = hashIdentifier(identity.token, identity.clientId);
  const deviceHash = hashIdentifier(identity.token, identity.deviceId);
  const previousClientHash = access.session.active_client_id_hash;
  const previousDeviceHash = access.session.active_device_id_hash;
  const previousLeaseExpired =
    !access.session.lease_expires_at || isPast(access.session.lease_expires_at);
  const alreadyOwned = previousClientHash === clientHash && previousDeviceHash === deviceHash;
  const canTakeOver = !previousClientHash || previousLeaseExpired;

  if (!alreadyOwned && !canTakeOver) {
    await insertIntegrityEvent(access, {
      clientEventId: identity.clientEventId,
      eventType: "concurrent_session_blocked",
      metadata: { sameDevice: previousDeviceHash === deviceHash },
    });
    return { retryAfterSeconds: 90, status: "blocked" };
  }

  let claimQuery = access.admin
    .from(sessionTable(access.assessmentType))
    .update({
      active_client_id_hash: clientHash,
      active_device_id_hash: deviceHash,
      last_heartbeat_at: now,
      lease_expires_at: leaseExpiry(),
    })
    .eq("id", access.session.id)
    .eq("status", "in_progress");

  if (alreadyOwned) {
    claimQuery = claimQuery
      .eq("active_client_id_hash", clientHash)
      .eq("active_device_id_hash", deviceHash);
  } else {
    claimQuery = previousClientHash
      ? claimQuery.eq("active_client_id_hash", previousClientHash)
      : claimQuery.is("active_client_id_hash", null);
    claimQuery = previousDeviceHash
      ? claimQuery.eq("active_device_id_hash", previousDeviceHash)
      : claimQuery.is("active_device_id_hash", null);
    claimQuery = access.session.lease_expires_at
      ? claimQuery.lte("lease_expires_at", now)
      : claimQuery.is("lease_expires_at", null);
  }

  const { data, error } = await claimQuery.select("id").maybeSingle();

  if (error) {
    throw new Error("Unable to claim the assessment session.");
  }

  if (!data) {
    await insertIntegrityEvent(access, {
      clientEventId: identity.clientEventId,
      eventType: "concurrent_session_blocked",
      metadata: { sameDevice: previousDeviceHash === deviceHash },
    });
    return { retryAfterSeconds: 90, status: "blocked" };
  }

  if (previousClientHash && previousClientHash !== clientHash && previousLeaseExpired) {
    await insertIntegrityEvent(access, {
      clientEventId: identity.clientEventId,
      eventType: "session_recovered",
      metadata: { changedDevice: Boolean(previousDeviceHash && previousDeviceHash !== deviceHash) },
    });
  }

  return { deadlineAt: access.session.deadline_at, status: "active" };
}

export async function heartbeatCandidateSession(
  identity: ClientIdentity,
): Promise<CandidateSessionControlResponse> {
  const access = await loadCandidateSessionAccess(identity);
  if (!access) {
    return { redirectTo: assessmentRoot(identity), status: "redirect" };
  }

  const blockedOrRedirect = await touchOwnedLease(identity, access);
  return blockedOrRedirect ?? { deadlineAt: access.session.deadline_at, status: "active" };
}

export async function recordCandidateSessionEvent(
  input: IntegrityEventInput,
): Promise<CandidateSessionControlResponse> {
  const access = await loadCandidateSessionAccess(input);
  if (!access) {
    return { redirectTo: assessmentRoot(input), status: "redirect" };
  }

  const blockedOrRedirect = await touchOwnedLease(input, access);
  if (blockedOrRedirect) {
    return blockedOrRedirect;
  }

  const durationMs = input.metadata?.durationMs;
  const metadata =
    input.eventType === "focus_returned" && typeof durationMs === "number"
      ? { durationMs: Math.min(Math.max(Math.round(durationMs), 0), 86_400_000) }
      : {};

  await insertIntegrityEvent(access, {
    clientEventId: input.clientEventId,
    clientOccurredAt: input.clientOccurredAt,
    eventType: input.eventType,
    metadata,
    questionId: input.questionId,
  });

  return { deadlineAt: access.session.deadline_at, status: "active" };
}

type QuestionRecord = {
  answer_options?: Array<{
    id: string;
    is_correct: boolean | null;
    match_target_id: string;
  }> | null;
  id: string;
  question_type: string;
  section_id: string;
  settings_json: {
    incorrectFeedback?: string;
    max?: number;
    maxSelections?: number;
    mode?: string;
    min?: number;
    minSelections?: number;
    remediationQuestionId?: string;
    required?: boolean;
    structuredResponseVersion?: number;
  } | null;
};

async function answerRowForDraft(
  access: CandidateSessionAccess,
  questionId: string,
  draft: AssessmentAnswerDraft,
  requireComplete = false,
) {
  const { data: questionData, error: questionError } = await access.admin
    .from("questions")
    .select("id, section_id, question_type, settings_json, answer_options(id, is_correct, match_target_id)")
    .eq("id", questionId)
    .maybeSingle();

  if (questionError || !questionData) {
    throw new Error("Assessment question was not found.");
  }

  const question = questionData as unknown as QuestionRecord;
  const { data: sectionData, error: sectionError } = await access.admin
    .from("test_sections")
    .select("id")
    .eq("id", question.section_id)
    .eq("test_version_id", access.session.test_version_id)
    .maybeSingle();

  if (sectionError || !sectionData) {
    throw new Error("Assessment question does not belong to the active test.");
  }

  const optionIds = new Set((question.answer_options ?? []).map((option) => option.id));
  if (question.question_type === "forced_choice") {
    if (!draft.mostOptionId && !draft.leastOptionId) {
      if (requireComplete && question.settings_json?.required !== false) {
        const validation = validateForcedChoiceAnswer(
          draft,
          optionIds,
          question.settings_json?.mode,
        );
        if (!validation.ok) {
          throw new ForcedChoiceAnswerValidationError(validation.error);
        }
      }
      return null;
    }
    const validation = validateForcedChoiceAnswer(
      draft,
      optionIds,
      question.settings_json?.mode,
    );
    if (!validation.ok) {
      if (!requireComplete && (!draft.mostOptionId || !draft.leastOptionId)) {
        return null;
      }
      throw new ForcedChoiceAnswerValidationError(validation.error);
    }
    return {
      answer_json: validation.answer,
      answer_text: null,
      selected_option_id: null,
    };
  }

  if (question.question_type === "single_choice") {
    if (!draft.selectedOptionId) {
      return null;
    }
    if (!optionIds.has(draft.selectedOptionId)) {
      throw new Error("Invalid answer option.");
    }
    return { answer_json: {}, answer_text: null, selected_option_id: draft.selectedOptionId };
  }

  if (question.question_type === "multiple_choice") {
    const selectedIds = [...new Set(draft.selectedOptionIds ?? [])];
    if (selectedIds.length === 0) {
      if (!requireComplete) return null;
      if (question.settings_json?.required !== false) {
        throw new MultipleChoiceAnswerValidationError(
          `Выберите от ${question.settings_json?.minSelections ?? 1} до ${question.settings_json?.maxSelections ?? optionIds.size} вариантов.`,
        );
      }
    }
    const required = question.settings_json?.required ?? true;
    const validation = validateMultipleChoiceAnswer(
      selectedIds.length === 0 && !required
        ? { skipped: true }
        : { selectedOptionIds: selectedIds },
      optionIds,
      {
        maxSelections: question.settings_json?.maxSelections ?? optionIds.size,
        minSelections: question.settings_json?.minSelections ?? (required ? 1 : 0),
        required,
      },
      { requireUuid: true },
    );
    if (!validation.ok) {
      throw new MultipleChoiceAnswerValidationError(validation.error);
    }
    return {
      answer_json: validation.answer,
      answer_text: null,
      selected_option_id: null,
    };
  }

  if (question.question_type === "scale") {
    if (draft.scaleValue === null || draft.scaleValue === undefined) {
      return null;
    }
    const minimum = question.settings_json?.min ?? 1;
    const maximum = question.settings_json?.max ?? 5;
    if (
      !Number.isInteger(draft.scaleValue) ||
      draft.scaleValue < minimum ||
      draft.scaleValue > maximum
    ) {
      throw new Error("Invalid scale value.");
    }
    return {
      answer_json: { value: draft.scaleValue },
      answer_text: String(draft.scaleValue),
      selected_option_id: null,
    };
  }

  if (question.question_type === "ordering" && isStructuredQuestion(question.settings_json)) {
    if (!draft.orderedOptionIds?.length) return null;
    const validation = validateOrderingAnswer(draft, [...optionIds]);
    if (!validation.ok) throw new Error(validation.error);
    return {
      answer_json: validation.answer,
      answer_text: null,
      selected_option_id: null,
    };
  }

  if (question.question_type === "matching" && isStructuredQuestion(question.settings_json)) {
    if (!draft.matches?.length) return null;
    const validation = validateMatchingAnswer(
      draft,
      (question.answer_options ?? []).map((option) => ({
        id: option.id,
        matchTargetId: option.match_target_id,
      })),
      { allowPartial: !requireComplete },
    );
    if (!validation.ok) throw new Error(validation.error);
    return {
      answer_json: validation.answer,
      answer_text: null,
      selected_option_id: null,
    };
  }

  const answerText = draft.answerText?.trim() ?? "";
  if (!answerText) {
    return null;
  }
  if (answerText.length > 4000) {
    throw new Error("Assessment answer is too long.");
  }
  return { answer_json: {}, answer_text: answerText, selected_option_id: null };
}

async function getControlQuestionPageData(
  identity: ClientIdentity,
): Promise<AssessmentQuestionPageData | null> {
  const data =
    assessmentType(identity) === "employee"
      ? await getEmployeeAssessmentQuestionPageData(identity.token, identity.sessionId)
      : await getAssessmentQuestionPageData(identity.token, identity.sessionId);

  return data as unknown as AssessmentQuestionPageData | null;
}

export async function autosaveCandidateAnswer(
  identity: ClientIdentity & {
    answer: AssessmentAnswerDraft;
    finalize?: boolean;
    questionId: string;
    timeSpentSeconds?: number;
  },
): Promise<CandidateSessionControlResponse> {
  const access = await loadCandidateSessionAccess(identity);
  if (!access) {
    return { redirectTo: assessmentRoot(identity), status: "redirect" };
  }

  const blockedOrRedirect = await touchOwnedLease(identity, access);
  if (blockedOrRedirect) {
    return blockedOrRedirect;
  }

  const presentationSettings = presentationSettingsForSession(access.session);
  const timeSpentSeconds = presentationSettings.captureQuestionTime
    ? identity.timeSpentSeconds
    : undefined;
  if (presentationSettings.presentationMode === "one_question" && !identity.finalize) {
    throw new Error("One-question answers must be finalized explicitly.");
  }

  let oneQuestionData: Awaited<ReturnType<typeof getAssessmentQuestionPageData>> = null;
  if (presentationSettings.presentationMode === "one_question") {
    oneQuestionData = await getControlQuestionPageData(identity);
    if (!oneQuestionData || oneQuestionData.session.status !== "in_progress") {
      throw new Error("The active assessment question could not be loaded.");
    }

    const existingAnswer = oneQuestionData.answers[identity.questionId];
    if (!presentationSettings.allowBack && existingAnswer) {
      const question = oneQuestionData.questions.find(
        (entry) => entry.id === identity.questionId,
      );
      return {
        answerIsCorrect: existingAnswer.isCorrect,
        deadlineAt: access.session.deadline_at,
        incorrectFeedback:
          existingAnswer.isCorrect === false ? question?.incorrectFeedback ?? null : null,
        savedAt: new Date().toISOString(),
        status: "active",
      };
    }

    if (!presentationSettings.allowBack) {
      const firstIncompleteQuestion = oneQuestionData.sections
        .flatMap((section) =>
          section.questions.filter(
            (question) =>
              (!question.remediationParentId ||
                oneQuestionData!.answers[question.remediationParentId]?.isCorrect === false) &&
              !oneQuestionData!.answers[question.id],
          ),
        )[0];
      if (!firstIncompleteQuestion || firstIncompleteQuestion.id !== identity.questionId) {
        throw new Error("The assessment question is no longer available for editing.");
      }
    }
  }

  const draftAnswer = await answerRowForDraft(
    access,
    identity.questionId,
    identity.answer,
    Boolean(identity.finalize),
  );
  const question = oneQuestionData?.questions.find((entry) => entry.id === identity.questionId);
  if (
    identity.finalize &&
    !draftAnswer &&
    (question?.isRequired || question?.remediationParentId)
  ) {
    throw new Error("A required assessment answer cannot be empty.");
  }
  const answer =
    draftAnswer ??
    (identity.finalize
      ? { answer_json: { skipped: true }, answer_text: null, selected_option_id: null }
      : null);
  let answerIsCorrect: boolean | null = null;
  let incorrectFeedback: string | null = null;

  if (identity.finalize && question?.remediationQuestionId) {
    const { data: keyData, error: keyError } = await access.admin
      .from("questions")
      .select("settings_json, answer_options(id, is_correct)")
      .eq("id", identity.questionId)
      .maybeSingle();
    if (keyError) {
      throw new Error("Unable to evaluate the remediation branch.");
    }
    const answerKey = keyData as unknown as {
      answer_options?: Array<{ id: string; is_correct: boolean | null }> | null;
      settings_json?: { incorrectFeedback?: string } | null;
    } | null;
    const selectedOption = (answerKey?.answer_options ?? []).find(
      (option) => option.id === answer?.selected_option_id,
    );
    answerIsCorrect =
      selectedOption?.is_correct === true
        ? true
        : selectedOption?.is_correct === false
          ? false
          : null;
    incorrectFeedback =
      answerIsCorrect === false && typeof answerKey?.settings_json?.incorrectFeedback === "string"
        ? answerKey.settings_json.incorrectFeedback
        : null;
  }

  const query = access.admin.from(answerTable(access.assessmentType));
  const { error } = answer
    ? await query.upsert(
        {
          ...answer,
          is_correct: answerIsCorrect,
          points_awarded: null,
          question_id: identity.questionId,
          session_id: identity.sessionId,
          ...(timeSpentSeconds === undefined
            ? {}
            : { time_spent_seconds: timeSpentSeconds }),
        },
        { onConflict: "session_id,question_id" },
      )
    : await query
        .delete()
        .eq("session_id", identity.sessionId)
        .eq("question_id", identity.questionId);

  if (error) {
    throw new Error("Unable to autosave the assessment answer.");
  }

  if (
    identity.finalize &&
    question?.remediationQuestionId &&
    answerIsCorrect !== false
  ) {
    const { error: remediationError } = await access.admin
      .from(answerTable(access.assessmentType))
      .delete()
      .eq("session_id", identity.sessionId)
      .eq("question_id", question.remediationQuestionId);
    if (remediationError) {
      throw new Error("Unable to update the remediation branch.");
    }
  }

  return {
    answerIsCorrect,
    deadlineAt: access.session.deadline_at,
    incorrectFeedback,
    savedAt: new Date().toISOString(),
    status: "active",
  };
}

export async function completeOneQuestionCandidateSession(
  identity: ClientIdentity,
): Promise<CandidateSessionControlResponse> {
  const access = await loadCandidateSessionAccess(identity);
  if (!access) {
    return { redirectTo: assessmentRoot(identity), status: "redirect" };
  }

  const blockedOrRedirect = await touchOwnedLease(identity, access);
  if (blockedOrRedirect) {
    return blockedOrRedirect;
  }

  if (presentationSettingsForSession(access.session).presentationMode !== "one_question") {
    throw new Error("This assessment session uses section navigation.");
  }

  const data = await getControlQuestionPageData(identity);
  if (!data || data.session.status !== "in_progress") {
    return { redirectTo: await redirectForAssessment(identity), status: "redirect" };
  }

  const missingQuestion = data.sections
    .flatMap((section) =>
      section.questions.filter(
        (question) =>
          (!question.remediationParentId ||
            data.answers[question.remediationParentId]?.isCorrect === false) &&
          !data.answers[question.id],
      ),
    )[0];
  if (missingQuestion) {
    throw new Error("All visible questions must be finalized before completion.");
  }

  const redirectTo =
    access.assessmentType === "employee"
      ? await (async () => {
          const assessment = await getEmployeeAssessmentByToken(identity.token);
          if (assessment.availability !== "active") {
            return redirectForAssessment(identity);
          }
          return completeEmployeeAssessmentSessionAndGetPath(
            identity.token,
            assessment,
            identity.sessionId,
            "employee",
          );
        })()
      : await completeCandidateSessionAndGetPath(
          identity.token,
          data.assessment,
          identity.sessionId,
          "candidate",
        );
  return { redirectTo, status: "redirect" };
}

export async function expireCandidateSessionIfNeeded(
  identity: ClientIdentity & { clientEventId: string },
): Promise<CandidateSessionControlResponse> {
  const access = await loadCandidateSessionAccess(identity);
  if (!access) {
    return { redirectTo: assessmentRoot(identity), status: "redirect" };
  }

  if (!isPast(access.session.deadline_at)) {
    const blockedOrRedirect = await touchOwnedLease(identity, access);
    return blockedOrRedirect ?? { deadlineAt: access.session.deadline_at, status: "active" };
  }

  return expireCandidateSession(identity, access, identity.clientEventId);
}

export async function guardCandidateSessionSubmission(
  identity: ClientIdentity,
): Promise<CandidateSessionControlResponse> {
  return heartbeatCandidateSession(identity);
}
