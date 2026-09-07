import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { measureServerOperation } from "@/lib/observability/server-performance";
import { presentAssessmentSection } from "./section-data";
import { publicAnswerJson, type AssessmentSectionSnapshot } from "./section-contract";
import type { PrefetchedSection, SectionNavigationState } from "./section-prefetch-contract";

const stateSchema = z.object({
  kind: z.literal("state"), versionId: z.string().uuid(), sectionId: z.string().uuid(),
  sectionIndex: z.number().int().nonnegative(), reviewMode: z.boolean(),
  sections: z.array(z.object({ id: z.string().uuid(), title: z.string(), orderIndex: z.number().int(),
    questionCount: z.number().int().nonnegative(), visibleQuestionCount: z.number().int().nonnegative(),
    incompleteQuestionCount: z.number().int().nonnegative() })),
  answers: z.record(z.string().uuid(), z.object({
    questionType: z.enum(["single_choice", "multiple_choice", "forced_choice", "scale", "ordering", "matching", "open_text"]),
    isStructured: z.boolean(), answerJson: z.record(z.string(), z.unknown()).nullable(), answerText: z.string().nullable(),
    selectedOptionId: z.string().uuid().nullable(), timeSpentSeconds: z.number().nullable(), remediationRequired: z.boolean(),
    incorrectFeedback: z.string().nullable(),
  })),
});
export function presentSectionNavigationState(raw: unknown): SectionNavigationState {
  const parsed = stateSchema.parse(raw);
  if (parsed.sections[parsed.sectionIndex]?.id !== parsed.sectionId) throw Error("Inconsistent section state.");
  const answers: SectionNavigationState["answers"] = {};
  const feedbacks: Record<string, string> = {};
  for (const [id, answer] of Object.entries(parsed.answers)) {
    answers[id] = { answerJson: publicAnswerJson(answer, answer.answerJson ?? {}), answerText: answer.answerText,
      selectedOptionId: answer.selectedOptionId, timeSpentSeconds: answer.timeSpentSeconds, remediationRequired: answer.remediationRequired };
    if (answer.remediationRequired && answer.incorrectFeedback) feedbacks[id] = answer.incorrectFeedback;
  }
  return { kind: "state", versionId: parsed.versionId, sectionId: parsed.sectionId,
    sectionIndex: parsed.sectionIndex, reviewMode: parsed.reviewMode, sections: parsed.sections, answers, feedbacks };
}
export function presentPrefetchedSection(raw: unknown, sessionId: string): PrefetchedSection {
  const parsed = z.object({ kind: z.literal("content"), versionId: z.string().uuid(),
    sectionIndex: z.number().int().nonnegative(), section: z.unknown() }).parse(raw);
  const meta = z.object({ id: z.string().uuid(), title: z.string() }).parse(parsed.section);
  // Reuse the existing sanitizer, metadata allowlist and deterministic option/target
  // shuffle. Empty answers also remove any premature incorrect-answer feedback.
  const presented = presentAssessmentSection({ section: parsed.section, answers: {}, sectionIndex: 0, reviewMode: false,
    sections: [{ ...meta, orderIndex: 0, questionCount: 0, visibleQuestionCount: 0, incompleteQuestionCount: 0 }] }, sessionId);
  return { versionId: parsed.versionId, sectionIndex: parsed.sectionIndex, section: presented.section! };
}

type Request = { assessmentType: "candidate" | "employee"; token: string; sessionId: string; sectionIndex: number; review?: boolean };
async function read(request: Request, mode: "prefetch" | "navigate", cached?: { sectionId: string; versionId: string }) {
  return measureServerOperation(mode === "prefetch" ? "assessment.prefetch_section" : "assessment.load_section_state", async () => {
    const { data, error } = await createAdminClient().rpc("read_assessment_section_navigation_v3", {
      p_scope: request.assessmentType, p_token: request.token, p_session_id: request.sessionId,
      p_section_index: request.sectionIndex, p_review: request.review ?? false, p_mode: mode,
      p_cached_section_id: cached?.sectionId ?? null, p_cached_version_id: cached?.versionId ?? null,
    });
    if (error) throw Error("Unable to read assessment navigation data.");
    return data as unknown;
  });
}
export async function prefetchAssessmentSection(request: Request): Promise<PrefetchedSection | null> {
  const data = await read(request, "prefetch");
  return data === null ? null : presentPrefetchedSection(data, request.sessionId);
}
export async function readAssessmentSectionTransition(request: Request, cached: { sectionId: string; versionId: string }): Promise<AssessmentSectionSnapshot | SectionNavigationState | null> {
  const data = await read(request, "navigate", cached);
  if (data === null) return null;
  const wrapper = z.object({ kind: z.enum(["state", "full"]), snapshot: z.unknown().optional() }).parse(data);
  if (wrapper.kind === "full") return wrapper.snapshot === null ? null : presentAssessmentSection(wrapper.snapshot, request.sessionId);
  const state = presentSectionNavigationState(data);
  if (state.sectionId !== cached.sectionId || state.versionId !== cached.versionId) throw Error("Inconsistent cached section identity.");
  return state;
}
