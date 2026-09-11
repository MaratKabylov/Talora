import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { measureServerOperation } from "@/lib/observability/server-performance";
import { finalizeCompletedCandidateAssessment, finalizeCompletedEmployeeAssessment } from "@/lib/scoring/finalization";
import { completionRequestSchema, type CompletionRequest, type CompletionResponse } from "./completion-contract";

const resultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ready"), ownerId: z.string().uuid(), invitationId: z.string().uuid() }),
  z.object({ status: z.literal("next"), nextSessionId: z.string().uuid().nullable() }),
  z.object({ status: z.literal("finished") }), z.object({ status: z.literal("unavailable") }),
  z.object({ status: z.literal("expired") }), z.object({ status: z.literal("terminal") }),
  z.object({ status: z.literal("blocked"), retryAfterSeconds: z.number().int().positive() }),
  z.object({ status: z.literal("incomplete"), sectionIndex: z.number().int().nonnegative() }),
]);

export async function completeAssessmentSessionV2(input: CompletionRequest): Promise<CompletionResponse> {
  const request = completionRequestSchema.parse(input);
  const root = `/${request.assessmentType === "employee" ? "employee-assessment" : "assessment"}/${request.token}`;
  const result = await measureServerOperation("assessment.finish_session", async () => {
    const { data, error } = await createAdminClient().rpc("complete_assessment_session_v2", {
      p_scope: request.assessmentType, p_token: request.token, p_session_id: request.sessionId,
      p_client_id: request.clientId, p_device_id: request.deviceId,
    });
    if (error) throw Error("Unable to complete assessment session.");
    return resultSchema.parse(data);
  });
  if (result.status === "blocked" || result.status === "expired" || result.status === "incomplete") return result;
  if (result.status === "next") return { status: "redirect", redirectTo: result.nextSessionId ? `${root}/test/${result.nextSessionId}` : root };
  if (result.status === "finished") return { status: "redirect", redirectTo: `${root}/complete` };
  if (result.status !== "ready") return { status: "redirect", redirectTo: root };
  // No background jobs/new scoring semantics. Last-session retries re-enter the
  // existing claim/idempotency/recovery pipeline even if the SQL commit succeeded.
  const finalization = request.assessmentType === "employee"
    ? await finalizeCompletedEmployeeAssessment({
        invitationId: result.invitationId,
        participantId: result.ownerId,
        readiness: "completion_v2",
      })
    : await finalizeCompletedCandidateAssessment({
        applicationId: result.ownerId,
        invitationId: result.invitationId,
        readiness: "completion_v2",
      });
  if (finalization === "processing") return { status: "processing" };
  return { status: "redirect", redirectTo: finalization === "completed" ? `${root}/complete` : root };
}
