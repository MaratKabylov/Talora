import {
  MATCHING_SCORING_MODES,
  ORDERING_SCORING_MODES,
  isStructuredQuestion,
} from "@/lib/structured-questions";

import type { QuestionType } from "./builder-constants";
import type { QuestionSettings } from "./remediation";

type PublicationOption = {
  match_text: string | null;
  text: string;
};

type PublicationQuestion = {
  answer_options?: PublicationOption[] | null;
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

export function validateStructuredQuestionsForPublication(sections: PublicationSection[]) {
  for (const question of sections.flatMap((section) => section.questions ?? [])) {
    if (question.question_type !== "ordering" && question.question_type !== "matching") {
      continue;
    }

    const settings = question.settings_json ?? {};
    if (!isStructuredQuestion(settings)) {
      return "Обновите legacy-вопросы «Сортировка» и «Сопоставление» до интерактивного формата перед публикацией.";
    }
    const options = question.answer_options ?? [];
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
