import type { CompanyRole } from "@/lib/auth/context";

export const INVITABLE_COMPANY_ROLE_VALUES = ["admin", "recruiter", "viewer"] as const;

export type InvitableCompanyRole = (typeof INVITABLE_COMPANY_ROLE_VALUES)[number];

export const COMPANY_ROLE_LABELS: Record<CompanyRole, string> = {
  admin: "Администратор",
  owner: "Владелец",
  recruiter: "Рекрутер",
  super_admin: "Суперадминистратор",
  viewer: "Наблюдатель",
};

export const COMPANY_MEMBER_STATUS_LABELS: Record<string, string> = {
  active: "Активен",
  disabled: "Отключен",
  invited: "Приглашен",
};

export const COMPANY_AUDIT_ACTION_LABELS: Record<string, string> = {
  accept_member_invitation: "Принял приглашение",
  disable_member: "Доступ отключен",
  grant_existing_member_access: "Доступ выдан существующему аккаунту",
  invite_member: "Приглашение отправлено",
  revoke_member_invitation: "Приглашение отозвано",
  update_member_role: "Роль изменена",
};
