import type { CompanyRole } from "@/lib/auth/context";
import { isLegacyMotivationDimension } from "../assessment-results/legacy-registry.ts";

export const JOB_STATUS_VALUES = ["draft", "active", "paused", "closed", "archived"] as const;

export const JOB_STATUS_LABELS: Record<(typeof JOB_STATUS_VALUES)[number], string> = {
  draft: "Черновик",
  active: "Активна",
  paused: "Приостановлена",
  closed: "Закрыта",
  archived: "В архиве",
};

export const EMPLOYMENT_TYPE_VALUES = [
  "full_time",
  "part_time",
  "contract",
  "temporary",
  "internship",
] as const;

export const EMPLOYMENT_TYPE_LABELS: Record<(typeof EMPLOYMENT_TYPE_VALUES)[number], string> = {
  full_time: "Полная занятость",
  part_time: "Частичная занятость",
  contract: "Контракт",
  temporary: "Временная работа",
  internship: "Стажировка",
};

export const COMPETENCIES = [
  { key: "learning_ability", label: "Обучаемость", defaultWeight: 20 },
  { key: "attention_to_detail", label: "Внимательность", defaultWeight: 20 },
  { key: "logical_reasoning", label: "Логика", defaultWeight: 20 },
  { key: "work_behavior", label: "Рабочее поведение", defaultWeight: 15 },
  { key: "communication", label: "Коммуникация", defaultWeight: 10 },
  { key: "responsibility", label: "Ответственность", defaultWeight: 15 },
  { key: "work_organization", label: "Организованность", defaultWeight: 0 },
  { key: "work_initiative", label: "Инициативность", defaultWeight: 0 },
  { key: "work_result_orientation", label: "Ориентация на результат", defaultWeight: 0 },
  { key: "work_collaboration", label: "Сотрудничество", defaultWeight: 0 },
  { key: "work_adaptability", label: "Самоконтроль и адаптивность", defaultWeight: 0 },
  { key: "motivation_result", label: "Мотивация: результат", defaultWeight: 0 },
  { key: "motivation_growth", label: "Мотивация: развитие", defaultWeight: 0 },
  { key: "motivation_autonomy", label: "Мотивация: автономия", defaultWeight: 0 },
  { key: "motivation_influence", label: "Мотивация: влияние", defaultWeight: 0 },
  { key: "motivation_team", label: "Мотивация: команда", defaultWeight: 0 },
  { key: "motivation_stability", label: "Мотивация: стабильность", defaultWeight: 0 },
  { key: "motivation_income", label: "Мотивация: вознаграждение", defaultWeight: 0 },
  { key: "motivation_recognition", label: "Мотивация: признание", defaultWeight: 0 },
  { key: "motivation_meaning", label: "Мотивация: смысл", defaultWeight: 0 },
  { key: "motivation_structure", label: "Мотивация: структура", defaultWeight: 0 },
] as const;

export type JobStatus = (typeof JOB_STATUS_VALUES)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPE_VALUES)[number];
export type CompetencyKey = (typeof COMPETENCIES)[number]["key"];

export const MOTIVATION_COMPETENCIES = COMPETENCIES.filter((competency) =>
  isLegacyMotivationDimension(competency.key),
);

export const MOTIVATION_9_COMPETENCIES = MOTIVATION_COMPETENCIES.filter(
  (competency) => competency.key !== "motivation_structure",
);

const MOTIVATION_9_KEYS = new Set<CompetencyKey>(
  MOTIVATION_9_COMPETENCIES.map((competency) => competency.key),
);

export function isMotivationCompetencyKey(key: string) {
  return isLegacyMotivationDimension(key);
}

export function isMotivation9CompetencyKey(key: CompetencyKey) {
  return MOTIVATION_9_KEYS.has(key);
}

export function canManageJobs(role: CompanyRole) {
  return role === "owner" || role === "admin" || role === "recruiter" || role === "super_admin";
}
