import type { CompanyRole } from "@/lib/auth/context";

export const APPLICATION_STATUS_VALUES = [
  "invited",
  "in_progress",
  "completed",
  "shortlisted",
  "rejected",
  "hired",
  "withdrawn",
] as const;

export const APPLICATION_STATUS_LABELS: Record<(typeof APPLICATION_STATUS_VALUES)[number], string> = {
  invited: "Приглашен",
  in_progress: "Проходит оценку",
  completed: "Завершил оценку",
  shortlisted: "В шорт-листе",
  rejected: "Отклонен",
  hired: "Нанят",
  withdrawn: "Отказался",
};

export const INVITATION_STATUS_VALUES = [
  "created",
  "sent",
  "opened",
  "started",
  "completed",
  "expired",
  "cancelled",
] as const;

export const INVITATION_STATUS_LABELS: Record<(typeof INVITATION_STATUS_VALUES)[number], string> = {
  created: "Создана",
  sent: "Отправлена",
  opened: "Открыта",
  started: "Начата",
  completed: "Завершена",
  expired: "Истекла",
  cancelled: "Отменена",
};

export const RECOMMENDATION_LABELS: Record<string, string> = {
  backup: "Резерв",
  consider: "Рассмотреть",
  invite: "Пригласить далее",
  not_recommended: "Не рекомендуется",
  requires_review: "Нужна проверка",
  strong_candidate: "Сильный кандидат",
};

export const RISK_LEVEL_LABELS: Record<string, string> = {
  high: "Высокий риск",
  low: "Низкий риск",
  medium: "Средний риск",
};

export type ApplicationStatus = (typeof APPLICATION_STATUS_VALUES)[number];
export type InvitationStatus = (typeof INVITATION_STATUS_VALUES)[number];

export function canManageCandidates(role: CompanyRole) {
  return role === "owner" || role === "admin" || role === "recruiter" || role === "super_admin";
}
