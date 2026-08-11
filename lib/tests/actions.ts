"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireCompanyContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

import { canManageTests, SCORING_TYPE_VALUES, TEST_TEMPLATE_STATUS_VALUES } from "./constants";
import { canCreateCompanyTests } from "./permissions";
import { formatTestVersionTitle } from "./version-title";

const optionalText = (maximum: number) =>
  z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text || null;
    },
    z.string().max(maximum, "Значение слишком длинное.").nullable(),
  );

const optionalDuration = z.preprocess(
  (value) => {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? Number(text) : null;
  },
  z
    .number()
    .int("Длительность должна быть указана в целых минутах.")
    .min(1, "Длительность должна быть больше нуля.")
    .max(1440, "Длительность слишком велика.")
    .nullable(),
);

const templateSchema = z.object({
  category: optionalText(100),
  description: optionalText(2000),
  title: z.string().trim().min(2, "Укажите название теста.").max(180, "Название слишком длинное."),
});

const versionSchema = z.object({
  description: optionalText(2000),
  durationMinutes: optionalDuration,
  instructions: optionalText(4000),
  scoringType: z.enum(SCORING_TYPE_VALUES),
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

function getTestPath(templateId: string) {
  return `/dashboard/tests/${templateId}`;
}

function parseTemplate(formData: FormData) {
  return templateSchema.safeParse({
    category: formString(formData, "category"),
    description: formString(formData, "templateDescription"),
    title: formString(formData, "templateTitle"),
  });
}

function parseVersion(formData: FormData) {
  return versionSchema.safeParse({
    description: formString(formData, "versionDescription"),
    durationMinutes: formString(formData, "durationMinutes"),
    instructions: formString(formData, "instructions"),
    scoringType: formString(formData, "scoringType"),
  });
}

function parseId(formData: FormData, name: string) {
  return z.string().uuid().safeParse(formString(formData, name));
}

async function findEditableTemplate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  templateId: string,
) {
  const { data, error } = await supabase
    .from("test_templates")
    .select("id, status")
    .eq("id", templateId)
    .eq("company_id", companyId)
    .eq("is_system", false)
    .maybeSingle();

  return error ? null : data;
}

export async function createTestTemplateAction(formData: FormData) {
  const context = await requireCompanyContext();
  const path = "/dashboard/tests/new";

  if (!canManageTests(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права создавать тесты.");
  }

  if (!(await canCreateCompanyTests(context.activeCompany.id))) {
    redirectWithFeedback(path, "error", "Создание тестов для компании не включено. Доступ назначается в админ-панели.");
  }

  const template = parseTemplate(formData);
  const version = parseVersion(formData);

  if (!template.success) {
    redirectWithFeedback(path, "error", template.error.issues[0].message);
  }

  if (!version.success) {
    redirectWithFeedback(path, "error", version.error.issues[0].message);
  }

  const supabase = await createClient();
  const { data: createdTemplate, error: templateError } = await supabase
    .from("test_templates")
    .insert({
      category: template.data.category,
      company_id: context.activeCompany.id,
      created_by: context.user.id,
      description: template.data.description,
      is_system: false,
      status: "active",
      title: template.data.title,
    })
    .select("id")
    .single();

  if (templateError || !createdTemplate) {
    redirectWithFeedback(path, "error", "Не удалось создать тест.");
  }

  const versionNumber = 1;
  const { error: versionError } = await supabase.from("test_versions").insert({
    description: version.data.description,
    duration_minutes: version.data.durationMinutes,
    instructions: version.data.instructions,
    scoring_type: version.data.scoringType,
    status: "draft",
    test_template_id: createdTemplate.id,
    title: formatTestVersionTitle(versionNumber),
    version_number: versionNumber,
  });

  if (versionError) {
    await supabase
      .from("test_templates")
      .update({ status: "archived" })
      .eq("company_id", context.activeCompany.id)
      .eq("id", createdTemplate.id)
      .eq("is_system", false);
    await supabase
      .from("test_templates")
      .delete()
      .eq("company_id", context.activeCompany.id)
      .eq("id", createdTemplate.id)
      .eq("is_system", false);
    redirectWithFeedback(path, "error", "Не удалось создать черновую версию теста.");
  }

  revalidatePath("/dashboard/tests");
  redirectWithFeedback(getTestPath(createdTemplate.id), "message", "Тест и первая версия созданы.");
}

export async function updateTestTemplateAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");

  if (!templateId.success) {
    redirect("/dashboard/tests");
  }

  const context = await requireCompanyContext();
  const path = getTestPath(templateId.data);

  if (!canManageTests(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права изменять тесты.");
  }

  const template = parseTemplate(formData);
  if (!template.success) {
    redirectWithFeedback(path, "error", template.error.issues[0].message);
  }

  const supabase = await createClient();
  const { data: updatedTemplate, error } = await supabase
    .from("test_templates")
    .update({
      category: template.data.category,
      description: template.data.description,
      title: template.data.title,
    })
    .eq("company_id", context.activeCompany.id)
    .eq("id", templateId.data)
    .eq("is_system", false)
    .select("id")
    .maybeSingle();

  if (error || !updatedTemplate) {
    redirectWithFeedback("/dashboard/tests", "error", "Тест не найден или недоступен.");
  }

  revalidatePath("/dashboard/tests");
  revalidatePath(path);
  redirectWithFeedback(path, "message", "Карточка теста обновлена.");
}

export async function setTestTemplateStatusAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");
  const status = z.enum(TEST_TEMPLATE_STATUS_VALUES).safeParse(formString(formData, "status"));

  if (!templateId.success || !status.success) {
    redirect("/dashboard/tests");
  }

  const context = await requireCompanyContext();
  const path = getTestPath(templateId.data);

  if (!canManageTests(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права изменять тесты.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("test_templates")
    .update({ status: status.data })
    .eq("company_id", context.activeCompany.id)
    .eq("id", templateId.data)
    .eq("is_system", false)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirectWithFeedback("/dashboard/tests", "error", "Тест не найден или недоступен.");
  }

  revalidatePath("/dashboard/tests");
  revalidatePath(path);
  redirectWithFeedback(
    path,
    "message",
    status.data === "archived" ? "Тест перемещен в архив." : "Тест восстановлен из архива.",
  );
}

export async function deleteArchivedTestTemplateAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");

  if (!templateId.success) {
    redirect("/dashboard/tests");
  }

  const context = await requireCompanyContext();
  const path = getTestPath(templateId.data);

  if (!canManageTests(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права удалять тесты.");
  }

  const supabase = await createClient();
  const { data: template, error: templateError } = await supabase
    .from("test_templates")
    .select("id")
    .eq("company_id", context.activeCompany.id)
    .eq("id", templateId.data)
    .eq("is_system", false)
    .eq("status", "archived")
    .maybeSingle();

  if (templateError || !template) {
    redirectWithFeedback(path, "error", "Удалять можно только архивные тесты компании.");
  }

  const { data: publishedVersion, error: versionError } = await supabase
    .from("test_versions")
    .select("id")
    .eq("test_template_id", templateId.data)
    .eq("status", "published")
    .limit(1)
    .maybeSingle();

  if (versionError) {
    redirectWithFeedback(path, "error", "Не удалось проверить версии теста.");
  }

  if (publishedVersion) {
    redirectWithFeedback(
      path,
      "error",
      "Тест с опубликованной версией нельзя удалить: версия нужна для истории оценок.",
    );
  }

  const { data: deletedTemplate, error } = await supabase
    .from("test_templates")
    .delete()
    .eq("company_id", context.activeCompany.id)
    .eq("id", templateId.data)
    .eq("is_system", false)
    .eq("status", "archived")
    .select("id")
    .maybeSingle();

  if (error || !deletedTemplate) {
    redirectWithFeedback(
      path,
      "error",
      "Не удалось удалить тест. Проверьте, что его версии не используются в пакете оценки.",
    );
  }

  revalidatePath("/dashboard/tests");
  redirectWithFeedback("/dashboard/tests", "message", "Архивный тест удален.");
}

export async function createTestVersionAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");

  if (!templateId.success) {
    redirect("/dashboard/tests");
  }

  const context = await requireCompanyContext();
  const path = getTestPath(templateId.data);

  if (!canManageTests(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права создавать версии теста.");
  }

  const version = parseVersion(formData);
  if (!version.success) {
    redirectWithFeedback(path, "error", version.error.issues[0].message);
  }

  const supabase = await createClient();
  const template = await findEditableTemplate(supabase, context.activeCompany.id, templateId.data);

  if (!template || template.status !== "active") {
    redirectWithFeedback(path, "error", "Версии можно создавать только для активного теста компании.");
  }

  const [{ data: existingDraft }, { data: latestVersion, error: versionLookupError }] =
    await Promise.all([
      supabase
        .from("test_versions")
        .select("id")
        .eq("test_template_id", templateId.data)
        .eq("status", "draft")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("test_versions")
        .select("version_number")
        .eq("test_template_id", templateId.data)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (existingDraft) {
    redirectWithFeedback(path, "error", "Сначала опубликуйте или доработайте существующий черновик.");
  }

  if (versionLookupError) {
    redirectWithFeedback(path, "error", "Не удалось определить номер новой версии.");
  }

  const nextVersionNumber = (latestVersion?.version_number ?? 0) + 1;
  const { error } = await supabase.from("test_versions").insert({
    description: version.data.description,
    duration_minutes: version.data.durationMinutes,
    instructions: version.data.instructions,
    scoring_type: version.data.scoringType,
    status: "draft",
    test_template_id: templateId.data,
    title: formatTestVersionTitle(nextVersionNumber),
    version_number: nextVersionNumber,
  });

  if (error) {
    redirectWithFeedback(path, "error", "Не удалось создать новую версию.");
  }

  revalidatePath(path);
  revalidatePath("/dashboard/tests");
  redirectWithFeedback(path, "message", "Новая черновая версия создана.");
}

export async function updateTestVersionAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");
  const versionId = parseId(formData, "versionId");

  if (!templateId.success || !versionId.success) {
    redirect("/dashboard/tests");
  }

  const context = await requireCompanyContext();
  const path = getTestPath(templateId.data);

  if (!canManageTests(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права изменять версии теста.");
  }

  const version = parseVersion(formData);
  if (!version.success) {
    redirectWithFeedback(path, "error", version.error.issues[0].message);
  }

  const supabase = await createClient();
  const template = await findEditableTemplate(supabase, context.activeCompany.id, templateId.data);

  if (!template || template.status !== "active") {
    redirectWithFeedback(path, "error", "Черновики можно изменять только в активном тесте компании.");
  }

  const { data: draftVersion, error: draftLookupError } = await supabase
    .from("test_versions")
    .select("id, version_number")
    .eq("id", versionId.data)
    .eq("test_template_id", templateId.data)
    .eq("status", "draft")
    .maybeSingle();

  if (draftLookupError || !draftVersion) {
    redirectWithFeedback(path, "error", "Изменять можно только черновую версию.");
  }

  const { data: updatedVersion, error } = await supabase
    .from("test_versions")
    .update({
      description: version.data.description,
      duration_minutes: version.data.durationMinutes,
      instructions: version.data.instructions,
      scoring_type: version.data.scoringType,
      title: formatTestVersionTitle(draftVersion.version_number),
    })
    .eq("id", versionId.data)
    .eq("test_template_id", templateId.data)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error || !updatedVersion) {
    redirectWithFeedback(path, "error", "Изменять можно только черновую версию.");
  }

  revalidatePath(path);
  revalidatePath("/dashboard/tests");
  redirectWithFeedback(path, "message", "Черновая версия обновлена.");
}

export async function archiveTestDraftVersionAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");
  const versionId = parseId(formData, "versionId");

  if (!templateId.success || !versionId.success) {
    redirect("/dashboard/tests");
  }

  const context = await requireCompanyContext();
  const path = getTestPath(templateId.data);

  if (!canManageTests(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права архивировать версии.");
  }

  const supabase = await createClient();
  const template = await findEditableTemplate(supabase, context.activeCompany.id, templateId.data);

  if (!template || template.status !== "active") {
    redirectWithFeedback(path, "error", "Черновики можно архивировать только в активном тесте компании.");
  }

  const { data: archivedVersion, error } = await supabase
    .from("test_versions")
    .update({ status: "archived" })
    .eq("id", versionId.data)
    .eq("test_template_id", templateId.data)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error || !archivedVersion) {
    redirectWithFeedback(path, "error", "Архивировать можно только черновую версию.");
  }

  revalidatePath(path);
  revalidatePath("/dashboard/tests");
  redirectWithFeedback(path, "message", "Черновая версия перемещена в архив.");
}

export async function publishTestVersionAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");
  const versionId = parseId(formData, "versionId");

  if (!templateId.success || !versionId.success) {
    redirect("/dashboard/tests");
  }

  const context = await requireCompanyContext();
  const path = getTestPath(templateId.data);

  if (!canManageTests(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права публиковать версии.");
  }

  const supabase = await createClient();
  const template = await findEditableTemplate(supabase, context.activeCompany.id, templateId.data);

  if (!template || template.status !== "active") {
    redirectWithFeedback(path, "error", "Публиковать версии можно только в активном тесте компании.");
  }

  const { data: draftVersion, error: draftLookupError } = await supabase
    .from("test_versions")
    .select("id, version_number, duration_minutes")
    .eq("id", versionId.data)
    .eq("test_template_id", templateId.data)
    .eq("status", "draft")
    .maybeSingle();

  if (draftLookupError || !draftVersion) {
    redirectWithFeedback(path, "error", "Опубликовать можно только черновую версию.");
  }

  if (!draftVersion.duration_minutes) {
    redirectWithFeedback(path, "error", "Перед публикацией укажите длительность теста.");
  }

  const { data: publishedVersion, error } = await supabase
    .from("test_versions")
    .update({
      published_at: new Date().toISOString(),
      status: "published",
      title: formatTestVersionTitle(draftVersion.version_number),
    })
    .eq("id", versionId.data)
    .eq("test_template_id", templateId.data)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error || !publishedVersion) {
    redirectWithFeedback(path, "error", "Опубликовать можно только черновую версию.");
  }

  revalidatePath(path);
  revalidatePath("/dashboard/tests");
  redirectWithFeedback(path, "message", "Версия опубликована и теперь доступна только для чтения.");
}
