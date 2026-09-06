import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { ForcedChoiceAnswerValidationError } from "@/lib/forced-choice";
import { MultipleChoiceAnswerValidationError } from "@/lib/answers/multiple-choice";

import type { ClientIdentity } from "./session-control";

const rpcResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("active"), deadlineAt: z.string().nullable(),
    answerIsCorrect: z.boolean().nullable().optional(),
    incorrectFeedback: z.string().nullable().optional(), savedAt: z.string().optional(),
  }),
  z.object({ status: z.literal("blocked"), retryAfterSeconds: z.number().int().positive() }),
  z.object({ status: z.literal("unavailable") }),
  z.object({ status: z.literal("terminal") }),
  z.object({ status: z.literal("expired") }),
]);

export function isSessionControlV2Enabled() {
  return process.env.SESSION_CONTROL_V2 === "true";
}

// Only these machine codes may become user-visible validation errors. Never echo
// arbitrary PostgreSQL messages/details (they can contain tokens or answer text).
function throwAnswerValidationError(error: { code?: string; message?: string; details?: string }) {
  if (error.code === "TVF01") {
    const messages: Record<string, string> = {
      mode: "Режим Forced Choice не поддерживается.",
      required: "Необходимо выбрать вариант «Больше всего» и «Меньше всего».",
      same: "Один вариант нельзя одновременно выбрать как MOST и LEAST.",
      foreign: "Выбранный вариант не относится к текущему вопросу.",
    };
    const message = messages[error.message ?? ""];
    if (message) throw new ForcedChoiceAnswerValidationError(message);
  }
  if (error.code === "TVM01") {
    if (error.message === "foreign") {
      throw new MultipleChoiceAnswerValidationError("Выбранный вариант не относится к текущему вопросу.");
    }
    if (error.message === "ids") {
      throw new MultipleChoiceAnswerValidationError("Выбранные варианты должны быть массивом корректных идентификаторов.");
    }
    if (error.message === "limits") {
      let details: unknown;
      try { details = JSON.parse(error.details ?? "null"); } catch { /* Fail closed below. */ }
      const limits = z.object({ min: z.number().int().min(0).max(100), max: z.number().int().min(0).max(100) }).safeParse(details);
      if (limits.success) {
        throw new MultipleChoiceAnswerValidationError(`Выберите от ${limits.data.min} до ${limits.data.max} вариантов.`);
      }
    }
  }
  throw new Error("Unable to control the assessment session.");
}

export async function controlSessionLeaseV2(
  identity: ClientIdentity,
  operation: "claim" | "heartbeat" | "event" | "autosave" | "expire",
  payload: Record<string, unknown> = {},
) {
  const identityArgs = {
    p_scope: identity.assessmentType ?? "candidate",
    p_token: identity.token,
    p_session_id: identity.sessionId,
    p_client_id: identity.clientId,
    p_device_id: identity.deviceId,
  };
  const { data, error } = operation === "autosave"
    ? await createAdminClient().rpc("save_assessment_answer_v2", {
        ...identityArgs, p_question_id: payload.questionId, p_draft: payload.answer,
        p_finalize: payload.finalize ?? false, p_time_spent_seconds: payload.timeSpentSeconds ?? null,
      })
    : await createAdminClient().rpc("control_assessment_session_lease_v2", {
        ...identityArgs, p_operation: operation === "expire" ? "heartbeat" : operation,
        p_payload: operation === "expire" ? {} : payload,
      });

  // Never retry through V1 after a transport error: the RPC might have committed.
  // Do not expose DB error details, which may contain token/request values.
  if (error) throwAnswerValidationError(error);
  const parsed = rpcResponseSchema.safeParse(data);
  if (!parsed.success) throw new Error("Unexpected assessment session control response.");

  // Normalize the DB timestamp for the existing public string contract.
  if (parsed.data.status === "active") {
    for (const key of ["deadlineAt", "savedAt"] as const) {
      if (parsed.data[key] == null) continue;
      const timestamp = new Date(parsed.data[key]);
      if (!Number.isFinite(timestamp.getTime())) throw new Error("Unexpected assessment session timestamp.");
      parsed.data[key] = timestamp.toISOString();
    }
  }
  return parsed.data;
}
