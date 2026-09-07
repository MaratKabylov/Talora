import type { AssessmentSectionSnapshot } from "./section-contract";
import { reconcilePrefetchedSection, type PrefetchedSection, type SectionNavigationState } from "./section-prefetch-contract.ts";
import type { SectionSaveRequest, SectionSaveResponse } from "./section-save-contract";

export async function saveAssessmentSection(input: SectionSaveRequest): Promise<SectionSaveResponse> {
  const response = await fetch("/api/assessment/section-save", {
    method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(response.status === 400
    ? "Проверьте обязательные ответы и выбранные варианты текущей секции."
    : "Не удалось сохранить секцию. Ответы остались на экране — повторите попытку.");
  return response.json();
}

export function sectionUrl(path: string, sectionIndex: number, reviewMode: boolean) {
  return `${path}?section=${sectionIndex}${reviewMode ? "&review=1" : ""}`;
}

export function firstQuestionIndex(snapshot: Pick<AssessmentSectionSnapshot, "section" | "answers" | "reviewMode">) {
  const questions = (snapshot.section?.questions ?? []).filter(question =>
    !question.remediationParentId || snapshot.answers[question.remediationParentId]?.remediationRequired);
  const incomplete = questions.findIndex(question => !snapshot.answers[question.id]);
  return incomplete >= 0 ? incomplete : snapshot.reviewMode && questions.length > 0 ? questions.length - 1 : -1;
}

export async function fetchAssessmentSection(input: {
  assessmentType: "candidate" | "employee"; token: string; sessionId: string; sectionIndex: number; review: boolean;
}, signal: AbortSignal, cached?: PrefetchedSection): Promise<AssessmentSectionSnapshot> {
  const response = await fetch("/api/assessment/section", {
    method: "POST", cache: "no-store", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input,
      ...(cached ? { cached: { sectionId: cached.section.id, versionId: cached.versionId } } : {}),
    }),
  });
  if (!response.ok) throw new Error(response.status === 410
    ? "Тест больше недоступен. Проверьте состояние сессии."
    : "Не удалось загрузить секцию. Текущий ответ остался на экране — повторите переход.");
  const result = await response.json() as AssessmentSectionSnapshot | SectionNavigationState;
  if ("kind" in result && result.kind === "state") {
    if (!cached) throw new Error("Не удалось подтвердить секцию. Повторите переход.");
    return reconcilePrefetchedSection(cached, result);
  }
  return result as AssessmentSectionSnapshot;
}
