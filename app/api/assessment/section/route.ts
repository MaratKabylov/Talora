import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAssessmentSectionSnapshot } from "@/lib/assessment/section-data";
import { readAssessmentSectionTransition } from "@/lib/assessment/section-prefetch-data";
import { isSameOriginRequest } from "@/lib/assessment/same-origin";
import { DEFAULT_TEST_PRESENTATION_SETTINGS } from "@/lib/tests/presentation-settings";
import { correlationIdFrom, serverTimingValue } from "@/lib/observability/performance-core";

const requestSchema = z.object({
  assessmentType: z.enum(["candidate", "employee"]),
  token: z.string().regex(/^[a-f0-9]{64}$/i), sessionId: z.string().uuid(),
  sectionIndex: z.number().int().min(0).max(2_147_483_647), review: z.boolean(),
  cached: z.object({ sectionId: z.string().uuid(), versionId: z.string().uuid() }).optional(),
});

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const headers = {
    "Cache-Control": "private, no-store", "x-request-id": correlationIdFrom(request.headers.get("x-request-id")),
  };
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Недопустимый источник запроса." }, { headers, status: 403 });
  }
  if (process.env.ASSESSMENT_SOFT_NAVIGATION_V2 !== "true" || process.env.ASSESSMENT_SECTION_READ_V2 !== "true") {
    return NextResponse.json({ error: "Новый режим навигации недоступен. Обновите страницу." }, { headers, status: 409 });
  }
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректный запрос." }, { headers, status: 400 });
  try {
    const { assessmentType, token, sessionId, sectionIndex, review } = parsed.data;
    const snapshot = parsed.data.cached && process.env.ASSESSMENT_SECTION_PREFETCH_V3 === "true"
      ? await readAssessmentSectionTransition(parsed.data, parsed.data.cached)
      : await getAssessmentSectionSnapshot({
      assessmentType, token, sessionId, requestedIndex: String(sectionIndex), review: review ? "1" : undefined,
      // V2 uses persisted settings in SQL; this value is only for the disabled legacy path.
      presentationSettings: DEFAULT_TEST_PRESENTATION_SETTINGS,
    }, async () => { throw new Error("Legacy section reads are disabled for navigation."); });
    const responseHeaders = { ...headers, "Server-Timing": serverTimingValue("assessment.load_section", performance.now() - startedAt) };
    return snapshot
      ? NextResponse.json(snapshot, { headers: responseHeaders })
      : NextResponse.json({ error: "Тест недоступен." }, { headers: responseHeaders, status: 410 });
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить секцию." }, { headers, status: 500 });
  }
}
