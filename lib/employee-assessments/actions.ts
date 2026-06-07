"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireCompanyContext } from "@/lib/auth/context";
import { COMPETENCIES, type CompetencyKey } from "@/lib/jobs/constants";
import { isAssessmentPackageAvailable } from "@/lib/jobs/package-access";
import { createClient } from "@/lib/supabase/server";

import {
  canManageEmployeeAssessments,
  EMPLOYEE_ASSESSMENT_STATUS_VALUES,
} from "./constants";

const optionalText = (maximum: number) =>
  z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text || null;
    },
    z.string().max(maximum, "Значение слишком длинное.").nullable(),
  );

const optionalPercentage = z.preprocess(
  (value) => {
    const text = typeof value === "string" ? value.trim().replace(",", ".") : "";
    return text ? Number(text) : null;
  },
  z
    .number()
    .min(0, "Значение не может быть меньше 0.")
    .max(100, "Значение не может быть больше 100.")
    .nullable(),
);

const assessmentSchema = z.object({
  assessmentPackageId: z.string().uuid("Выберите пакет оценки."),
  description: optionalText(4000),
  passingScore: optionalPercentage,
  status: z.enum(EMPLOYEE_ASSESSMENT_STATUS_VALUES),
  title: z
    .string()
    .trim()
    .min(2, "Укажите название оценки сотрудников.")
    .max(180, "Название слишком длинное."),
});

const weightSchema = z.object({
  competencyKey: z.enum(
    COMPETENCIES.map((competency) => competency.key) as [CompetencyKey, ...CompetencyKey[]],
  ),
  isRequired: z.boolean(),
  minimumScore: optionalPercentage,
  weightPercent: z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim().replace(",", ".") : "";
      return text ? Number(text) : Number.NaN;
    },
    z
      .number()
      .min(0, "Вес не может быть меньше 0.")
      .max(100, "Вес не может быть больше 100."),
  ),
});

const weightsSchema = z.array(weightSchema).superRefine((weights, context) => {
  const sum = weights.reduce((total, weight) => total + weight.weightPercent, 0);

  if (Math.abs(sum - 100) > 0.01) {
    context.addIssue({
      code: "custom",
      message: `Сумма весов должна быть 100%. Сейчас: ${sum.toLocaleString("ru-RU")}%.`,
    });
  }
});

const invitationSchema = z.object({
  department: optionalText(120),
  email: z.string().trim().email("Укажите корректный email сотрудника.").max(255),
  employeeAssessmentId: z.string().uuid(),
  expiresAt: z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text || null;
    },
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Укажите корректную дату окончания ссылки.")
      .nullable(),
  ),
  fullName: z
    .string()
    .trim()
    .min(2, "Укажите имя сотрудника.")
    .max(180, "Имя слишком длинное."),
  phone: optionalText(40),
  roleTitle: optionalText(160),
});

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function redirectWithFeedback(path: string, type: "error" | "message", text: string): never {
  const separator = path.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ [type]: text });
  redirect(`${path}${separator}${params.toString()}`);
}

function parseAssessment(formData: FormData) {
  return assessmentSchema.safeParse({
    assessmentPackageId: formString(formData, "assessmentPackageId"),
    description: formString(formData, "description"),
    passingScore: formString(formData, "passingScore"),
    status: formString(formData, "status"),
    title: formString(formData, "title"),
  });
}

function parseWeights(formData: FormData) {
  return weightsSchema.safeParse(
    COMPETENCIES.map((competency) => ({
      competencyKey: competency.key,
      isRequired: formData.get(`required_${competency.key}`) === "on",
      minimumScore: formString(formData, `minimum_${competency.key}`),
      weightPercent: formString(formData, `weight_${competency.key}`),
    })),
  );
}

function assessmentPath(assessmentId: string) {
  return `/dashboard/employee-assessments/${assessmentId}`;
}

function weightsToRows(
  companyId: string,
  employeeAssessmentId: string,
  weights: z.infer<typeof weightsSchema>,
) {
  return weights.map((weight) => ({
    company_id: companyId,
    competency_key: weight.competencyKey,
    employee_assessment_id: employeeAssessmentId,
    is_required: weight.isRequired,
    minimum_score: weight.minimumScore,
    weight: weight.weightPercent / 100,
  }));
}

