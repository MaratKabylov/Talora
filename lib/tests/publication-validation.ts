import {
  MATCHING_SCORING_MODES,
  ORDERING_SCORING_MODES,
  isStructuredQuestion,
} from "@/lib/structured-questions";
import {
  isMultipleChoiceV1,
  validateMultipleChoiceDefinition,
} from "@/lib/answers/multiple-choice";

import type { QuestionType } from "./builder-constants";
import type { QuestionSettings } from "./remediation";

type PublicationOption = {
  competency_effect_json: Record<string, number> | null;
  id: string;
  is_correct: boolean | null;
  match_text: string | null;
  points: number;
  text: string;
};

type PublicationQuestion = {
  answer_options?: PublicationOption[] | null;
  competency_key: string | null;
  points: number;
  question_type: QuestionType;
  settings_json: QuestionSettings | null;
};

export type PublicationSection = {
  questions?: PublicationQuestion[] | null;
};

function normalized(values: string[]) {
  return values.map((value) => value.trim().toLocaleLowerCase("ru"));
}

export function validateQuestionsForPublication(sections: PublicationSection[]) {
  for (const question of sections.flatMap((section) => section.questions ?? [])) {
    const options = question.answer_options ?? [];
    if (question.question_type === "single_choice") {
      if (options.filter((option) => option.is_correct === true).length !== 1) {
        return "Для вопроса с одним вариантом ответа отметьте ровно один правильный вариант.";
      }
      continue;
    }

    if (question.question_type === "multiple_choice") {
      const settings = question.settings_json ?? {};
      if (!isMultipleChoiceV1(settings)) {
        return "Настройте режим оценки для legacy-вопроса «Несколько вариантов» перед публикацией.";
      }
      const validation = validateMultipleChoiceDefinition({
        competencyKey: question.competency_key,
        maxPoints: Number(question.points),
        options: options.map((option) => ({
          competencyEffects: option.competency_effect_json,
          id: option.id,
          isCorrect: option.is_correct,
          points: Number(option.points),
        })),
        required: settings.required ?? true,
        settings,
      });
      if (!validation.ok) {
        return validation.errors[0] ?? "Проверьте настройки multiple_choice.";
      }
      continue;
    }

    if (question.question_type !== "ordering" && question.question_type !== "matching") {
      continue;
    }

    const settings = question.settings_json ?? {};
    if (!isStructuredQuestion(settings)) {
      return "Обновите legacy-вопросы «Сортировка» и «Сопоставление» до интерактивного формата перед публикацией.";
    }
    if (options.length < 2) {
      return "Для сортировки и сопоставления добавьте минимум два элемента.";
    }
    if (Number(question.points) <= 0) {
      return "Для сортировки и сопоставления укажите максимальный балл больше нуля.";
    }
    const texts = normalized(options.map((option) => option.text));
    if (texts.some((text) => !text) || new Set(texts).size !== texts.length) {
      return "Элементы сортировки и сопоставления должны быть заполнены и не повторяться.";
    }

    if (question.question_type === "ordering") {
      if (!ORDERING_SCORING_MODES.includes(settings.orderingScoringMode as never)) {
        return "Выберите поддерживаемый режим начисления баллов для сортировки.";
      }
      continue;
    }

    if (!MATCHING_SCORING_MODES.includes(settings.matchingScoringMode as never)) {
      return "Выберите поддерживаемый режим начисления баллов для сопоставления.";
    }
    const targets = normalized(options.map((option) => option.match_text ?? ""));
    if (targets.some((text) => !text) || new Set(targets).size !== targets.length) {
      return "Правые части сопоставления должны быть заполнены и не повторяться.";
    }
  }

  return null;
}

/** @deprecated Use the shared publication orchestrator. */
export const validateStructuredQuestionsForPublication = validateQuestionsForPublication;
