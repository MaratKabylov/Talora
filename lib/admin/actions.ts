"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";

import {
  COMPANY_STATUS_VALUES,
  canManagePlatformTeam,
  canOperateCompanies,
} from "./constants";
import { requirePlatformContext } from "./context";
import { recordPlatformAudit } from "./data";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function redirectWithFeedback(path: string, type: "error" | "message", text: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${new URLSearchParams({ [type]: text }).toString()}`);
}

const companyStatusSchema = z.object({
  companyId: z.string().uuid(),
  reason: z.string().trim().max(1000).optional(),
  status: z.enum(COMPANY_STATUS_VALUES),
});

export async function updateCompanyStatusAction(formData: FormData) {
  const parsed = companyStatusSchema.safeParse({
    companyId: formString(formData, "companyId"),
    reason: formString(formData, "reason"),
    status: formString(formData, "status"),
  });
  if (!parsed.success) {
    redirect("/admin/companies");
  }

  const path = `/admin/companies/${parsed.data.companyId}`;
  const context = await requirePlatformContext();
  if (!canOperateCompanies(context.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права менять статус компании.");
  }
  if (parsed.data.status === "suspended" && !parsed.data.reason?.trim()) {
    redirectWithFeedback(path, "error", "Укажите причину приостановки доступа.");
  }

  const admin = createAdminClient();
  const isSuspended = parsed.data.status === "suspended";
  const { error } = await admin
    .from("companies")
    .update({
      status: parsed.data.status,
      suspended_at: isSuspended ? new Date().toISOString() : null,
      suspended_by: isSuspended ? context.user.id : null,
      suspension_reason: isSuspended ? parsed.data.reason?.trim() : null,
    })
    .eq("id", parsed.data.companyId);

  if (error) {
    redirectWithFeedback(path, "error", "Не удалось изменить статус компании.");
  }
  await recordPlatformAudit(
    context,
    `company_${parsed.data.status}`,
    "company",
    parsed.data.companyId,
    parsed.data.companyId,
    parsed.data.reason?.trim() || null,
  );
  revalidatePath("/admin");
  revalidatePath("/admin/companies");
  revalidatePath(path);
  redirectWithFeedback(path, "message", "Статус компании обновлен.");
}

const noteSchema = z.object({
  companyId: z.string().uuid(),
  note: z.string().trim().min(2, "Введите заметку.").max(4000, "Заметка слишком длинная."),
});

export async function addCompanyNoteAction(formData: FormData) {
  const parsed = noteSchema.safeParse({
    companyId: formString(formData, "companyId"),
    note: formString(formData, "note"),
  });
  if (!parsed.success) {
    redirectWithFeedback("/admin/companies", "error", "Не удалось сохранить заметку.");
  }
  const path = `/admin/companies/${parsed.data.companyId}`;
  const context = await requirePlatformContext();
  if (context.role === "platform_analyst") {
    redirectWithFeedback(path, "error", "Аналитик не может добавлять заметки.");
  }
  const admin = createAdminClient();
  const { error } = await admin.from("platform_company_notes").insert({
    author_user_id: context.user.id,
    company_id: parsed.data.companyId,
    note: parsed.data.note,
  });
  if (error) {
    redirectWithFeedback(path, "error", "Не удалось сохранить заметку.");
  }
  await recordPlatformAudit(context, "add_company_note", "company", parsed.data.companyId, parsed.data.companyId);
  revalidatePath(path);
  redirectWithFeedback(path, "message", "Внутренняя заметка добавлена.");
}

const membershipSchema = z.object({
  companyId: z.string().uuid(),
  membershipId: z.string().uuid(),
  status: z.enum(["active", "disabled"]),
});

export async function updateTenantMembershipAction(formData: FormData) {
  const parsed = membershipSchema.safeParse({
    companyId: formString(formData, "companyId"),
    membershipId: formString(formData, "membershipId"),
    status: formString(formData, "status"),
  });
  if (!parsed.success) {
    redirect("/admin/users");
  }
  const context = await requirePlatformContext();
  if (!canOperateCompanies(context.role)) {
    redirectWithFeedback("/admin/users", "error", "У вашей роли нет права изменять доступ пользователей.");
  }
  const admin = createAdminClient();
  if (parsed.data.status === "disabled") {
    const { data: membership, error: membershipError } = await admin
      .from("company_users")
      .select("role")
      .eq("id", parsed.data.membershipId)
      .eq("company_id", parsed.data.companyId)
      .maybeSingle();
    if (membershipError || !membership) {
      redirectWithFeedback("/admin/users", "error", "Пользователь не найден.");
    }
    if (membership.role === "owner") {
      const { count, error: ownersError } = await admin
        .from("company_users")
        .select("*", { count: "exact", head: true })
        .eq("company_id", parsed.data.companyId)
        .eq("role", "owner")
        .eq("status", "active")
        .neq("id", parsed.data.membershipId);
      if (ownersError || !count) {
        redirectWithFeedback("/admin/users", "error", "Нельзя отключить единственного активного владельца компании.");
      }
    }
  }
  const { error } = await admin
    .from("company_users")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.membershipId)
    .eq("company_id", parsed.data.companyId);
  if (error) {
    redirectWithFeedback("/admin/users", "error", "Не удалось обновить доступ пользователя.");
  }
  await recordPlatformAudit(
    context,
    `tenant_membership_${parsed.data.status}`,
    "company_user",
    parsed.data.membershipId,
    parsed.data.companyId,
  );
  revalidatePath("/admin/users");
  revalidatePath(`/admin/companies/${parsed.data.companyId}`);
  redirectWithFeedback("/admin/users", "message", "Статус пользователя обновлен.");
}

const platformUserSchema = z.object({
  status: z.enum(["active", "disabled"]),
  userId: z.string().uuid(),
});

export async function updatePlatformUserStatusAction(formData: FormData) {
  const parsed = platformUserSchema.safeParse({
    status: formString(formData, "status"),
    userId: formString(formData, "userId"),
  });
  if (!parsed.success) {
    redirect("/admin/team");
  }
  const context = await requirePlatformContext();
  if (!canManagePlatformTeam(context.role)) {
    redirectWithFeedback("/admin/team", "error", "Только владелец платформы управляет командой.");
  }
  if (parsed.data.userId === context.user.id && parsed.data.status === "disabled") {
    redirectWithFeedback("/admin/team", "error", "Нельзя отключить собственный доступ.");
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from("platform_users")
    .update({ status: parsed.data.status })
    .eq("user_id", parsed.data.userId);
  if (error) {
    redirectWithFeedback("/admin/team", "error", "Не удалось изменить доступ сотрудника.");
  }
  await recordPlatformAudit(
    context,
    `platform_user_${parsed.data.status}`,
    "platform_user",
    parsed.data.userId,
  );
  revalidatePath("/admin/team");
  redirectWithFeedback("/admin/team", "message", "Доступ сотрудника обновлен.");
}
