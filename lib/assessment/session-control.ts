import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import { completeCandidateSessionAndGetPath } from "./completion";
import { getAssessmentByToken } from "./data";

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
  scaleValue?: number | null;
  selectedOptionId?: string | null;
  selectedOptionIds?: string[];
};

export type CandidateSessionControlResponse =
  | { deadlineAt: string | null; savedAt?: string; status: "active" }
  | { retryAfterSeconds: number; status: "blocked" }
  | { redirectTo: string; status: "redirect" };

type InvitationRecord = {
  application_id: string;
  company_id: string;
  expires_at: string | null;
  id: string;
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
};

type CandidateSessionAccess = {
  admin: ReturnType<typeof createAdminClient>;
  invitation: InvitationRecord;
  session: SessionRecord;
};

type ClientIdentity = {
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
  clientId: z.string().uuid(),
  deviceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  token: z.string().regex(TOKEN_PATTERN),
});

function hashIdentifier(token: string, value: string) {
  return createHash("sha256").update(`${token}:${value}`).digest("hex");
}

function isPast(value: string | null) {
  return Boolean(value && new Date(value).getTime() <= Date.now());
}

function leaseExpiry() {
  return new Date(Date.now() + SESSION_LEASE_MS).toISOString();
}

async function redirectForAssessment(token: string) {
  const assessment = await getAssessmentByToken(token);
  if (assessment.availability === "completed") {
    return `/assessment/${token}/complete`;
  }

  if (assessment.availability !== "active") {
    return `/assessment/${token}`;
  }

  const activeSession = assessment.sessions.find((session) => session.status === "in_progress");
  return activeSession
    ? `/assessment/${token}/test/${activeSession.id}`
    : `/assessment/${token}/profile`;
}

async function loadCandidateSessionAccess(
  identity: ClientIdentity,
): Promise<CandidateSessionAccess | null> {
  const parsed = identitySchema.safeParse(identity);
  if (!parsed.success) {
    return null;
  }

  const admin = createAdminClient();
  const { data: invitationData, error: invitationError } = await admin
    .from("invitations")
    .select("id, company_id, application_id, status, expires_at")
    .eq("token", parsed.data.token)
    .maybeSingle();

  if (invitationError || !invitationData) {
    return null;
  }

  const invitation = invitationData as InvitationRecord;
  if (
    invitation.status !== "started" ||
    (invitation.expires_at && new Date(invitation.expires_at).getTime() <= Date.now())
  ) {
    return null;
  }

  const { data: sessionData, error: sessionError } = await admin
    .from("test_sessions")
    .select(
      "id, test_version_id, status, started_at, deadline_at, active_client_id_hash, active_device_id_hash, lease_expires_at, last_heartbeat_at",
    )
    .eq("application_id", invitation.application_id)
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
        .from("test_sessions")
        .update({ deadline_at: session.deadline_at })
        .eq("id", session.id)
        .is("deadline_at", null);

      if (deadlineError) {
        throw new Error("Unable to establish the assessment deadline.");
      }
    }
  }

  return { admin, invitation, session };
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
  const { error } = await access.admin.from("assessment_session_events").upsert(
    {
      application_id: access.invitation.application_id,
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

  const assessment = await getAssessmentByToken(identity.token);
  if (assessment.availability !== "active") {
    return { redirectTo: await redirectForAssessment(identity.token), status: "redirect" };
  }

  const redirectTo = await completeCandidateSessionAndGetPath(
    identity.token,
    assessment,
    identity.sessionId,
    "time_expired",
  );
  return { redirectTo, status: "redirect" };
}

async function touchOwnedLease(
  identity: ClientIdentity,
  access: CandidateSessionAccess,
): Promise<CandidateSessionControlResponse | null> {
  if (access.session.status !== "in_progress") {
    return { redirectTo: await redirectForAssessment(identity.token), status: "redirect" };
  }

  if (isPast(access.session.deadline_at)) {
    return expireCandidateSession(identity, access);
  }

  const now = new Date().toISOString();
  const clientHash = hashIdentifier(identity.token, identity.clientId);
  const deviceHash = hashIdentifier(identity.token, identity.deviceId);
  const { data, error } = await access.admin
    .from("test_sessions")
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
    return { redirectTo: `/assessment/${identity.token}`, status: "redirect" };
  }

  if (access.session.status !== "in_progress") {
    return { redirectTo: await redirectForAssessment(identity.token), status: "redirect" };
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
    .from("test_sessions")
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
    return { redirectTo: `/assessment/${identity.token}`, status: "redirect" };
  }

  const blockedOrRedirect = await touchOwnedLease(identity, access);
  return blockedOrRedirect ?? { deadlineAt: access.session.deadline_at, status: "active" };
}

export async function recordCandidateSessionEvent(
  input: IntegrityEventInput,
): Promise<CandidateSessionControlResponse> {
  const access = await loadCandidateSessionAccess(input);
  if (!access) {
    return { redirectTo: `/assessment/${input.token}`, status: "redirect" };
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
  answer_options?: Array<{ id: string }> | null;
  id: string;
  question_type: string;
  section_id: string;
  settings_json: { max?: number; min?: number } | null;
};

async function answerRowForDraft(
  access: CandidateSessionAccess,
  questionId: string,
  draft: AssessmentAnswerDraft,
) {
  const { data: questionData, error: questionError } = await access.admin
    .from("questions")
    .select("id, section_id, question_type, settings_json, answer_options(id)")
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
      return null;
    }
    if (selectedIds.some((id) => !optionIds.has(id))) {
      throw new Error("Invalid answer options.");
    }
    return {
      answer_json: { selectedOptionIds: selectedIds },
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

  const answerText = draft.answerText?.trim() ?? "";
  if (!answerText) {
    return null;
  }
  if (answerText.length > 4000) {
    throw new Error("Assessment answer is too long.");
  }
  return { answer_json: {}, answer_text: answerText, selected_option_id: null };
}

export async function autosaveCandidateAnswer(
  identity: ClientIdentity & { answer: AssessmentAnswerDraft; questionId: string },
): Promise<CandidateSessionControlResponse> {
  const access = await loadCandidateSessionAccess(identity);
  if (!access) {
    return { redirectTo: `/assessment/${identity.token}`, status: "redirect" };
  }

  const blockedOrRedirect = await touchOwnedLease(identity, access);
  if (blockedOrRedirect) {
    return blockedOrRedirect;
  }

  const answer = await answerRowForDraft(access, identity.questionId, identity.answer);
  const query = access.admin.from("candidate_answers");
  const { error } = answer
    ? await query.upsert(
        {
          ...answer,
          is_correct: null,
          points_awarded: null,
          question_id: identity.questionId,
          session_id: identity.sessionId,
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

  return {
    deadlineAt: access.session.deadline_at,
    savedAt: new Date().toISOString(),
    status: "active",
  };
}

export async function expireCandidateSessionIfNeeded(
  identity: ClientIdentity & { clientEventId: string },
): Promise<CandidateSessionControlResponse> {
  const access = await loadCandidateSessionAccess(identity);
  if (!access) {
    return { redirectTo: `/assessment/${identity.token}`, status: "redirect" };
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
