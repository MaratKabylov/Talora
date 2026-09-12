import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sectionSaveSchema, sectionSaveResponseSchema } from "@/lib/assessment/section-save-contract";
import { isSameOriginRequest } from "@/lib/assessment/same-origin";
import { correlationIdFrom, serverTimingValue } from "@/lib/observability/performance-core";
import { measureServerOperation } from "@/lib/observability/server-performance";

function recordSafeFailure(error: unknown, correlationId: string) {
  if (process.env.PERFORMANCE_TELEMETRY_ENABLED !== "true") return;
  try {
    const candidate = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const code = /^[A-Z0-9]{5}$/.test(candidate) ? candidate : "unknown";
    const category = error && typeof error === "object" && "issues" in error ? "response_contract"
      : code === "unknown" ? "unexpected" : "database";
    const issues = error && typeof error === "object" && "issues" in error && Array.isArray(error.issues)
      ? error.issues.slice(0, 5).map((issue: unknown) => {
          const value = issue && typeof issue === "object" ? issue as { code?: unknown; path?: unknown } : {};
          const issueCode = /^[a-z_]{1,40}$/.test(String(value.code ?? "")) ? String(value.code) : "unknown";
          const issuePath = Array.isArray(value.path) ? value.path.map(part => String(part)).join(".") : "";
          return { code: issueCode, path: /^[A-Za-z0-9_.]{0,120}$/.test(issuePath) ? issuePath : "unknown" };
        })
      : undefined;
    console.info(JSON.stringify({ correlationId, event: "assessment.section_save_failure", operation: "assessment.save_section",
      category, code, ...(issues ? { issues } : {}), timestamp: new Date().toISOString(), version: 1 }));
  } catch {
    // Diagnostics must never affect the response path.
  }
}

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  const headers = { "Cache-Control": "private, no-store", "x-request-id": correlationIdFrom(request.headers.get("x-request-id")) };
  const respond = (body: unknown, status = 200) => NextResponse.json(body, {
    headers: { ...headers, "Server-Timing": serverTimingValue("assessment.save_section", performance.now() - startedAt) }, status,
  });
  if (!isSameOriginRequest(request)) return respond({ error: "Недопустимый источник запроса." }, 403);
  if (process.env.ASSESSMENT_SECTION_SAVE_V2 !== "true" || process.env.SESSION_CONTROL_V2 !== "true"
    || process.env.ASSESSMENT_SOFT_NAVIGATION_V2 !== "true" || process.env.ASSESSMENT_SECTION_READ_V2 !== "true") {
    return respond({ error: "Новый режим сохранения недоступен. Обновите страницу после подтверждения ответов." }, 409);
  }
  const parsed = sectionSaveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    recordSafeFailure(parsed.error, headers["x-request-id"]);
    return respond({ error: "Некорректный запрос сохранения." }, 400);
  }
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
    recordSafeFailure(error, headers["x-request-id"]);
    // Only known validation codes influence the public message; no SQL/details/PII.
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (["TVS01", "TVF01", "TVM01"].includes(String(code))) {
      return respond({ error: "Проверьте обязательные ответы и выбранные варианты текущей секции." }, 400);
    }
    return respond({ error: "Не удалось сохранить секцию. Ответы остались на экране — повторите попытку." }, 500);
  }
}
