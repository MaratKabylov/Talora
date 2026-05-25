import type { CompanyRole } from "@/lib/auth/context";

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
  { key: "motivation_income", label: "Мотивация: доход", defaultWeight: 0 },
  { key: "motivation_growth", label: "Мотивация: рост", defaultWeight: 0 },
  { key: "motivation_stability", label: "Мотивация: стабильность", defaultWeight: 0 },
  { key: "motivation_autonomy", label: "Мотивация: самостоятельность", defaultWeight: 0 },
  { key: "motivation_structure", label: "Мотивация: структура", defaultWeight: 0 },
  { key: "motivation_recognition", label: "Мотивация: признание", defaultWeight: 0 },
] as const;

export type JobStatus = (typeof JOB_STATUS_VALUES)[number];
export type EmploymentType = (typeof EMPLOYMENT_TYPE_VALUES)[number];
export type CompetencyKey = (typeof COMPETENCIES)[number]["key"];

export function canManageJobs(role: CompanyRole) {
  return role === "owner" || role === "admin" || role === "recruiter" || role === "super_admin";
}
