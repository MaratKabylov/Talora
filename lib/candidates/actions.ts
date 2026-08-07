"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireCompanyContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

import { canManageCandidates } from "./constants";

const optionalText = (maximum: number) =>
  z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text || null;
    },
    z.string().max(maximum, "Значение слишком длинное.").nullable(),
  );

const invitationSchema = z.object({
  city: optionalText(120),
  email: z.string().trim().email("Укажите корректный email кандидата.").max(255),
  expiresAt: z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text || null;
    },
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите корректную дату окончания ссылки.").nullable(),
  ),
  fullName: z.string().trim().min(2, "Укажите имя кандидата.").max(180, "Имя слишком длинное."),
  jobId: z.string().uuid(),
  phone: optionalText(40),
  source: optionalText(120),
});

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getJobPath(jobId: string) {
  return `/dashboard/jobs/${jobId}/candidates`;
}

function redirectWithFeedback(path: string, type: "error" | "message", text: string): never {
  const separator = path.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ [type]: text });
  redirect(`${path}${separator}${params.toString()}`);
}

function getInvitationErrorMessage(message: string) {
  if (message.includes("Invitation expiration must be in the future")) {
    return "Дата окончания ссылки должна быть в будущем.";
  }

  if (message.includes("Job is unavailable for invitations or has no assessment package")) {
    return "Для приглашения назначьте вакансии пакет оценки и убедитесь, что вакансия не закрыта.";
  }

  if (message.includes("This application cannot receive a new invitation")) {
    return "Этот кандидат уже завершил участие в вакансии, либо его отклик закрыт.";
  }

  if (message.includes("Candidate has already started the assessment")) {
    return "Кандидат уже начал оценку. Создать новую ссылку для этого отклика нельзя.";
  }

  if (message.includes("User cannot invite candidates for this company")) {
    return "У вашей роли нет права приглашать кандидатов.";
  }

  if (message.includes("Could not find the function") || message.includes("schema cache")) {
    return "Функция приглашений не настроена в базе. Примените последние миграции Supabase.";
  }

  if (message.includes("gen_random_bytes")) {
    return "Не удалось сгенерировать ссылку. Примените последние миграции Supabase.";
  }

  return "Не удалось создать приглашение. Проверьте настройку вакансии и миграции Supabase.";
}

function getReturnPath(formData: FormData) {
  const returnTo = formString(formData, "returnTo");
  const jobPath = /^\/dashboard\/jobs\/[0-9a-f-]{36}(?:\/candidates)?$/i;

  return jobPath.test(returnTo) ? returnTo : "/dashboard/candidates";
}

export async function inviteCandidateAction(formData: FormData) {
  const invitation = invitationSchema.safeParse({
    city: formString(formData, "city"),
    email: formString(formData, "email"),
    expiresAt: formString(formData, "expiresAt"),
    fullName: formString(formData, "fullName"),
    jobId: formString(formData, "jobId"),
    phone: formString(formData, "phone"),
    source: formString(formData, "source"),
  });

  if (!invitation.success) {
    const rawJobId = z.string().uuid().safeParse(formString(formData, "jobId"));
    const path = rawJobId.success ? getJobPath(rawJobId.data) : "/dashboard/jobs";
    redirectWithFeedback(path, "error", invitation.error.issues[0].message);
  }

  const context = await requireCompanyContext();
  const path = getJobPath(invitation.data.jobId);

  if (!canManageCandidates(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права приглашать кандидатов.");
  }

  const expiresAt = invitation.data.expiresAt
    ? new Date(`${invitation.data.expiresAt}T23:59:59.999Z`).toISOString()
    : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_candidate_to_job", {
    candidate_city: invitation.data.city,
    candidate_email: invitation.data.email,
    candidate_full_name: invitation.data.fullName,
    candidate_phone: invitation.data.phone,
    candidate_source: invitation.data.source,
    invitation_expires_at: expiresAt,
    target_company_id: context.activeCompany.id,
    target_job_id: invitation.data.jobId,
  });

  if (error) {
    redirectWithFeedback(path, "error", getInvitationErrorMessage(error.message));
  }

  revalidatePath(path);
  revalidatePath("/dashboard/candidates");
  redirectWithFeedback(path, "message", "Кандидат добавлен, ссылка-приглашение создана.");
}

export async function cancelInvitationAction(formData: FormData) {
  const invitationId = z.string().uuid().safeParse(formString(formData, "invitationId"));
  const path = getReturnPath(formData);

  if (!invitationId.success) {
    redirect(path);
  }

  const context = await requireCompanyContext();
  if (!canManageCandidates(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права отменять приглашения.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invitations")
    .update({ status: "cancelled" })
    .eq("company_id", context.activeCompany.id)
    .eq("id", invitationId.data)
    .in("status", ["created", "sent", "opened"])
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirectWithFeedback(path, "error", "Это приглашение уже нельзя отменить.");
  }

  revalidatePath(path);
  revalidatePath("/dashboard/candidates");
  redirectWithFeedback(path, "message", "Приглашение отменено.");
}
