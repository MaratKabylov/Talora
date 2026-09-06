import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import type { ClientIdentity } from "./session-control";

const rpcResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("active"), deadlineAt: z.string().nullable() }),
  z.object({ status: z.literal("blocked"), retryAfterSeconds: z.number().int().positive() }),
  z.object({ status: z.literal("unavailable") }),
  z.object({ status: z.literal("terminal") }),
  z.object({ status: z.literal("expired") }),
]);

export function isSessionControlV2Enabled() {
  return process.env.SESSION_CONTROL_V2 === "true";
}

export async function controlSessionLeaseV2(
  identity: ClientIdentity,
  operation: "claim" | "heartbeat" | "event",
  payload: Record<string, unknown> = {},
) {
  const { data, error } = await createAdminClient().rpc("control_assessment_session_lease_v2", {
    p_scope: identity.assessmentType ?? "candidate",
    p_token: identity.token,
    p_session_id: identity.sessionId,
    p_client_id: identity.clientId,
    p_device_id: identity.deviceId,
    p_operation: operation,
    p_payload: payload,
  });

  // Never retry through V1 after a transport error: the RPC might have committed.
  // Do not expose DB error details, which may contain token/request values.
  if (error) throw new Error("Unable to control the assessment session.");
  const parsed = rpcResponseSchema.safeParse(data);
  if (!parsed.success) throw new Error("Unexpected assessment session control response.");

  // Normalize the DB timestamp for the existing public string contract.
  if (parsed.data.status === "active" && parsed.data.deadlineAt !== null) {
    const deadline = new Date(parsed.data.deadlineAt);
    if (!Number.isFinite(deadline.getTime())) {
      throw new Error("Unexpected assessment session deadline.");
    }
    return { ...parsed.data, deadlineAt: deadline.toISOString() };
  }
  return parsed.data;
}