function getInvitationErrorMessage(message: string) {
  if (message.includes("Invitation expiration must be in the future")) {
    return "Дата окончания ссылки должна быть в будущем.";
  }

  if (message.includes("Employee assessment is unavailable for invitations")) {
    return "Оценка должна быть активной и иметь доступный пакет тестов.";
  }

  if (message.includes("cannot receive a new invitation")) {
    return "Этот сотрудник уже завершил или отменил участие в этой оценке.";
  }

  if (message.includes("Employee has already started the assessment")) {
    return "Сотрудник уже начал оценку. Создать новую ссылку для этого участия нельзя.";
  }

  if (message.includes("User cannot invite employees")) {
    return "У вашей роли нет права приглашать сотрудников.";
  }

  if (message.includes("Could not find the function") || message.includes("schema cache")) {
    return "Функция приглашения сотрудников не настроена в базе. Примените последние миграции Supabase.";
  }

  return "Не удалось создать приглашение сотрудника. Проверьте оценку и миграции Supabase.";
}

function getReturnPath(formData: FormData) {
  const returnTo = formString(formData, "returnTo");
  const assessmentPathPattern = /^\/dashboard\/employee-assessments\/[0-9a-f-]{36}$/i;

  return assessmentPathPattern.test(returnTo) ? returnTo : "/dashboard/employee-assessments";
}

