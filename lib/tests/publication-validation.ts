import {
  MATCHING_SCORING_MODES,
  ORDERING_SCORING_MODES,
  isStructuredQuestion,
} from "@/lib/structured-questions";
import {
  isMultipleChoiceV1,
  validateMultipleChoiceDefinition,
} from "@/lib/answers/multiple-choice";
import { validateScoringDefinitionV2 } from "@/lib/scoring/definition";
import type { ScoringDefinitionV2 } from "@/lib/scoring/types";
import { DERIVED_CRITERION_SCORE_IDS } from "@/lib/scoring/types";

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
  id: string;
  points: number;
  question_type: QuestionType;
  scoring_config_json?: unknown;
  scoring_model?: "criterion" | "scale" | "sjt" | "forced_choice" | null;
  settings_json: QuestionSettings | null;
};

export type PublicationSection = {
  questions?: PublicationQuestion[] | null;
};

export type PublicationScoringVersion = {
  assessment_domain?: string | null;
  result_shape?: string | null;
  scoring_config_json?: unknown;
  scoring_schema_version?: string | null;
};

function normalized(values: string[]) {
  return values.map((value) => value.trim().toLocaleLowerCase("ru"));
}

export function validateQuestionsForPublication(
  sections: PublicationSection[],
  version?: PublicationScoringVersion,
) {
  for (const question of sections.flatMap((section) => section.questions ?? [])) {
    const options = question.answer_options ?? [];
    if (question.question_type === "single_choice") {
      if (
        question.scoring_model !== "sjt" &&
        options.filter((option) => option.is_correct === true).length !== 1
      ) {
        return "Для вопроса с одним вариантом ответа отметьте ровно один правильный вариант.";
      }
      continue;
    }

    if (question.question_type === "multiple_choice") {
      if (question.scoring_model === "sjt") {
        continue;
      }
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

  if (version?.scoring_schema_version === "2.0") {
    const config = isRecord(version.scoring_config_json)
      ? version.scoring_config_json
      : {};
    const definition = {
      ...config,
      assessmentDomain: version.assessment_domain,
      resultShape: version.result_shape,
      schemaVersion: version.scoring_schema_version,
    } as ScoringDefinitionV2;
    const items = sections.flatMap((section) => section.questions ?? []).map((question) => ({
      config: question.scoring_model ? question.scoring_config_json : null,
      id: question.id,
      questionType: question.question_type,
      scoringModel: question.scoring_model ?? null,
    }));
    const validation = validateScoringDefinitionV2({
      criterionScoreIds: DERIVED_CRITERION_SCORE_IDS,
      definition,
      forPublication: true,
      items,
    });
    if (!validation.ok) {
      const first = validation.issues[0];
      return `${first.path || "scoring"}: ${first.message}`;
    }
    for (const item of validation.items) {
      if (item.scoringModel !== "sjt") continue;
      const question = sections
        .flatMap((section) => section.questions ?? [])
        .find((candidate) => candidate.id === item.id);
      const storedOptionIds = new Set(
        (question?.answer_options ?? []).map((option) => option.id),
      );
      const configuredOptionIds = item.config.options.map((option) => option.optionId);
      if (
        configuredOptionIds.length !== storedOptionIds.size ||
        configuredOptionIds.some((optionId) => !storedOptionIds.has(optionId))
      ) {
        return `SJT item '${item.id}' must map every stored answer option exactly once.`;
      }
    }
    if (definition.assessmentDomain === "learning") {
      const questions = sections.flatMap((section) => section.questions ?? []);
      const remediationParents = questions.filter(
        (question) =>
          question.question_type === "single_choice" &&
          typeof question.settings_json?.remediationQuestionId === "string",
      );
      if (remediationParents.length === 0) {
        return "Learning assessment requires at least one remediation question pair.";
      }
      if (
        definition.overallScore?.sourceType !== "criterion" ||
        definition.overallScore.sourceId !== "learning_final"
      ) {
        return "Learning assessment overallScore must reference criterion 'learning_final'.";
      }
      if (
        validation.items.some(
          (item) => item.scoringModel === "criterion" && (item.config.minPoints ?? 0) !== 0,
        )
      ) {
        return "Learning criterion items must use minPoints equal to 0.";
      }
    }
    if (definition.assessmentDomain === "attention") {
      const questions = sections.flatMap((section) => section.questions ?? []);
      if (
        questions.some(
          (question) =>
            typeof question.settings_json?.remediationQuestionId === "string",
        )
      ) {
        return "Attention assessment cannot contain remediation branches.";
      }
      if (
        validation.items.some(
          (item) => item.scoringModel === "criterion" && (item.config.minPoints ?? 0) !== 0,
        )
      ) {
        return "Attention criterion items must use minPoints equal to 0.";
      }
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @deprecated Use the shared publication orchestrator. */
export const validateStructuredQuestionsForPublication = validateQuestionsForPublication;
