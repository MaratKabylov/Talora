import type { CompanyRole } from "@/lib/auth/context";

export const TEST_TEMPLATE_STATUS_VALUES = ["active", "archived"] as const;

export const TEST_TEMPLATE_STATUS_LABELS: Record<(typeof TEST_TEMPLATE_STATUS_VALUES)[number], string> = {
  active: "Активен",
  archived: "В архиве",
};

export const TEST_VERSION_STATUS_VALUES = ["draft", "published", "archived"] as const;

export const TEST_VERSION_STATUS_LABELS: Record<(typeof TEST_VERSION_STATUS_VALUES)[number], string> = {
  draft: "Черновик",
  published: "Опубликована",
  archived: "В архиве",
};

export const SCORING_TYPE_VALUES = ["points", "competency_profile", "manual", "mixed"] as const;

export const SCORING_TYPE_LABELS: Record<(typeof SCORING_TYPE_VALUES)[number], string> = {
  points: "Балльная оценка",
  competency_profile: "Профиль компетенций",
  manual: "Ручная проверка",
  mixed: "Смешанная оценка",
};

export type TestTemplateStatus = (typeof TEST_TEMPLATE_STATUS_VALUES)[number];
export type TestVersionStatus = (typeof TEST_VERSION_STATUS_VALUES)[number];
export type ScoringType = (typeof SCORING_TYPE_VALUES)[number];

export function canManageTests(role: CompanyRole) {
  return role === "owner" || role === "admin" || role === "recruiter" || role === "super_admin";
}
