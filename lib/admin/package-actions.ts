"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { contributingWeightPercent } from "@/lib/packages/overall-contribution";

import { canManageSystemAssessmentPackages } from "./constants";
import { requirePlatformContext } from "./context";
import { recordPlatformAudit } from "./data";

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
    .number({ error: "Введите процент числом." })
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
  contributesToOverall: z.preprocess(
    (value) => (value === "true" ? true : value === "false" ? false : value),
    z.boolean({ error: "Укажите, участвует ли тест в overall." }),
  ),
  isRequired: z.boolean(),
  orderIndex: z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text ? Number(text) : undefined;
    },
    z
      .number({ error: "Укажите порядок теста числом." })
      .int("Порядок должен быть целым числом.")
      .min(0, "Порядок не может быть меньше 0."),
  ),
  passingScore: optionalPercentage,
  testVersionId: z.string().uuid(),
  weightPercent: z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim().replace(",", ".") : "";
      return text ? Number(text) : 0;
    },
    z
      .number({ error: "Укажите вес теста числом." })
      .min(0, "Вес теста не может быть меньше 0.")
      .max(100, "Вес теста не может быть больше 100."),
  ),
});

const packageTestsSchema = z.array(packageTestSchema).superRefine((tests, context) => {
  if (tests.length === 0) {
    context.addIssue({
      code: "custom",
      message: "Добавьте хотя бы один опубликованный системный тест в пакет.",
    });
    return;
  }

  const sum = contributingWeightPercent(tests);
  if (Math.abs(sum - 100) > 0.01) {
    context.addIssue({
      code: "custom",
      message: `Сумма весов тестов, участвующих в overall, должна быть 100%. Сейчас: ${sum.toLocaleString("ru-RU")}%.`,
    });
  }
});

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function parseId(formData: FormData, key: string) {
  return z.string().uuid().safeParse(formString(formData, key));
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
        contributesToOverall: formString(formData, `overall_${versionId}`),
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
    contributes_to_overall: test.contributesToOverall,
    is_required: test.isRequired,
    order_index: test.orderIndex,
    passing_score: test.passingScore,
    test_version_id: test.testVersionId,
    weight: test.contributesToOverall ? test.weightPercent / 100 : 0,
  }));
}

function systemPackagePath(packageId: string) {
  return `/admin/packages/${packageId}`;
}

function redirectWithFeedback(path: string, type: "error" | "message", message: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${new URLSearchParams({ [type]: message }).toString()}`);
}

function packageTestsErrorMessage(message: string) {
  if (message.includes("sum to 100")) {
    return "Сумма весов тестов, участвующих в overall, должна быть 100%.";
  }
  if (message.includes("at least one test")) {
    return "Добавьте хотя бы один опубликованный системный тест в пакет.";
  }
  if (message.includes("multiple versions")) {
    return "В пакет можно добавить только одну версию каждого системного теста.";
  }
  if (message.includes("unavailable") || message.includes("invalid system test")) {
    return "В пакете есть неактивный, неопубликованный или недоступный системный тест.";
  }
  return "Не удалось сохранить состав системного пакета оценки.";
}

function revalidateSystemPackagePaths(packageId?: string) {
  revalidatePath("/admin/packages");
  if (packageId) {
    revalidatePath(systemPackagePath(packageId));
  }
  revalidatePath("/dashboard/packages");
  revalidatePath("/dashboard/jobs");
  revalidatePath("/dashboard/employee-assessments");
}

async function requireSystemPackageManager(path: string) {
  const context = await requirePlatformContext();
  if (!canManageSystemAssessmentPackages(context.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права управлять системными пакетами оценки.");
  }
  return { admin: createAdminClient(), context };
}

export async function createSystemAssessmentPackageAction(formData: FormData) {
  const path = "/admin/packages/new";
  const { admin, context } = await requireSystemPackageManager(path);
  const assessmentPackage = parsePackage(formData);
  const tests = parsePackageTests(formData);

  if (!assessmentPackage.success) {
    redirectWithFeedback(path, "error", assessmentPackage.error.issues[0].message);
  }
  if (!tests.success) {
    redirectWithFeedback(path, "error", tests.error.issues[0].message);
  }

  const { data: createdPackage, error: packageError } = await admin
    .from("assessment_packages")
    .insert({
      company_id: null,
      created_by: context.user.id,
      description: assessmentPackage.data.description,
      is_system: true,
      title: assessmentPackage.data.title,
    })
    .select("id")
    .single();

  if (packageError || !createdPackage) {
    redirectWithFeedback(path, "error", "Не удалось создать системный пакет оценки.");
  }

  const { error: testsError } = await admin.rpc("replace_system_assessment_package_tests", {
    package_tests: toRpcRows(tests.data),
    target_package_id: createdPackage.id,
  });

  if (testsError) {
    await admin.from("assessment_packages").delete().eq("id", createdPackage.id);
    redirectWithFeedback(path, "error", packageTestsErrorMessage(testsError.message));
  }

  await recordPlatformAudit(
    context,
    "create_system_assessment_package",
    "assessment_package",
    createdPackage.id,
    null,
    null,
    { testCount: tests.data.length },
  );
  revalidateSystemPackagePaths(createdPackage.id);
  redirectWithFeedback(
    systemPackagePath(createdPackage.id),
    "message",
    "Системный пакет оценки создан.",
  );
}

export async function updateSystemAssessmentPackageAction(formData: FormData) {
  const packageId = parseId(formData, "packageId");
  if (!packageId.success) {
    redirect("/admin/packages");
  }

  const path = systemPackagePath(packageId.data);
  const { admin, context } = await requireSystemPackageManager(path);
  const assessmentPackage = parsePackage(formData);
  if (!assessmentPackage.success) {
    redirectWithFeedback(path, "error", assessmentPackage.error.issues[0].message);
  }

  const { data, error } = await admin
    .from("assessment_packages")
    .update({
      description: assessmentPackage.data.description,
      title: assessmentPackage.data.title,
    })
    .eq("id", packageId.data)
    .eq("is_system", true)
    .is("company_id", null)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirectWithFeedback(path, "error", "Системный пакет оценки не найден.");
  }

  await recordPlatformAudit(
    context,
    "update_system_assessment_package",
    "assessment_package",
    packageId.data,
  );
  revalidateSystemPackagePaths(packageId.data);
  redirectWithFeedback(path, "message", "Карточка системного пакета обновлена.");
}

export async function updateSystemAssessmentPackageTestsAction(formData: FormData) {
  const packageId = parseId(formData, "packageId");
  if (!packageId.success) {
    redirect("/admin/packages");
  }

  const path = systemPackagePath(packageId.data);
  const { admin, context } = await requireSystemPackageManager(path);
  const tests = parsePackageTests(formData);
  if (!tests.success) {
    redirectWithFeedback(path, "error", tests.error.issues[0].message);
  }

  const { error } = await admin.rpc("replace_system_assessment_package_tests", {
    package_tests: toRpcRows(tests.data),
    target_package_id: packageId.data,
  });

  if (error) {
    redirectWithFeedback(path, "error", packageTestsErrorMessage(error.message));
  }

  await recordPlatformAudit(
    context,
    "update_system_assessment_package_tests",
    "assessment_package",
    packageId.data,
    null,
    null,
    { testCount: tests.data.length },
  );
  revalidateSystemPackagePaths(packageId.data);
  redirectWithFeedback(path, "message", "Состав системного пакета обновлен.");
}
