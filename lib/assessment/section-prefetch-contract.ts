import type { AssessmentSectionSnapshot, PublicFlowSection, SectionSavedAnswer, SectionSummary } from "./section-contract";

export type PrefetchedSection = { versionId: string; sectionIndex: number; section: PublicFlowSection };
export type SectionNavigationState = {
  kind: "state"; versionId: string; sectionId: string; sectionIndex: number; reviewMode: boolean;
  sections: SectionSummary[]; answers: Record<string, SectionSavedAnswer>; feedbacks: Record<string, string>;
};

// Static content is never usable without fresh, authorized state from the server.
export function reconcilePrefetchedSection(content: PrefetchedSection, state: SectionNavigationState): AssessmentSectionSnapshot {
  if (content.versionId !== state.versionId || content.section.id !== state.sectionId
    || content.sectionIndex !== state.sectionIndex || state.sections[state.sectionIndex]?.id !== state.sectionId) {
    throw new Error("Не удалось подтвердить секцию. Повторите переход.");
  }
  const answers: Record<string, SectionSavedAnswer> = {};
  const questions = content.section.questions.map(question => {
    const answer = state.answers[question.id];
    if (answer) answers[question.id] = answer;
    const savedOrder = answer?.answerJson.orderedOptionIds;
    const optionsById = new Map(question.options.map(option => [option.id, option]));
    const restoreOrdering = question.questionType === "ordering" && question.isStructured
      && Array.isArray(savedOrder) && savedOrder.length === optionsById.size
      && new Set(savedOrder).size === optionsById.size
      && savedOrder.every(id => typeof id === "string" && optionsById.has(id));
    return { ...question,
      incorrectFeedback: answer?.remediationRequired ? state.feedbacks[question.id] ?? null : null,
      options: restoreOrdering ? (savedOrder as string[]).map(id => optionsById.get(id)!) : question.options,
    };
  });
  return { answers, sections: state.sections, sectionIndex: state.sectionIndex, reviewMode: state.reviewMode,
    section: { ...content.section, questions },
    questionOffset: state.sections.slice(0, state.sectionIndex).reduce((sum, section) => sum + section.visibleQuestionCount, 0),
    otherVisibleQuestionCount: state.sections.reduce((sum, section, index) => sum + (index === state.sectionIndex ? 0 : section.visibleQuestionCount), 0),
  };
}
