import { after, NextRequest, NextResponse } from "next/server";
import { completeAssessmentSessionV2 } from "@/lib/assessment/completion-v2";
import { completionRequestSchema } from "@/lib/assessment/completion-contract";
import { isSameOriginRequest } from "@/lib/assessment/same-origin";
import { correlationIdFrom, serverTimingValue } from "@/lib/observability/performance-core";
import { drainScoringJobs } from "@/lib/scoring/jobs";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const headers = { "Cache-Control": "private, no-store", "x-request-id": correlationIdFrom(request.headers.get("x-request-id")) };
  const respond = (data: unknown, status = 200) => NextResponse.json(data, { status,
    headers: { ...headers, "Server-Timing": serverTimingValue("assessment.complete", performance.now() - startedAt) } });
  if (!isSameOriginRequest(request)) return respond({ error: "Недопустимый источник запроса." }, 403);
  if (process.env.ASSESSMENT_COMPLETION_V2 !== "true" || process.env.SESSION_CONTROL_V2 !== "true"
    || process.env.ASSESSMENT_SOFT_NAVIGATION_V2 !== "true" || process.env.ASSESSMENT_SECTION_READ_V2 !== "true") {
    return respond({ error: "Новый режим завершения отключен. Обновите страницу после сохранения ответов." }, 409);
  }
  const parsed = completionRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return respond({ error: "Некорректный запрос." }, 400);
  try {
    const result = await completeAssessmentSessionV2(parsed.data);
    if (process.env.ASSESSMENT_ASYNC_SCORING_V2 === "true" && result.status === "processing") {
      after(async () => { await drainScoringJobs({ limit: 1 }).catch(() => undefined); });
    }
    return respond(result);
  }
  catch { return respond({ error: "Не удалось завершить тест. Повторите завершение." }, 500); }
}
