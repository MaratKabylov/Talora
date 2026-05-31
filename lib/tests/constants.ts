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

export const SYSTEM_TEST_GROUPS = [
  {
    description: "Базовые тесты для оценки универсального потенциала кандидата.",
    emptyText: "Общие системные тесты пока не добавлены.",
    key: "general",
    title: "Общие",
  },
  {
    description: "Тесты под конкретные роли, функции и рабочие задачи.",
    emptyText: "Профессиональные системные тесты пока не добавлены.",
    key: "professional",
    title: "Профессиональные",
  },
] as const;

const GENERAL_SYSTEM_TEST_CATEGORIES: ReadonlySet<string> = new Set([
  "attention_to_detail",
  "general_potential",
  "learning_ability",
  "motivation",
  "work_behavior",
]);

export type TestTemplateStatus = (typeof TEST_TEMPLATE_STATUS_VALUES)[number];
export type TestVersionStatus = (typeof TEST_VERSION_STATUS_VALUES)[number];
export type ScoringType = (typeof SCORING_TYPE_VALUES)[number];
export type SystemTestGroup = (typeof SYSTEM_TEST_GROUPS)[number]["key"];

export function getSystemTestGroup(category: string | null): SystemTestGroup {
  if (!category || GENERAL_SYSTEM_TEST_CATEGORIES.has(category)) {
    return "general";
  }

  return "professional";
}

export function canManageTests(role: CompanyRole) {
  return role === "owner" || role === "admin" || role === "recruiter" || role === "super_admin";
}
