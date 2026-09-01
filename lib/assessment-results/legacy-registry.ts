import type { CompetencyKey } from "@/lib/jobs/constants";
import type { AssessmentDomain } from "@/lib/scoring/types";

import type { AssessmentReportGroup } from "./types";

type LegacyAssessmentDimension = {
  domain: AssessmentDomain;
  group: AssessmentReportGroup;
  interpretationDirection: "higher_better" | "lower_better" | "neutral";
  order: number;
  title: string;
};

export const LEGACY_ASSESSMENT_DIMENSIONS = {
  learning_ability: {
    domain: "learning",
    group: "cognitive",
    interpretationDirection: "higher_better",
    order: 10,
    title: "Обучаемость",
  },
  attention_to_detail: {
    domain: "attention",
    group: "cognitive",
    interpretationDirection: "higher_better",
    order: 20,
    title: "Внимательность",
  },
  logical_reasoning: {
    domain: "other",
    group: "cognitive",
    interpretationDirection: "higher_better",
    order: 30,
    title: "Логическое мышление",
  },
  work_behavior: {
    domain: "behavior",
    group: "behavior",
    interpretationDirection: "neutral",
    order: 40,
    title: "Рабочее поведение",
  },
  communication: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    order: 50,
    title: "Коммуникация",
  },
  responsibility: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    order: 60,
    title: "Ответственность",
  },
  work_organization: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    order: 70,
    title: "Организованность",
  },
  work_initiative: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    order: 80,
    title: "Инициативность",
  },
  work_result_orientation: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    order: 90,
    title: "Ориентация на результат",
  },
  work_collaboration: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    order: 100,
    title: "Сотрудничество",
  },
  work_adaptability: {
    domain: "behavior",
    group: "work_competencies",
    interpretationDirection: "higher_better",
    order: 110,
    title: "Самоконтроль и адаптивность",
  },
  motivation_result: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    order: 120,
    title: "Результат",
  },
  motivation_growth: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    order: 130,
    title: "Развитие",
  },
  motivation_autonomy: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    order: 140,
    title: "Автономия",
  },
  motivation_influence: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    order: 150,
    title: "Влияние",
  },
  motivation_team: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    order: 160,
    title: "Команда",
  },
  motivation_stability: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    order: 170,
    title: "Стабильность",
  },
  motivation_income: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    order: 180,
    title: "Вознаграждение",
  },
  motivation_recognition: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    order: 190,
    title: "Признание",
  },
  motivation_meaning: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    order: 200,
    title: "Смысл",
  },
  motivation_structure: {
    domain: "motivation",
    group: "motivation",
    interpretationDirection: "neutral",
    order: 210,
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
