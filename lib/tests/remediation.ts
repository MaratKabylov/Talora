import type { QuestionType } from "./builder-constants";
import type { StructuredQuestionSettings } from "../structured-questions";
import type { MultipleChoiceQuestionSettings } from "../answers/multiple-choice";

export type QuestionSettings = StructuredQuestionSettings & MultipleChoiceQuestionSettings & {
  mode?: "most_least";
  correctFeedback?: string;
  incorrectFeedback?: string;
  max?: number;
  min?: number;
  remediationQuestionId?: string;
  required?: boolean;
  shuffleOptions?: boolean;
};

export type RemediationQuestionInput = {
  id: string;
  incorrectFeedback: string | null;
  options: Array<{ isCorrect: boolean | null }>;
  questionType: QuestionType;
  remediationQuestionId: string | null;
};

export function validateRemediationLinks(
  sections: Array<{ questions: RemediationQuestionInput[] }>,
) {
  const linkedTargetIds = new Set<string>();

  for (const section of sections) {
    const questionIndexById = new Map(
      section.questions.map((question, index) => [question.id, index]),
    );

    for (const [questionIndex, question] of section.questions.entries()) {
      const targetId = question.remediationQuestionId;
      if (!targetId) {
        if (question.incorrectFeedback?.trim()) {
          return "Для объяснения после ошибки выберите повторный вопрос.";
        }
        continue;
      }

      if (
        question.questionType !== "single_choice" &&
        question.questionType !== "multiple_choice"
      ) {
        return "Ветка «Если допущена ошибка» доступна только для вопросов с вариантами ответа.";
      }

      if (!question.incorrectFeedback?.trim()) {
        return "Добавьте объяснение, которое кандидат увидит после ошибочного ответа.";
      }

      if (
        question.questionType === "single_choice" &&
        !question.options.some((option) => option.isCorrect)
      ) {
        return "Для исходного вопроса отметьте правильный вариант ответа.";
      }

      if (
        question.questionType === "single_choice" &&
        !question.options.some((option) => option.isCorrect === false)
      ) {
        return "Для ветки после ошибки нужен хотя бы один неверный вариант ответа.";
      }

      const targetIndex = questionIndexById.get(targetId);
      if (targetIndex === undefined || targetIndex <= questionIndex) {
        return "Повторный вопрос должен находиться ниже исходного вопроса в той же секции.";
      }

      if (linkedTargetIds.has(targetId)) {
        return "Один повторный вопрос нельзя привязать к нескольким исходным вопросам.";
      }
      linkedTargetIds.add(targetId);
    }
  }

  const linkedParents = new Set(
    sections.flatMap((section) =>
      section.questions
        .filter((question) => question.remediationQuestionId)
        .map((question) => question.id),
    ),
  );

  for (const targetId of linkedTargetIds) {
    if (linkedParents.has(targetId)) {
      return "Повторный вопрос не может одновременно открывать еще одну ветку после ошибки.";
    }
  }

  return null;
}
