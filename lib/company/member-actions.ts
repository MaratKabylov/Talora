"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAuthContext } from "@/lib/auth/context";
import { activeCompanyCookieOptions, ACTIVE_COMPANY_COOKIE } from "@/lib/company/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { INVITABLE_COMPANY_ROLE_VALUES } from "./members-constants";

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function membersPath(companyId: string) {
  return `/dashboard/company/members?organizationId=${encodeURIComponent(companyId)}`;
}

function redirectWithFeedback(path: string, type: "error" | "message", text: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${new URLSearchParams({ [type]: text }).toString()}`);
}

function getCompanyInvitationRedirectTo(companyId: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return undefined;
  }

  const confirmUrl = new URL("/auth/confirm", appUrl);
  confirmUrl.searchParams.set("next", `/invite/company?organizationId=${companyId}`);
  return confirmUrl.toString();
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function requireOwnerForCompany(companyId: string) {
  const context = await requireAuthContext();
  const company = context.companies.find(
    (membership) => membership.id === companyId && membership.role === "owner",
  );

  if (!company) {
    redirectWithFeedback(
      membersPath(context.activeCompany?.id ?? companyId),
      "error",
      "Только владелец организации управляет ее участниками.",
    );
  }

  return { company, context };
}

async function recordCompanyAudit(
  companyId: string,
  actorUserId: string,
  action: string,
  targetUserId: string | null,
  metadata: Record<string, unknown> = {},
) {
  const admin = createAdminClient();
  const { error } = await admin.from("company_audit_logs").insert({
    action,
    actor_user_id: actorUserId,
    company_id: companyId,
    metadata_json: metadata,
    target_user_id: targetUserId,
  });

  if (error) {
    throw new Error("Unable to write company audit event.");
  }
}

const inviteMemberSchema = z.object({
  companyId: z.string().uuid(),
  email: z
    .string()
    .trim()
    .email("Введите корректный email.")
    .transform((value) => value.toLowerCase()),
  role: z.enum(INVITABLE_COMPANY_ROLE_VALUES),
});

export async function inviteCompanyMemberAction(formData: FormData) {
  const parsed = inviteMemberSchema.safeParse({
    companyId: formString(formData, "companyId"),
    email: formString(formData, "email"),
    role: formString(formData, "role"),
  });
  if (!parsed.success) {
    redirectWithFeedback("/dashboard/company/members", "error", parsed.error.issues[0].message);
  }

  const path = membersPath(parsed.data.companyId);
  const { context } = await requireOwnerForCompany(parsed.data.companyId);
  const admin = createAdminClient();
  const { data: matchedProfiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, email")
    .ilike("email", escapeLikePattern(parsed.data.email))
    .limit(2);

  if (profilesError) {
    redirectWithFeedback(path, "error", "Не удалось проверить email сотрудника.");
  }
  if ((matchedProfiles ?? []).length > 1) {
    redirectWithFeedback(path, "error", "Найдено несколько аккаунтов с этим email. Обратитесь в поддержку.");
  }

  const existingProfile = matchedProfiles?.[0] ?? null;
  if (existingProfile) {
    const { data: existingMembership, error: membershipError } = await admin
      .from("company_users")
      .select("id, role, status")
      .eq("company_id", parsed.data.companyId)
      .eq("user_id", existingProfile.id)
      .maybeSingle();

    if (membershipError) {
      redirectWithFeedback(path, "error", "Не удалось проверить доступ сотрудника.");
    }
    if (existingMembership?.role === "owner") {
      redirectWithFeedback(path, "error", "Владелец уже имеет доступ к этой организации.");
    }
    if (existingMembership?.status === "active") {
      redirectWithFeedback(path, "error", "Пользователь уже имеет активный доступ к организации.");
    }

    const membershipChange = {
      company_id: parsed.data.companyId,
      role: parsed.data.role,
      status: "active",
      user_id: existingProfile.id,
    };
    const { error: accessError } = existingMembership
      ? await admin
          .from("company_users")
          .update({ role: parsed.data.role, status: "active" })
          .eq("id", existingMembership.id)
      : await admin.from("company_users").insert(membershipChange);

    if (accessError) {
      redirectWithFeedback(path, "error", "Не удалось предоставить доступ к организации.");
    }

    await recordCompanyAudit(
      parsed.data.companyId,
      context.user.id,
      "grant_existing_member_access",
      existingProfile.id,
      {
        email: parsed.data.email,
        previousStatus: existingMembership?.status ?? null,
        role: parsed.data.role,
      },
    );
    revalidatePath("/dashboard", "layout");
    revalidatePath(path);
    redirectWithFeedback(path, "message", "Пользователь найден. Доступ к организации предоставлен.");
  }

  const { data: invitedUser, error: invitationError } =
    await admin.auth.admin.inviteUserByEmail(parsed.data.email, {
      redirectTo: getCompanyInvitationRedirectTo(parsed.data.companyId),
    });

  if (invitationError || !invitedUser.user) {
    redirectWithFeedback(path, "error", "Не удалось отправить приглашение. Проверьте настройки Auth email.");
  }

  const { error: accessError } = await admin.from("company_users").insert({
    company_id: parsed.data.companyId,
    role: parsed.data.role,
    status: "invited",
    user_id: invitedUser.user.id,
  });

  if (accessError) {
    redirectWithFeedback(
      path,
      "error",
      "Письмо отправлено, но доступ не сохранен. Проверьте участника и повторите действие.",
    );
  }

  await recordCompanyAudit(parsed.data.companyId, context.user.id, "invite_member", invitedUser.user.id, {
    email: parsed.data.email,
    role: parsed.data.role,
  });
  revalidatePath(path);
  redirectWithFeedback(path, "message", "Пользователь не найден. Приглашение отправлено по email.");
}

const memberActionSchema = z.object({
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function disableCompanyMemberAction(formData: FormData) {
  const parsed = memberActionSchema.safeParse({
    companyId: formString(formData, "companyId"),
    userId: formString(formData, "userId"),
  });
  if (!parsed.success) {
    redirect("/dashboard/company/members");
  }

  const path = membersPath(parsed.data.companyId);
  const { context } = await requireOwnerForCompany(parsed.data.companyId);
  const admin = createAdminClient();
  const { data: member, error: memberError } = await admin
    .from("company_users")
    .select("role, status, user_id")
    .eq("company_id", parsed.data.companyId)
    .eq("user_id", parsed.data.userId)
    .maybeSingle();

  if (memberError || !member) {
    redirectWithFeedback(path, "error", "Участник не найден.");
  }
  if (member.role === "owner") {
    redirectWithFeedback(path, "error", "Нельзя отключить единственного владельца организации.");
  }
  if (member.status === "disabled") {
    redirectWithFeedback(path, "error", "Доступ этого участника уже отключен.");
  }

  const action = member.status === "invited" ? "revoke_member_invitation" : "disable_member";
  const { error } = await admin
    .from("company_users")
    .update({ status: "disabled" })
    .eq("company_id", parsed.data.companyId)
    .eq("user_id", parsed.data.userId);

  if (error) {
    redirectWithFeedback(path, "error", "Не удалось отключить доступ участника.");
  }

  await recordCompanyAudit(parsed.data.companyId, context.user.id, action, member.user_id, {
    previousStatus: member.status,
    role: member.role,
  });
  revalidatePath("/dashboard", "layout");
  revalidatePath(path);
  redirectWithFeedback(
    path,
    "message",
    action === "revoke_member_invitation" ? "Приглашение отозвано." : "Доступ участника отключен.",
  );
}

const roleChangeSchema = memberActionSchema.extend({
  role: z.enum(INVITABLE_COMPANY_ROLE_VALUES),
});

export async function updateCompanyMemberRoleAction(formData: FormData) {
  const parsed = roleChangeSchema.safeParse({
    companyId: formString(formData, "companyId"),
    userId: formString(formData, "userId"),
    role: formString(formData, "role"),
  });
  if (!parsed.success) {
    redirect("/dashboard/company/members");
  }

  const path = membersPath(parsed.data.companyId);
  const { context } = await requireOwnerForCompany(parsed.data.companyId);
  const admin = createAdminClient();
  const { data: member, error: memberError } = await admin
    .from("company_users")
    .select("role, user_id")
    .eq("company_id", parsed.data.companyId)
    .eq("user_id", parsed.data.userId)
    .maybeSingle();

  if (memberError || !member) {
    redirectWithFeedback(path, "error", "Участник не найден.");
  }
  if (member.role === "owner") {
    redirectWithFeedback(path, "error", "Роль владельца нельзя изменить через управление командой.");
  }
  if (member.role === parsed.data.role) {
    redirectWithFeedback(path, "message", "Роль участника уже установлена.");
  }

  const { error } = await admin
    .from("company_users")
    .update({ role: parsed.data.role })
    .eq("company_id", parsed.data.companyId)
    .eq("user_id", parsed.data.userId);

  if (error) {
    redirectWithFeedback(path, "error", "Не удалось изменить роль участника.");
  }

  await recordCompanyAudit(parsed.data.companyId, context.user.id, "update_member_role", member.user_id, {
    fromRole: member.role,
    toRole: parsed.data.role,
  });
  revalidatePath(path);
  redirectWithFeedback(path, "message", "Роль участника обновлена.");
}

const acceptInvitationSchema = z.object({
  companyId: z.string().uuid(),
  fullName: z.string().trim().min(2, "Укажите имя.").max(120, "Имя слишком длинное."),
  password: z.string().min(8, "Пароль должен содержать минимум 8 символов."),
});

export async function acceptCompanyInvitationAction(formData: FormData) {
  const rawCompanyId = formString(formData, "companyId");
  const path = z.string().uuid().safeParse(rawCompanyId).success
    ? `/invite/company?organizationId=${encodeURIComponent(rawCompanyId)}`
    : "/invite/company";
  const parsed = acceptInvitationSchema.safeParse({
    companyId: rawCompanyId,
    fullName: formString(formData, "fullName"),
    password: formString(formData, "password"),
  });
  if (!parsed.success) {
    redirectWithFeedback(path, "error", parsed.error.issues[0].message);
  }

  const context = await requireAuthContext();
  const admin = createAdminClient();
  const { data: membership, error: membershipError } = await admin
    .from("company_users")
    .select("role, status")
    .eq("company_id", parsed.data.companyId)
    .eq("user_id", context.user.id)
    .maybeSingle();

  if (membershipError || !membership || membership.status !== "invited") {
    redirectWithFeedback("/login", "error", "Для аккаунта нет действующего приглашения.");
  }

  const supabase = await createClient();
  const { error: passwordError } = await supabase.auth.updateUser({
    data: { full_name: parsed.data.fullName },
    password: parsed.data.password,
  });
  if (passwordError) {
    redirectWithFeedback(path, "error", "Не удалось завершить регистрацию. Попробуйте снова.");
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", context.user.id);
  if (profileError) {
    redirectWithFeedback(path, "error", "Не удалось сохранить профиль сотрудника.");
  }

  const { data: acceptedMembership, error: activationError } = await admin
    .from("company_users")
    .update({ status: "active" })
    .eq("company_id", parsed.data.companyId)
    .eq("user_id", context.user.id)
    .eq("status", "invited")
    .select("id")
    .maybeSingle();
  if (activationError || !acceptedMembership) {
    redirectWithFeedback(path, "error", "Не удалось активировать доступ к организации.");
  }

  await recordCompanyAudit(
    parsed.data.companyId,
    context.user.id,
    "accept_member_invitation",
    context.user.id,
    { role: membership.role },
  );

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_COMPANY_COOKIE, parsed.data.companyId, activeCompanyCookieOptions);
  revalidatePath("/dashboard", "layout");
  redirectWithFeedback(
    `/dashboard/company/members?organizationId=${encodeURIComponent(parsed.data.companyId)}`,
    "message",
    "Приглашение принято. Доступ к организации активирован.",
  );
}
