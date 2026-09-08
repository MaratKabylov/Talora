import { z } from "zod";

export const completionRequestSchema = z.object({
  assessmentType: z.enum(["candidate", "employee"]), token: z.string().regex(/^[a-f0-9]{64}$/i),
  sessionId: z.string().uuid(), clientId: z.string().uuid(), deviceId: z.string().uuid(),
});
export type CompletionRequest = z.infer<typeof completionRequestSchema>;
export const completionResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("redirect"), redirectTo: z.string() }),
  z.object({ status: z.literal("blocked"), retryAfterSeconds: z.number().int().positive() }),
  z.object({ status: z.literal("incomplete"), sectionIndex: z.number().int().nonnegative() }),
  z.object({ status: z.literal("processing") }), z.object({ status: z.literal("expired") }),
]);
export type CompletionResponse = z.infer<typeof completionResponseSchema>;

// Accept only local destinations belonging to this invitation, never arbitrary URLs.
export function safeAssessmentDestination(path: string, input: Pick<CompletionRequest, "assessmentType" | "token">) {
  const root = `/${input.assessmentType === "employee" ? "employee-assessment" : "assessment"}/${input.token}`;
  return path === root || path === `${root}/profile` || path === `${root}/complete`
    || (path.startsWith(`${root}/test/`) && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(path.slice(`${root}/test/`.length)));
}

export async function requestAssessmentCompletion(input: CompletionRequest): Promise<CompletionResponse> {
  const response = await fetch("/api/assessment/complete", { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!response.ok) throw Error("Не удалось завершить тест. Ответы уже сохранены — повторите завершение.");
  const result = completionResponseSchema.parse(await response.json());
  if (result.status === "redirect" && !safeAssessmentDestination(result.redirectTo, input)) {
    throw Error("Не удалось подтвердить переход. Повторите завершение.");
  }
  return result;
}
