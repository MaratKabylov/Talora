import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prefetchAssessmentSection } from "@/lib/assessment/section-prefetch-data";
import { isSameOriginRequest } from "@/lib/assessment/same-origin";
import { correlationIdFrom, serverTimingValue } from "@/lib/observability/performance-core";

const requestSchema = z.object({ assessmentType: z.enum(["candidate", "employee"]),
  token: z.string().regex(/^[a-f0-9]{64}$/i), sessionId: z.string().uuid(),
  sectionIndex: z.number().int().min(0).max(2_147_483_647) });
export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const headers = { "Cache-Control": "private, no-store", "x-request-id": correlationIdFrom(request.headers.get("x-request-id")) };
  const respond = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: {
    ...headers, "Server-Timing": serverTimingValue("assessment.prefetch_section", performance.now() - startedAt),
  } });
  if (!isSameOriginRequest(request)) return respond({ error: "Недопустимый источник запроса." }, 403);
  if (process.env.ASSESSMENT_SECTION_PREFETCH_V3 !== "true" || process.env.ASSESSMENT_SECTION_READ_V2 !== "true"
    || process.env.ASSESSMENT_SOFT_NAVIGATION_V2 !== "true") return respond({ error: "Предзагрузка недоступна." }, 409);
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return respond({ error: "Некорректный запрос." }, 400);
  try { return respond(await prefetchAssessmentSection(parsed.data)); }
  catch { return respond({ error: "Не удалось предзагрузить секцию." }, 500); }
}
