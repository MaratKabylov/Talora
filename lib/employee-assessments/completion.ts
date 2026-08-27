import { createAdminClient } from "@/lib/supabase/admin";

import {
  getEmployeeAssessmentByToken,
  type ActiveEmployeeAssessment,
} from "./public-data";

export type EmployeeSessionSubmissionReason = "employee" | "time_expired";

function testPath(token: string, sessionId: string) {
  return `/employee-assessment/${token}/test/${sessionId}`;
}

function deadlineFrom(startedAt: Date, durationMinutes: number | null) {
  return durationMinutes === null
    ? null
    : new Date(startedAt.getTime() + durationMinutes * 60_000).toISOString();
}

export async function startEmployeeAssessmentSession(
  assessment: ActiveEmployeeAssessment,
  sessionId: string,
) {
  const session = assessment.sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    throw new Error("Employee session is not assigned to the assessment.");
  }

  const admin = createAdminClient();
  const startedAt = new Date();
  const { error } = await admin
    .from("employee_assessment_sessions")
    .update({
      deadline_at: deadlineFrom(startedAt, session.test.durationMinutes),
      started_at: startedAt.toISOString(),
      status: "in_progress",
    })
    .eq("participant_id", assessment.participantId)
    .eq("id", sessionId)
    .eq("status", "not_started");

  if (error) {
    throw new Error("Unable to start employee test session.");
  }
}

function elapsedSeconds(startedAt: string | null, completedAt: Date) {
  if (!startedAt) {
    return null;
  }

  return Math.max(0, Math.round((completedAt.getTime() - new Date(startedAt).getTime()) / 1000));
}

export async function completeEmployeeAssessmentSessionAndGetPath(
  token: string,
  assessment: ActiveEmployeeAssessment,
  sessionId: string,
  reason: EmployeeSessionSubmissionReason,
) {
  const session = assessment.sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    throw new Error("Employee session is not assigned to the assessment.");
  }

  const admin = createAdminClient();
  const completedAt = new Date();
  const { error } = await admin
    .from("employee_assessment_sessions")
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
    .eq("participant_id", assessment.participantId)
    .eq("id", sessionId)
    .eq("status", "in_progress");

  if (error) {
    throw new Error("Unable to complete employee test session.");
  }

  const refreshed = await getEmployeeAssessmentByToken(token);
  if (refreshed.availability === "completed") {
    return `/employee-assessment/${token}/complete`;
  }

  if (refreshed.availability !== "active") {
    return `/employee-assessment/${token}`;
  }

  const nextSession =
    refreshed.sessions.find((entry) => entry.status === "in_progress") ??
    refreshed.sessions.find((entry) => entry.status === "not_started");

  if (!nextSession) {
    return `/employee-assessment/${token}`;
  }

  if (nextSession.status === "not_started") {
    await startEmployeeAssessmentSession(refreshed, nextSession.id);
  }

  return testPath(token, nextSession.id);
}
