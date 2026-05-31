"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireCompanyContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

import {
  canManageJobs,
  COMPETENCIES,
  EMPLOYMENT_TYPE_VALUES,
  JOB_STATUS_VALUES,
  type CompetencyKey,
} from "./constants";
import { isAssessmentPackageAvailable } from "./package-access";

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
  z.number().min(0, "Значение не может быть меньше 0.").max(100, "Значение не может быть больше 100.").nullable(),
);

const jobSchema = z.object({
  assessmentPackageId: z.preprocess(
    (value) => (typeof value === "string" && value ? value : null),
    z.string().uuid().nullable(),
  ),
  department: optionalText(120),
  description: optionalText(4000),
  employmentType: z.preprocess(
    (value) => (typeof value === "string" && value ? value : null),
    z.enum(EMPLOYMENT_TYPE_VALUES).nullable(),
  ),
  location: optionalText(160),
  passingScore: optionalPercentage,
  status: z.enum(JOB_STATUS_VALUES),
  title: z.string().trim().min(2, "Укажите название вакансии.").max(180, "Название слишком длинное."),
});

const weightSchema = z.object({
  competencyKey: z.enum(COMPETENCIES.map((competency) => competency.key) as [CompetencyKey, ...CompetencyKey[]]),
  isRequired: z.boolean(),
  minimumScore: optionalPercentage,
  weightPercent: z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim().replace(",", ".") : "";
      return text ? Number(text) : Number.NaN;
    },
    z.number().min(0, "Вес не может быть меньше 0.").max(100, "Вес не может быть больше 100."),
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

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function redirectWithFeedback(path: string, type: "error" | "message", text: string): never {
  const separator = path.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ [type]: text });
  redirect(`${path}${separator}${params.toString()}`);
}

function parseJob(formData: FormData) {
  return jobSchema.safeParse({
    assessmentPackageId: formString(formData, "assessmentPackageId"),
    department: formString(formData, "department"),
    description: formString(formData, "description"),
    employmentType: formString(formData, "employmentType"),
    location: formString(formData, "location"),
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

function getJobPath(jobId: string) {
  return `/dashboard/jobs/${jobId}`;
}

async function isAvailablePackage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  packageId: string | null,
) {
  return isAssessmentPackageAvailable(supabase, companyId, packageId);
}

function weightsToRows(
  companyId: string,
  jobId: string,
  weights: z.infer<typeof weightsSchema>,
) {
  return weights.map((weight) => ({
    company_id: companyId,
    competency_key: weight.competencyKey,
    is_required: weight.isRequired,
    job_id: jobId,
    minimum_score: weight.minimumScore,
    weight: weight.weightPercent / 100,
  }));
}

export async function createJobAction(formData: FormData) {
  const context = await requireCompanyContext();
  const path = "/dashboard/jobs/new";

  if (!canManageJobs(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права создавать вакансии.");
  }

  const job = parseJob(formData);
  const weights = parseWeights(formData);

  if (!job.success) {
    redirectWithFeedback(path, "error", job.error.issues[0].message);
  }

  if (!weights.success) {
    redirectWithFeedback(path, "error", weights.error.issues[0].message);
  }

  const supabase = await createClient();
  if (!(await isAvailablePackage(supabase, context.activeCompany.id, job.data.assessmentPackageId))) {
    redirectWithFeedback(path, "error", "Выбранный пакет оценки недоступен для этой компании.");
  }

  const { data: createdJob, error: jobError } = await supabase
    .from("jobs")
    .insert({
      assessment_package_id: job.data.assessmentPackageId,
      company_id: context.activeCompany.id,
      created_by: context.user.id,
      department: job.data.department,
      description: job.data.description,
      employment_type: job.data.employmentType,
      location: job.data.location,
      passing_score: job.data.passingScore,
      status: job.data.status,
      title: job.data.title,
    })
    .select("id")
    .single();

  if (jobError || !createdJob) {
    redirectWithFeedback(path, "error", "Не удалось создать вакансию.");
  }

  const { error: weightsError } = await supabase
    .from("job_competency_weights")
    .insert(weightsToRows(context.activeCompany.id, createdJob.id, weights.data));

  if (weightsError) {
    await supabase
      .from("jobs")
      .delete()
      .eq("company_id", context.activeCompany.id)
      .eq("id", createdJob.id);
    redirectWithFeedback(path, "error", "Не удалось сохранить веса компетенций.");
  }

  revalidatePath("/dashboard/jobs");
  redirectWithFeedback(getJobPath(createdJob.id), "message", "Вакансия создана.");
}

export async function updateJobAction(formData: FormData) {
  const jobId = z.string().uuid().safeParse(formString(formData, "jobId"));

  if (!jobId.success) {
    redirect("/dashboard/jobs");
  }

  const path = getJobPath(jobId.data);
  const context = await requireCompanyContext();

  if (!canManageJobs(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права изменять вакансии.");
  }

  const job = parseJob(formData);
  if (!job.success) {
    redirectWithFeedback(path, "error", job.error.issues[0].message);
  }

  const supabase = await createClient();
  if (!(await isAvailablePackage(supabase, context.activeCompany.id, job.data.assessmentPackageId))) {
    redirectWithFeedback(path, "error", "Выбранный пакет оценки недоступен для этой компании.");
  }

  const { data: updatedJob, error } = await supabase
    .from("jobs")
    .update({
      assessment_package_id: job.data.assessmentPackageId,
      department: job.data.department,
      description: job.data.description,
      employment_type: job.data.employmentType,
      location: job.data.location,
      passing_score: job.data.passingScore,
      status: job.data.status,
      title: job.data.title,
    })
    .eq("company_id", context.activeCompany.id)
    .eq("id", jobId.data)
    .select("id")
    .maybeSingle();

  if (error || !updatedJob) {
    redirectWithFeedback("/dashboard/jobs", "error", "Вакансия не найдена или недоступна.");
  }

  revalidatePath("/dashboard/jobs");
  revalidatePath(path);
  redirectWithFeedback(path, "message", "Параметры вакансии обновлены.");
}

export async function updateJobWeightsAction(formData: FormData) {
  const jobId = z.string().uuid().safeParse(formString(formData, "jobId"));

  if (!jobId.success) {
    redirect("/dashboard/jobs");
  }

  const path = getJobPath(jobId.data);
  const context = await requireCompanyContext();

  if (!canManageJobs(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права изменять веса.");
  }

  const weights = parseWeights(formData);
  if (!weights.success) {
    redirectWithFeedback(path, "error", weights.error.issues[0].message);
  }

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("company_id", context.activeCompany.id)
    .eq("id", jobId.data)
    .maybeSingle();

  if (!job) {
    redirectWithFeedback("/dashboard/jobs", "error", "Вакансия не найдена.");
  }

  const { error } = await supabase
    .from("job_competency_weights")
    .upsert(weightsToRows(context.activeCompany.id, jobId.data, weights.data), {
      onConflict: "job_id,competency_key",
    });

  if (error) {
    redirectWithFeedback(path, "error", "Не удалось обновить веса компетенций.");
  }

  revalidatePath(path);
  redirectWithFeedback(path, "message", "Веса компетенций обновлены.");
}