export async function createEmployeeAssessmentAction(formData: FormData) {
  const context = await requireCompanyContext();
  const path = "/dashboard/employee-assessments/new";

  if (!canManageEmployeeAssessments(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права создавать оценки сотрудников.");
  }

  const assessment = parseAssessment(formData);
  const weights = parseWeights(formData);

  if (!assessment.success) {
    redirectWithFeedback(path, "error", assessment.error.issues[0].message);
  }

  if (!weights.success) {
    redirectWithFeedback(path, "error", weights.error.issues[0].message);
  }

  const supabase = await createClient();
  if (
    !(await isAssessmentPackageAvailable(
      supabase,
      context.activeCompany.id,
      assessment.data.assessmentPackageId,
    ))
  ) {
    redirectWithFeedback(path, "error", "Выбранный пакет оценки недоступен для этой компании.");
  }

  const { data: createdAssessment, error: assessmentError } = await supabase
    .from("employee_assessments")
    .insert({
      assessment_package_id: assessment.data.assessmentPackageId,
      company_id: context.activeCompany.id,
      created_by: context.user.id,
      description: assessment.data.description,
      passing_score: assessment.data.passingScore,
      status: assessment.data.status,
      title: assessment.data.title,
    })
    .select("id")
    .single();

  if (assessmentError || !createdAssessment) {
    redirectWithFeedback(path, "error", "Не удалось создать оценку сотрудников.");
  }

  const { error: weightsError } = await supabase
    .from("employee_assessment_competency_weights")
    .insert(weightsToRows(context.activeCompany.id, createdAssessment.id, weights.data));

  if (weightsError) {
    await supabase
      .from("employee_assessments")
      .delete()
      .eq("company_id", context.activeCompany.id)
      .eq("id", createdAssessment.id);
    redirectWithFeedback(path, "error", "Не удалось сохранить веса компетенций.");
  }

  revalidatePath("/dashboard/employee-assessments");
  redirectWithFeedback(assessmentPath(createdAssessment.id), "message", "Оценка сотрудников создана.");
}

export async function updateEmployeeAssessmentAction(formData: FormData) {
  const employeeAssessmentId = z.string().uuid().safeParse(formString(formData, "employeeAssessmentId"));

  if (!employeeAssessmentId.success) {
    redirect("/dashboard/employee-assessments");
  }

  const path = assessmentPath(employeeAssessmentId.data);
  const context = await requireCompanyContext();

  if (!canManageEmployeeAssessments(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права изменять оценки сотрудников.");
  }

  const assessment = parseAssessment(formData);
  if (!assessment.success) {
    redirectWithFeedback(path, "error", assessment.error.issues[0].message);
  }

  const supabase = await createClient();
  if (
    !(await isAssessmentPackageAvailable(
      supabase,
      context.activeCompany.id,
      assessment.data.assessmentPackageId,
    ))
  ) {
    redirectWithFeedback(path, "error", "Выбранный пакет оценки недоступен для этой компании.");
  }

  const { data: updatedAssessment, error } = await supabase
    .from("employee_assessments")
    .update({
      assessment_package_id: assessment.data.assessmentPackageId,
      description: assessment.data.description,
      passing_score: assessment.data.passingScore,
      status: assessment.data.status,
      title: assessment.data.title,
    })
    .eq("company_id", context.activeCompany.id)
    .eq("id", employeeAssessmentId.data)
    .select("id")
    .maybeSingle();

  if (error || !updatedAssessment) {
    redirectWithFeedback("/dashboard/employee-assessments", "error", "Оценка не найдена или недоступна.");
  }

  revalidatePath("/dashboard/employee-assessments");
  revalidatePath(path);
  redirectWithFeedback(path, "message", "Параметры оценки обновлены.");
}

export async function updateEmployeeAssessmentWeightsAction(formData: FormData) {
  const employeeAssessmentId = z.string().uuid().safeParse(formString(formData, "employeeAssessmentId"));

  if (!employeeAssessmentId.success) {
    redirect("/dashboard/employee-assessments");
  }

  const path = assessmentPath(employeeAssessmentId.data);
  const context = await requireCompanyContext();

  if (!canManageEmployeeAssessments(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права изменять веса.");
  }

  const weights = parseWeights(formData);
  if (!weights.success) {
    redirectWithFeedback(path, "error", weights.error.issues[0].message);
  }

  const supabase = await createClient();
  const { data: assessment } = await supabase
    .from("employee_assessments")
    .select("id")
    .eq("company_id", context.activeCompany.id)
    .eq("id", employeeAssessmentId.data)
    .maybeSingle();

  if (!assessment) {
    redirectWithFeedback("/dashboard/employee-assessments", "error", "Оценка сотрудников не найдена.");
  }

  const { error } = await supabase
    .from("employee_assessment_competency_weights")
    .upsert(weightsToRows(context.activeCompany.id, employeeAssessmentId.data, weights.data), {
      onConflict: "employee_assessment_id,competency_key",
    });

  if (error) {
    redirectWithFeedback(path, "error", "Не удалось обновить веса компетенций.");
  }

  revalidatePath(path);
  redirectWithFeedback(path, "message", "Веса компетенций обновлены.");
}

export async function inviteEmployeeToAssessmentAction(formData: FormData) {
  const invitation = invitationSchema.safeParse({
    department: formString(formData, "department"),
    email: formString(formData, "email"),
    employeeAssessmentId: formString(formData, "employeeAssessmentId"),
    expiresAt: formString(formData, "expiresAt"),
    fullName: formString(formData, "fullName"),
    phone: formString(formData, "phone"),
    roleTitle: formString(formData, "roleTitle"),
  });

  if (!invitation.success) {
    const rawAssessmentId = z.string().uuid().safeParse(formString(formData, "employeeAssessmentId"));
    const path = rawAssessmentId.success
      ? assessmentPath(rawAssessmentId.data)
      : "/dashboard/employee-assessments";
    redirectWithFeedback(path, "error", invitation.error.issues[0].message);
  }

  const context = await requireCompanyContext();
  const path = assessmentPath(invitation.data.employeeAssessmentId);

  if (!canManageEmployeeAssessments(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права приглашать сотрудников.");
  }

  const expiresAt = invitation.data.expiresAt
    ? new Date(`${invitation.data.expiresAt}T23:59:59.999Z`).toISOString()
    : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("invite_employee_to_assessment", {
    employee_department: invitation.data.department,
    employee_email: invitation.data.email,
    employee_full_name: invitation.data.fullName,
    employee_phone: invitation.data.phone,
    employee_role_title: invitation.data.roleTitle,
    invitation_expires_at: expiresAt,
    target_company_id: context.activeCompany.id,
    target_employee_assessment_id: invitation.data.employeeAssessmentId,
  });

  if (error) {
    redirectWithFeedback(path, "error", getInvitationErrorMessage(error.message));
  }

  revalidatePath(path);
  revalidatePath("/dashboard/employee-assessments");
  redirectWithFeedback(path, "message", "Сотрудник добавлен, ссылка-приглашение создана.");
}

export async function cancelEmployeeAssessmentInvitationAction(formData: FormData) {
  const invitationId = z.string().uuid().safeParse(formString(formData, "invitationId"));
  const path = getReturnPath(formData);

  if (!invitationId.success) {
    redirect(path);
  }

  const context = await requireCompanyContext();
  if (!canManageEmployeeAssessments(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права отменять приглашения.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_assessment_invitations")
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
  revalidatePath("/dashboard/employee-assessments");
  redirectWithFeedback(path, "message", "Приглашение отменено.");
}
