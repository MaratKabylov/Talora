import type { CompetencyKey } from "@/lib/jobs/constants";
import type { AssessmentDomain } from "@/lib/scoring/types";

import type { AssessmentReportGroup } from "./types";

type LegacyAssessmentDimension = {
  domain: AssessmentDomain;
  group: AssessmentReportGroup;
  interpretationDirection: "higher_better" | "lower_better" | "neutral";
  title: string;
};

export const LEGACY_ASSESSMENT_DIMENSIONS = {
  learning_ability: {
    domain: "learning",
    group: "cognitive",
    interpretationDirection: "higher_better",
    title: "Обучаемость",
  },
  attention_to_detail: {
    domain: "attention",
    group: "cognitive",
    interpretationDirection: "higher_better",
    title: "Внимательность",
  },
  logical_reasoning: {
    domain: "other",
    group: "cognitive",
    interpretationDirection: "higher_better",
    title: "Логическое мышление",
  },
  work_behavior: {
    domain: "behavior",
    group: "behavior",
    interpretationDirection: "neutral",
    title: "Рабочее поведение",
  },
  communication: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    title: "Коммуникация",
  },
  responsibility: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    title: "Ответственность",
  },
  work_organization: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    title: "Организованность",
  },
  work_initiative: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    title: "Инициативность",
  },
  work_result_orientation: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    title: "Ориентация на результат",
  },
  work_collaboration: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    title: "Сотрудничество",
  },
  work_adaptability: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    title: "Самоконтроль и адаптивность",
  },
  motivation_result: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    title: "Результат",
  },
  motivation_growth: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    title: "Развитие",
  },
  motivation_autonomy: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    title: "Автономия",
  },
  motivation_influence: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    title: "Влияние",
  },
  motivation_team: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    title: "Команда",
  },
  motivation_stability: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    title: "Стабильность",
  },
  motivation_income: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    title: "Вознаграждение",
  },
  motivation_recognition: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    title: "Признание",
  },
  motivation_meaning: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    title: "Смысл",
  },
  motivation_structure: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    title: "Структура",
  },
} as const satisfies Record<CompetencyKey, LegacyAssessmentDimension>;

export function getLegacyAssessmentDimension(key: string) {
  return LEGACY_ASSESSMENT_DIMENSIONS[key as CompetencyKey] as
    | LegacyAssessmentDimension
    | undefined;
}

export function isLegacyMotivationDimension(key: string) {
  return getLegacyAssessmentDimension(key)?.group === "motivation";
}
