import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import {
  scoreCompletedApplication,
  scoreCompletedEmployeeAssessmentParticipant,
} from "./service";

const SCORING_STAGE = "scoring";
const COMPLETED_STAGE = "assessment_completed";
const SCORING_CLAIM_TTL_MS = 5 * 60_000;

const ACTIVE_INVITATION_STATUSES = ["created", "sent", "opened", "started"];
const ACTIVE_PARENT_STATUSES = ["invited", "in_progress"];

export type AssessmentFinalizationResult =
  | "completed"
  | "not_ready"
  | "processing";

type FinalizationConfig = {
  invitationId: string;
  invitationTable: "invitations" | "employee_assessment_invitations";
  parentId: string;
  parentTable: "candidate_applications" | "employee_assessment_participants";
  score: () => Promise<unknown>;
  sessionParentColumn: "application_id" | "participant_id";
  sessionTable: "test_sessions" | "employee_assessment_sessions";
};

function claimCutoff(now = new Date()) {
  return new Date(now.getTime() - SCORING_CLAIM_TTL_MS).toISOString();
}

function availableClaimFilter(now = new Date()) {
  return [
    "current_stage.is.null",
    `current_stage.neq.${SCORING_STAGE}`,
    `updated_at.lt.${claimCutoff(now)}`,
  ].join(",");
}

async function completeInvitation(config: FinalizationConfig) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from(config.invitationTable)
    .update({ status: "completed" })
    .eq("id", config.invitationId)
    .in("status", ACTIVE_INVITATION_STATUSES)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error("Unable to mark assessment invitation as completed.");
  }

  if (data) {
    return;
  }

  const { data: currentInvitation, error: currentInvitationError } = await admin
    .from(config.invitationTable)
    .select("status")
    .eq("id", config.invitationId)
    .maybeSingle();

  if (currentInvitationError || currentInvitation?.status !== "completed") {
    throw new Error("Assessment invitation is no longer active.");
  }
}

async function releaseScoringClaim(config: FinalizationConfig) {
  const admin = createAdminClient();
  const { error } = await admin
    .from(config.parentTable)
    .update({ current_stage: "assessment", status: "in_progress" })
    .eq("id", config.parentId)
    .eq("current_stage", SCORING_STAGE)
    .in("status", ACTIVE_PARENT_STATUSES);

  if (error) {
    console.error("Unable to release assessment scoring claim.", {
      code: error.code,
      message: error.message,
      parentId: config.parentId,
      parentTable: config.parentTable,
    });
  }
}

async function finalizeCompletedAssessment(
  config: FinalizationConfig,
): Promise<AssessmentFinalizationResult> {
  const admin = createAdminClient();
  const [invitationResult, sessionsResult] = await Promise.all([
    admin
      .from(config.invitationTable)
      .select("status")
      .eq("id", config.invitationId)
      .maybeSingle(),
    admin
      .from(config.sessionTable)
      .select("status")
      .eq(config.sessionParentColumn, config.parentId),
  ]);

  if (invitationResult.error || sessionsResult.error || !invitationResult.data) {
    throw new Error("Unable to verify assessment completion state.");
  }

  if (invitationResult.data.status === "completed") {
    return "completed";
  }

  if (
    !ACTIVE_INVITATION_STATUSES.includes(invitationResult.data.status) ||
    !sessionsResult.data?.length ||
    sessionsResult.data.some((session) => session.status !== "completed")
  ) {
    return "not_ready";
  }

  // PostgreSQL re-checks the UPDATE predicate after taking the row lock. This
  // makes current_stage an atomic scoring claim even when several completion
  // requests arrive at the same time. An old claim can be recovered after TTL.
  const { data: claimedParent, error: claimError } = await admin
    .from(config.parentTable)
    .update({ current_stage: SCORING_STAGE })
    .eq("id", config.parentId)
    .in("status", ACTIVE_PARENT_STATUSES)
    .or(availableClaimFilter())
    .select("id")
    .maybeSingle();

  if (claimError) {
    throw new Error("Unable to claim assessment scoring.");
  }

  if (!claimedParent) {
    const { data: parent, error: parentError } = await admin
      .from(config.parentTable)
      .select("status, current_stage")
      .eq("id", config.parentId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new Error("Unable to read assessment scoring state.");
    }

    if (parent.status === "completed") {
      await completeInvitation(config);
      return "completed";
    }

    return parent.current_stage === SCORING_STAGE ? "processing" : "not_ready";
  }

  try {
    await config.score();

    const { data: completedParent, error: completionError } = await admin
      .from(config.parentTable)
      .update({
        completed_at: new Date().toISOString(),
        current_stage: COMPLETED_STAGE,
        status: "completed",
      })
      .eq("id", config.parentId)
      .eq("current_stage", SCORING_STAGE)
      .in("status", ACTIVE_PARENT_STATUSES)
      .select("id")
      .maybeSingle();

    if (completionError) {
      throw new Error("Unable to mark assessment as completed.");
    }

    if (!completedParent) {
      const { data: parent, error: parentError } = await admin
        .from(config.parentTable)
        .select("status")
        .eq("id", config.parentId)
        .maybeSingle();

      if (parentError || parent?.status !== "completed") {
        throw new Error("Unable to mark assessment as completed.");
      }
    }

    await completeInvitation(config);
    return "completed";
  } catch (error) {
    await releaseScoringClaim(config);
    throw error;
  }
}

export async function finalizeCompletedCandidateAssessment(input: {
  applicationId: string;
  invitationId: string;
}) {
  return finalizeCompletedAssessment({
    invitationId: input.invitationId,
    invitationTable: "invitations",
    parentId: input.applicationId,
    parentTable: "candidate_applications",
    score: () => scoreCompletedApplication(input.applicationId),
    sessionParentColumn: "application_id",
    sessionTable: "test_sessions",
  });
}

export async function finalizeCompletedEmployeeAssessment(input: {
  invitationId: string;
  participantId: string;
}) {
  return finalizeCompletedAssessment({
    invitationId: input.invitationId,
    invitationTable: "employee_assessment_invitations",
    parentId: input.participantId,
    parentTable: "employee_assessment_participants",
    score: () => scoreCompletedEmployeeAssessmentParticipant(input.participantId),
    sessionParentColumn: "participant_id",
    sessionTable: "employee_assessment_sessions",
  });
}
