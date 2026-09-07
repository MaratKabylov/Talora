import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sectionSaveSchema, sectionSaveResponseSchema } from "@/lib/assessment/section-save-contract";
import { correlationIdFrom, serverTimingValue } from "@/lib/observability/performance-core";
import { measureServerOperation } from "@/lib/observability/server-performance";

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const headers = { "Cache-Control": "private, no-store", "x-request-id": correlationIdFrom(request.headers.get("x-request-id")) };
  const respond = (body: unknown, status = 200) => NextResponse.json(body, {
    headers: { ...headers, "Server-Timing": serverTimingValue("assessment.save_section", performance.now() - startedAt) }, status,
  });
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return respond({ error: "Недопустимый источник запроса." }, 403);
  if (process.env.ASSESSMENT_SECTION_SAVE_V2 !== "true" || process.env.SESSION_CONTROL_V2 !== "true"
    || process.env.ASSESSMENT_SOFT_NAVIGATION_V2 !== "true" || process.env.ASSESSMENT_SECTION_READ_V2 !== "true") {
    return respond({ error: "Новый режим сохранения недоступен. Обновите страницу после подтверждения ответов." }, 409);
  }
  const parsed = sectionSaveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return respond({ error: "Некорректный запрос сохранения." }, 400);
  try {
    const input = parsed.data;
    const data = await measureServerOperation("assessment.save_section", async () => {
      const result = await createAdminClient().rpc("save_assessment_section_v2", {
        p_scope: input.assessmentType, p_token: input.token, p_session_id: input.sessionId,
        p_client_id: input.clientId, p_device_id: input.deviceId, p_section_id: input.sectionId,
        p_answers: input.answers, p_direction: input.direction,
      });
      if (result.error) throw result.error;
      return sectionSaveResponseSchema.parse(result.data);
    });
    return respond(data);
  } catch (error) {
    // Only known validation codes influence the public message; no SQL/details/PII.
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (["TVS01", "TVF01", "TVM01"].includes(String(code))) {
      return respond({ error: "Проверьте обязательные ответы и выбранные варианты текущей секции." }, 400);
    }
    return respond({ error: "Не удалось сохранить секцию. Ответы остались на экране — повторите попытку." }, 500);
  }
}
