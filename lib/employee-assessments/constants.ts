import type { CompanyRole } from "@/lib/auth/context";

export const EMPLOYEE_ASSESSMENT_STATUS_VALUES = [
  "draft",
  "active",
  "paused",
  "closed",
  "archived",
] as const;

export const EMPLOYEE_ASSESSMENT_STATUS_LABELS: Record<
  (typeof EMPLOYEE_ASSESSMENT_STATUS_VALUES)[number],
  string
> = {
  active: "Активна",
  archived: "В архиве",
  closed: "Закрыта",
  draft: "Черновик",
  paused: "Приостановлена",
};

export const EMPLOYEE_PARTICIPANT_STATUS_VALUES = [
  "invited",
  "in_progress",
  "completed",
  "cancelled",
  "archived",
] as const;

export const EMPLOYEE_PARTICIPANT_STATUS_LABELS: Record<
  (typeof EMPLOYEE_PARTICIPANT_STATUS_VALUES)[number],
  string
> = {
  archived: "В архиве",
  cancelled: "Отменен",
  completed: "Завершил оценку",
  in_progress: "Проходит оценку",
  invited: "Приглашен",
};

export type EmployeeAssessmentStatus = (typeof EMPLOYEE_ASSESSMENT_STATUS_VALUES)[number];
export type EmployeeParticipantStatus = (typeof EMPLOYEE_PARTICIPANT_STATUS_VALUES)[number];

export function canManageEmployeeAssessments(role: CompanyRole) {
  return role === "owner" || role === "admin" || role === "recruiter" || role === "super_admin";
}
