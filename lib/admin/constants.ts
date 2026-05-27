export const PLATFORM_ROLE_VALUES = [
  "platform_owner",
  "platform_admin",
  "platform_support",
  "platform_analyst",
] as const;

export const PLATFORM_ROLE_LABELS: Record<PlatformRole, string> = {
  platform_admin: "Администратор",
  platform_analyst: "Аналитик",
  platform_owner: "Владелец платформы",
  platform_support: "Поддержка",
};

export const PLATFORM_STATUS_LABELS = {
  active: "Активен",
  disabled: "Отключен",
  invited: "Приглашен",
} as const;

export const COMPANY_STATUS_VALUES = ["active", "suspended", "archived"] as const;

export const COMPANY_STATUS_LABELS: Record<CompanyStatus, string> = {
  active: "Активна",
  archived: "В архиве",
  suspended: "Приостановлена",
};

export const ACCESS_REASON_VALUES = [
  "support_request",
  "quality_check",
  "incident_review",
  "other",
] as const;

export const ACCESS_REASON_LABELS: Record<AccessReason, string> = {
  incident_review: "Разбор инцидента",
  other: "Другая служебная причина",
  quality_check: "Проверка качества оценки",
  support_request: "Обращение поддержки",
};

export type PlatformRole = (typeof PLATFORM_ROLE_VALUES)[number];
export type CompanyStatus = (typeof COMPANY_STATUS_VALUES)[number];
export type AccessReason = (typeof ACCESS_REASON_VALUES)[number];

export function canOperateCompanies(role: PlatformRole) {
  return role === "platform_owner" || role === "platform_admin";
}

export function canManageSystemTests(role: PlatformRole) {
  return role === "platform_owner" || role === "platform_admin";
}

export function canViewCandidatePii(role: PlatformRole) {
  return role !== "platform_analyst";
}

export function canManagePlatformTeam(role: PlatformRole) {
  return role === "platform_owner";
}
