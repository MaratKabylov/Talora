"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireCompanyContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

import { canManageAssessmentPackages } from "./constants";

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

const packageSchema = z.object({
  description: optionalText(2000),
  title: z
    .string()
    .trim()
    .min(2, "Укажите название пакета оценки.")
    .max(180, "Название слишком длинное."),
});

const packageTestSchema = z.object({
  isRequired: z.boolean(),
  orderIndex: z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text ? Number(text) : Number.NaN;
    },
    z.number().int("Порядок должен быть целым числом.").min(0, "Порядок не может быть меньше 0."),
  ),
  passingScore: optionalPercentage,
  testVersionId: z.string().uuid(),
  weightPercent: z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim().replace(",", ".") : "";
      return text ? Number(text) : Number.NaN;
    },
    z
      .number()
      .min(0, "Вес теста не может быть меньше 0.")
      .max(100, "Вес теста не может быть больше 100."),
  ),
});

const packageTestsSchema = z.array(packageTestSchema).superRefine((tests, context) => {
  if (tests.length === 0) {
    context.addIssue({
      code: "custom",
      message: "Добавьте хотя бы один опубликованный тест в пакет.",
    });
    return;
  }

  const sum = tests.reduce((total, test) => total + test.weightPercent, 0);
  if (Math.abs(sum - 100) > 0.01) {
    context.addIssue({
      code: "custom",
      message: `Сумма весов тестов должна быть 100%. Сейчас: ${sum.toLocaleString("ru-RU")}%.`,
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

function packagePath(packageId: string) {
  return `/dashboard/packages/${packageId}`;
}

function parsePackage(formData: FormData) {
  return packageSchema.safeParse({
    description: formString(formData, "description"),
    title: formString(formData, "title"),
  });
}

function parsePackageTests(formData: FormData) {
  const versionIds = formData
    .getAll("testVersionId")
    .filter((value): value is string => typeof value === "string");

  return packageTestsSchema.safeParse(
    versionIds
      .filter((versionId) => formData.get(`include_${versionId}`) === "on")
      .map((versionId) => ({
        isRequired: formData.get(`required_${versionId}`) === "on",
        orderIndex: formString(formData, `order_${versionId}`),
        passingScore: formString(formData, `passing_${versionId}`),
        testVersionId: versionId,
        weightPercent: formString(formData, `weight_${versionId}`),
      })),
  );
}

function toRpcRows(tests: z.infer<typeof packageTestsSchema>) {
  return tests.map((test) => ({
    is_required: test.isRequired,
    order_index: test.orderIndex,
    passing_score: test.passingScore,
    test_version_id: test.testVersionId,
    weight: test.weightPercent / 100,
  }));
}

function packageTestErrorMessage(message: string) {
  if (message.includes("sum to 100")) {
    return "Сумма весов тестов должна быть 100%.";
  }

  if (message.includes("at least one test")) {
    return "Добавьте хотя бы один опубликованный тест в пакет.";
  }

  if (message.includes("unavailable") || message.includes("not available")) {
    return "В пакете есть тест, который недоступен этой компании или не опубликован.";
  }

  return "Не удалось сохранить состав пакета оценки.";
}

async function requirePackageManager(path: string) {
  const context = await requireCompanyContext();

  if (!canManageAssessmentPackages(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права управлять пакетами оценки.");
  }

  return context;
}

export async function createAssessmentPackageAction(formData: FormData) {
  const path = "/dashboard/packages/new";
  const context = await requirePackageManager(path);
  const assessmentPackage = parsePackage(formData);
  const tests = parsePackageTests(formData);

  if (!assessmentPackage.success) {
    redirectWithFeedback(path, "error", assessmentPackage.error.issues[0].message);
  }

  if (!tests.success) {
    redirectWithFeedback(path, "error", tests.error.issues[0].message);
  }

  const supabase = await createClient();
  const { data: createdPackage, error: packageError } = await supabase
    .from("assessment_packages")
    .insert({
      company_id: context.activeCompany.id,
      created_by: context.user.id,
      description: assessmentPackage.data.description,
      is_system: false,
      title: assessmentPackage.data.title,
    })
    .select("id")
    .single();

  if (packageError || !createdPackage) {
    redirectWithFeedback(path, "error", "Не удалось создать пакет оценки.");
  }

  const { error: testsError } = await supabase.rpc("replace_assessment_package_tests", {
    package_tests: toRpcRows(tests.data),
    target_package_id: createdPackage.id,
  });

  if (testsError) {
    await supabase
      .from("assessment_packages")
      .delete()
      .eq("company_id", context.activeCompany.id)
      .eq("id", createdPackage.id)
      .eq("is_system", false);
    redirectWithFeedback(path, "error", packageTestErrorMessage(testsError.message));
  }

  revalidatePath("/dashboard/packages");
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/employee-assessments");
  redirectWithFeedback(packagePath(createdPackage.id), "message", "Пакет оценки создан.");
}

export async function updateAssessmentPackageAction(formData: FormData) {
  const packageId = z.string().uuid().safeParse(formString(formData, "packageId"));

  if (!packageId.success) {
    redirect("/dashboard/packages");
  }

  const path = packagePath(packageId.data);
  const context = await requirePackageManager(path);
  const assessmentPackage = parsePackage(formData);

  if (!assessmentPackage.success) {
    redirectWithFeedback(path, "error", assessmentPackage.error.issues[0].message);
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessment_packages")
    .update({
      description: assessmentPackage.data.description,
      title: assessmentPackage.data.title,
    })
    .eq("company_id", context.activeCompany.id)
    .eq("id", packageId.data)
    .eq("is_system", false)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirectWithFeedback("/dashboard/packages", "error", "Пакет оценки не найден или недоступен.");
  }

  revalidatePath("/dashboard/packages");
  revalidatePath(path);
  redirectWithFeedback(path, "message", "Пакет оценки обновлен.");
}

export async function updateAssessmentPackageTestsAction(formData: FormData) {
  const packageId = z.string().uuid().safeParse(formString(formData, "packageId"));

  if (!packageId.success) {
    redirect("/dashboard/packages");
  }

  const path = packagePath(packageId.data);
  await requirePackageManager(path);
  const tests = parsePackageTests(formData);

  if (!tests.success) {
    redirectWithFeedback(path, "error", tests.error.issues[0].message);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("replace_assessment_package_tests", {
    package_tests: toRpcRows(tests.data),
    target_package_id: packageId.data,
  });

  if (error) {
    redirectWithFeedback(path, "error", packageTestErrorMessage(error.message));
  }

  revalidatePath("/dashboard/packages");
  revalidatePath(path);
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/employee-assessments");
  redirectWithFeedback(path, "message", "Состав пакета оценки обновлен.");
}

export async function deleteAssessmentPackageAction(formData: FormData) {
  const packageId = z.string().uuid().safeParse(formString(formData, "packageId"));

  if (!packageId.success) {
    redirect("/dashboard/packages");
  }

  const path = packagePath(packageId.data);
  const context = await requirePackageManager(path);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessment_packages")
    .delete()
    .eq("company_id", context.activeCompany.id)
    .eq("id", packageId.data)
    .eq("is_system", false)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirectWithFeedback(
      path,
      "error",
      "Не удалось удалить пакет. Проверьте, что он не назначен вакансиям или оценкам сотрудников.",
    );
  }

  revalidatePath("/dashboard/packages");
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/employee-assessments");
  redirectWithFeedback("/dashboard/packages", "message", "Пакет оценки удален.");
}
