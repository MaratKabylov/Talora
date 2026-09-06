import type { FlowQuestion, FlowSection } from "./data";

export type PublicFlowQuestion = Omit<FlowQuestion, "matchingScoringMode" | "orderingScoringMode">;
export type PublicFlowSection = Omit<FlowSection, "questions"> & { questions: PublicFlowQuestion[] };
export type SectionSavedAnswer = {
  answerJson: Record<string, unknown>;
  answerText: string | null;
  selectedOptionId: string | null;
  timeSpentSeconds: number | null;
  remediationRequired: boolean;
};
export type SectionSummary = {
  id: string;
  title: string;
  orderIndex: number;
  questionCount: number;
  visibleQuestionCount: number;
  incompleteQuestionCount: number;
};
export type AssessmentSectionSnapshot = {
  answers: Record<string, SectionSavedAnswer>;
  section: PublicFlowSection | null;
  sections: SectionSummary[];
  sectionIndex: number;
  reviewMode: boolean;
  questionOffset: number;
  otherVisibleQuestionCount: number;
};

export function requestedSectionIndex(value: string | undefined) {
  const index = Number(value ?? "0");
  return Number.isInteger(index) ? Math.min(Math.max(index, 0), 2_147_483_647) : 0;
}

// Only raw response fields used by the form are eligible for serialization.
// Historical/scoring metadata embedded in answer_json must never leave the server.
export function publicAnswerJson(question: Pick<PublicFlowQuestion, "questionType" | "isStructured">, input: Record<string, unknown>) {
  if (input.skipped === true) return { skipped: true };
  if (question.questionType === "scale") return typeof input.value === "number" ? { value: input.value } : {};
  if (question.questionType === "forced_choice") return {
    ...(typeof input.mostOptionId === "string" ? { mostOptionId: input.mostOptionId } : {}),
    ...(typeof input.leastOptionId === "string" ? { leastOptionId: input.leastOptionId } : {}),
  };
  if (question.questionType === "multiple_choice") return {
    selectedOptionIds: Array.isArray(input.selectedOptionIds) ? input.selectedOptionIds.filter((id): id is string => typeof id === "string") : [],
  };
  if (question.questionType === "ordering" && question.isStructured) return {
    orderedOptionIds: Array.isArray(input.orderedOptionIds) ? input.orderedOptionIds.filter((id): id is string => typeof id === "string") : [],
  };
  if (question.questionType === "matching" && question.isStructured) return {
    matches: Array.isArray(input.matches) ? input.matches.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const pair = value as Record<string, unknown>;
      return typeof pair.optionId === "string" && typeof pair.targetId === "string" ? [{ optionId: pair.optionId, targetId: pair.targetId }] : [];
    }) : [],
  };
  return {};
}
