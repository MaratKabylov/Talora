import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import {
  finalizeCompletedCandidateAssessment,
  finalizeCompletedEmployeeAssessment,
} from "./finalization";

const enqueueResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("queued"), jobId: z.string().uuid() }),
  z.object({ status: z.literal("processing"), jobId: z.string().uuid() }),
  z.object({ status: z.literal("completed"), jobId: z.string().uuid().optional() }),
  z.object({ status: z.literal("failed"), jobId: z.string().uuid() }),
]);

const claimedJobSchema = z.object({
  attempt: z.number().int().positive(),
  expectedRevision: z.number().int().nonnegative(),
  invitationId: z.string().uuid(),
  jobId: z.string().uuid(),
  parentId: z.string().uuid(),
  scope: z.enum(["candidate", "employee"]),
});

const finishResultSchema = z.object({
  status: z.enum(["completed", "retry", "failed"]),
});

export type ScoringQueueStatus = z.infer<typeof enqueueResultSchema>["status"];

export async function enqueueAssessmentScoring(input: {
  invitationId: string;
  parentId: string;
  retryFailed?: boolean;
  scope: "candidate" | "employee";
}): Promise<ScoringQueueStatus> {
  const { data, error } = await createAdminClient().rpc("enqueue_scoring_job", {
    p_invitation_id: input.invitationId,
    p_parent_id: input.parentId,
    p_retry_failed: input.retryFailed ?? false,
    p_scope: input.scope,
  });
  if (error) throw new Error("Unable to enqueue assessment scoring.");
  return enqueueResultSchema.parse(data).status;
}

export type ScoringDrainResult = {
  claimed: number;
  completed: number;
  failed: number;
  retried: number;
  unresolved: number;
};

export async function drainScoringJobs(input: {
  leaseSeconds?: number;
  limit?: number;
  workerId?: string;
} = {}): Promise<ScoringDrainResult> {
  const workerId = input.workerId ?? randomUUID();
  const limit = Math.min(10, Math.max(1, input.limit ?? 1));
  const leaseSeconds = Math.min(900, Math.max(30, input.leaseSeconds ?? 300));
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_scoring_jobs", {
    p_lease_seconds: leaseSeconds,
    p_limit: limit,
    p_worker_id: workerId,
  });
  if (error) throw new Error("Unable to claim assessment scoring jobs.");
  const jobs = z.array(claimedJobSchema).parse(data);
  const result: ScoringDrainResult = {
    claimed: jobs.length, completed: 0, failed: 0, retried: 0, unresolved: 0,
  };

  for (const job of jobs) {
    let succeeded = false;
    let errorCode = "scoring_failed";
    try {
      const finalization = job.scope === "candidate"
        ? await finalizeCompletedCandidateAssessment({
            applicationId: job.parentId,
            invitationId: job.invitationId,
            job: { expectedRevision: job.expectedRevision, jobId: job.jobId, workerId },
            readiness: "completion_v2",
          })
        : await finalizeCompletedEmployeeAssessment({
            invitationId: job.invitationId,
            job: { expectedRevision: job.expectedRevision, jobId: job.jobId, workerId },
            participantId: job.parentId,
            readiness: "completion_v2",
          });
      succeeded = finalization === "completed";
      errorCode = finalization === "processing" ? "parent_busy" : "target_not_ready";
    } catch {
      errorCode = "scoring_failed";
    }

    try {
      const { data: finishData, error: finishError } = await admin.rpc("finish_scoring_job", {
        p_error_code: succeeded ? null : errorCode,
        p_job_id: job.jobId,
        p_success: succeeded,
        p_worker_id: workerId,
      });
      if (finishError) throw new Error("Unable to finish assessment scoring job.");
      const finish = finishResultSchema.parse(finishData);
      result[finish.status === "completed" ? "completed" : finish.status === "retry" ? "retried" : "failed"] += 1;
    } catch {
      // The lease makes an unknown finish outcome recoverable without blocking
      // the other jobs claimed in this batch.
      result.unresolved += 1;
    }
  }

  return result;
}
