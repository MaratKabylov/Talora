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

const identityShape = {
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
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }

  try {
    const input = parsed.data;
    const result =
      input.operation === "claim"
        ? await claimCandidateSession(input)
        : input.operation === "heartbeat"
          ? await heartbeatCandidateSession(input)
          : input.operation === "event"
            ? await recordCandidateSessionEvent(input)
            : input.operation === "autosave"
              ? await autosaveCandidateAnswer(input)
              : input.operation === "complete"
                ? await completeOneQuestionCandidateSession(input)
              : await expireCandidateSessionIfNeeded(input);

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Не удалось обновить состояние теста." },
      { status: 500 },
    );
  }
}
