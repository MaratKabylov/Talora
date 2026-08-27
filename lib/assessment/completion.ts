import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeCompletedCandidateAssessment } from "@/lib/scoring/finalization";

import { getAssessmentByToken, type ActiveAssessment } from "./data";

export type CandidateSessionSubmissionReason = "candidate" | "time_expired";

function testPath(token: string, sessionId: string) {
  return `/assessment/${token}/test/${sessionId}`;
}

function deadlineFrom(startedAt: Date, durationMinutes: number | null) {
  return durationMinutes === null
    ? null
    : new Date(startedAt.getTime() + durationMinutes * 60_000).toISOString();
}

export async function startCandidateSession(
  assessment: ActiveAssessment,
  sessionId: string,
) {
  const session = assessment.sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    throw new Error("Candidate session is not assigned to the assessment.");
  }

  const admin = createAdminClient();
  const startedAt = new Date();
  const { error } = await admin
    .from("test_sessions")
    .update({
      deadline_at: deadlineFrom(startedAt, session.test.durationMinutes),
      started_at: startedAt.toISOString(),
      status: "in_progress",
    })
    .eq("application_id", assessment.applicationId)
    .eq("id", sessionId)
    .eq("status", "not_started");

  if (error) {
    throw new Error("Unable to start candidate test session.");
  }
}

function elapsedSeconds(startedAt: string | null, completedAt: Date) {
  if (!startedAt) {
    return null;
  }

  return Math.max(0, Math.round((completedAt.getTime() - new Date(startedAt).getTime()) / 1000));
}

export async function completeCandidateSessionAndGetPath(
  token: string,
  assessment: ActiveAssessment,
  sessionId: string,
  reason: CandidateSessionSubmissionReason,
) {
  const session = assessment.sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    throw new Error("Candidate session is not assigned to the assessment.");
  }

  const admin = createAdminClient();
  const completedAt = new Date();
  const { error } = await admin
    .from("test_sessions")
    .update({
      active_client_id_hash: null,
      active_device_id_hash: null,
      completed_at: completedAt.toISOString(),
      last_heartbeat_at: null,
      lease_expires_at: null,
      status: "completed",
      submission_reason: reason,
      time_spent_seconds: elapsedSeconds(session.startedAt, completedAt),
    })
    .eq("application_id", assessment.applicationId)
    .eq("id", sessionId)
    .eq("status", "in_progress");

  if (error) {
    throw new Error("Unable to complete candidate test session.");
  }

  const finalization = await finalizeCompletedCandidateAssessment({
    applicationId: assessment.applicationId,
    invitationId: assessment.invitationId,
  });

  if (finalization !== "not_ready") {
    return `/assessment/${token}/complete`;
  }

  const refreshed = await getAssessmentByToken(token);
  if (refreshed.availability === "completed") {
    return `/assessment/${token}/complete`;
  }

  if (refreshed.availability !== "active") {
    return `/assessment/${token}`;
  }

  const nextSession =
    refreshed.sessions.find((entry) => entry.status === "in_progress") ??
    refreshed.sessions.find((entry) => entry.status === "not_started");

  if (!nextSession) {
    return `/assessment/${token}`;
  }

  if (nextSession.status === "not_started") {
    await startCandidateSession(refreshed, nextSession.id);
  }

  return testPath(token, nextSession.id);
}
