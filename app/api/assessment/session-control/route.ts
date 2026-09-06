import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  ASSESSMENT_INTEGRITY_EVENT_TYPES,
  autosaveCandidateAnswer,
  claimCandidateSession,
  completeOneQuestionCandidateSession,
  expireCandidateSessionIfNeeded,
  heartbeatCandidateSession,
  recordCandidateSessionEvent,
} from "@/lib/assessment/session-control";
import { ForcedChoiceAnswerValidationError } from "@/lib/forced-choice";
import { MultipleChoiceAnswerValidationError } from "@/lib/answers/multiple-choice";
import { correlationIdFrom, serverTimingValue } from "@/lib/observability/performance-core";
import {
  measureServerOperation,
  type ServerPerformanceOperation,
} from "@/lib/observability/server-performance";

const identityShape = {
  assessmentType: z.enum(["candidate", "employee"]).default("candidate"),
  clientId: z.string().uuid(),
  deviceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/i),
};

const requestSchema = z.discriminatedUnion("operation", [
  z.object({
    ...identityShape,
    clientEventId: z.string().uuid(),
    operation: z.literal("claim"),
  }),
  z.object({
    ...identityShape,
    operation: z.literal("heartbeat"),
  }),
  z.object({
    ...identityShape,
    clientEventId: z.string().uuid(),
    clientOccurredAt: z.string().datetime({ offset: true }).nullable().optional(),
    eventType: z.enum(ASSESSMENT_INTEGRITY_EVENT_TYPES),
    metadata: z.record(z.string(), z.unknown()).optional(),
    operation: z.literal("event"),
    questionId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    ...identityShape,
    answer: z.object({
      answerText: z.string().max(4000).nullable().optional(),
      leastOptionId: z.string().uuid().nullable().optional(),
      mostOptionId: z.string().uuid().nullable().optional(),
      matches: z
        .array(
          z.object({
            optionId: z.string().uuid(),
            targetId: z.string().uuid(),
          }),
        )
        .max(100)
        .optional(),
      orderedOptionIds: z.array(z.string().uuid()).max(100).optional(),
      scaleValue: z.number().int().nullable().optional(),
      selectedOptionId: z.string().uuid().nullable().optional(),
      selectedOptionIds: z.array(z.string().uuid()).max(100).optional(),
    }),
    finalize: z.boolean().optional(),
    operation: z.literal("autosave"),
    questionId: z.string().uuid(),
    timeSpentSeconds: z.number().int().min(0).max(604_800).optional(),
  }),
  z.object({
    ...identityShape,
    operation: z.literal("complete"),
  }),
  z.object({
    ...identityShape,
    clientEventId: z.string().uuid(),
    operation: z.literal("expire"),
  }),
]);

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) {
    return true;
  }

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const correlationId = correlationIdFrom(request.headers.get("x-request-id"));
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Недопустимый источник запроса." },
      { headers: { "x-request-id": correlationId }, status: 403 },
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Некорректный запрос." },
      { headers: { "x-request-id": correlationId }, status: 400 },
    );
  }

  const operation = `assessment.${parsed.data.operation}` as ServerPerformanceOperation;
  const startedAt = performance.now();
  const responseHeaders = () => ({
    "Cache-Control": "no-store",
    "Server-Timing": serverTimingValue(operation, performance.now() - startedAt),
    "x-request-id": correlationId,
  });

  try {
    const input = parsed.data;
    const result = await measureServerOperation(
      operation,
      () =>
        input.operation === "claim"
          ? claimCandidateSession(input)
          : input.operation === "heartbeat"
            ? heartbeatCandidateSession(input)
            : input.operation === "event"
              ? recordCandidateSessionEvent(input)
              : input.operation === "autosave"
                ? autosaveCandidateAnswer(input)
                : input.operation === "complete"
                  ? completeOneQuestionCandidateSession(input)
                  : expireCandidateSessionIfNeeded(input),
      { correlationId },
    );

    return NextResponse.json(result, {
      headers: responseHeaders(),
    });
  } catch (error) {
    if (
      error instanceof ForcedChoiceAnswerValidationError ||
      error instanceof MultipleChoiceAnswerValidationError
    ) {
      return NextResponse.json(
        { error: error.message },
        { headers: responseHeaders(), status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Не удалось обновить состояние теста." },
      { headers: responseHeaders(), status: 500 },
    );
  }
}
