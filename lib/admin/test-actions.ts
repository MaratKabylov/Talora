"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  DIFFICULTY_VALUES,
  QUESTION_TYPE_VALUES,
  TEST_COMPETENCIES,
  type TestCompetencyKey,
} from "@/lib/tests/builder-constants";
import type { BuilderSaveResult } from "@/lib/tests/builder-actions";
import { SCORING_TYPE_VALUES, TEST_TEMPLATE_STATUS_VALUES } from "@/lib/tests/constants";
import { formatTestVersionTitle } from "@/lib/tests/version-title";

import { canManageSystemTests } from "./constants";
import { requirePlatformContext, type PlatformContext } from "./context";
import { recordPlatformAudit } from "./data";

const competencyKeys = TEST_COMPETENCIES.map((competency) => competency.key) as [
  TestCompetencyKey,
  ...TestCompetencyKey[],
];

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

const documentOptionSchema = z.object({
  competencyEffects: z.record(z.string(), z.number().min(-10000).max(10000)),
  explanation: z.string().max(1000).nullable(),
  id: z.string().uuid(),
  isCorrect: z.boolean(),
  points: z.number().min(0).max(10000),
  text: z.string().trim().min(1).max(1000),
});

const documentQuestionSchema = z
  .object({
    competencyKey: z.enum(competencyKeys).nullable(),
    description: z.string().max(2000).nullable(),
    difficulty: z.enum(DIFFICULTY_VALUES).nullable(),
    id: z.string().uuid(),
    isRequired: z.boolean(),
    options: z.array(documentOptionSchema).max(100),
    points: z.number().min(0).max(10000),
    questionType: z.enum(QUESTION_TYPE_VALUES),
    scaleMax: z.number().int().min(2).max(100),
    scaleMin: z.number().int().min(1).max(99),
    text: z.string().trim().min(2).max(4000),
  })
  .refine(
    (question) => question.questionType !== "scale" || question.scaleMin < question.scaleMax,
    "Максимум шкалы должен быть больше минимума.",
  );

const builderDocumentSchema = z.object({
  sections: z
    .array(
      z.object({
        description: z.string().max(1000).nullable(),
        id: z.string().uuid(),
        questions: z.array(documentQuestionSchema).max(300),
        timeLimitMinutes: z.number().int().min(1).max(1440).nullable(),
        title: z.string().trim().min(2).max(180),
      }),
    )
    .max(100),
  templateId: z.string().uuid(),
  version: z.object({
    description: z.string().max(2000).nullable(),
    durationMinutes: z.number().int().min(1).max(1440).nullable(),
    instructions: z.string().max(4000).nullable(),
    scoringType: z.enum(SCORING_TYPE_VALUES),
    title: z.string().trim().min(2).max(180),
  }),
  versionId: z.string().uuid(),
});

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function parseId(formData: FormData, name: string) {
  return z.string().uuid().safeParse(formString(formData, name));
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

function getTestPath(templateId: string) {
  return `/admin/tests/${templateId}`;
}

function getBuilderPath(templateId: string, versionId: string) {
  return `/admin/tests/${templateId}/builder?version=${versionId}`;
}

function redirectWithFeedback(path: string, type: "error" | "message", text: string): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}${new URLSearchParams({ [type]: text }).toString()}`);
}

function revalidateSystemTestPaths(templateId: string) {
  revalidatePath("/admin/tests");
  revalidatePath(getTestPath(templateId));
  revalidatePath(`/admin/tests/${templateId}/builder`);
  revalidatePath("/dashboard/tests");
}

async function requireSystemTestManager(path: string) {
  const context = await requirePlatformContext();
  if (!canManageSystemTests(context.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права управлять системными тестами.");
  }
  return { admin: createAdminClient(), context };
}

async function findEditableSystemTemplate(
  admin: ReturnType<typeof createAdminClient>,
  templateId: string,
) {
  const { data, error } = await admin
    .from("test_templates")
    .select("id, status")
    .eq("id", templateId)
    .eq("is_system", true)
    .is("company_id", null)
    .maybeSingle();

  return error ? null : data;
}

async function auditSystemVersion(
  context: PlatformContext,
  action: string,
  versionId: string,
  templateId: string,
) {
  await recordPlatformAudit(context, action, "test_version", versionId, null, null, {
    testTemplateId: templateId,
  });
}

export async function createSystemTestTemplateAction(formData: FormData) {
  const path = "/admin/tests/new";
  const { admin, context } = await requireSystemTestManager(path);
  const template = parseTemplate(formData);
  const version = parseVersion(formData);

  if (!template.success) {
    redirectWithFeedback(path, "error", template.error.issues[0].message);
  }
  if (!version.success) {
    redirectWithFeedback(path, "error", version.error.issues[0].message);
  }

  const { data: createdTemplate, error: templateError } = await admin
    .from("test_templates")
    .insert({
      category: template.data.category,
      company_id: null,
      created_by: context.user.id,
      description: template.data.description,
      is_system: true,
      status: "active",
      title: template.data.title,
    })
    .select("id")
    .single();

  if (templateError || !createdTemplate) {
    redirectWithFeedback(path, "error", "Не удалось создать системный тест.");
  }

  const versionNumber = 1;
  const { data: createdVersion, error: versionError } = await admin
    .from("test_versions")
    .insert({
      description: version.data.description,
      duration_minutes: version.data.durationMinutes,
      instructions: version.data.instructions,
      scoring_type: version.data.scoringType,
      status: "draft",
      test_template_id: createdTemplate.id,
      title: formatTestVersionTitle(versionNumber),
      version_number: versionNumber,
    })
    .select("id")
    .single();

  if (versionError || !createdVersion) {
    await admin.from("test_templates").update({ status: "archived" }).eq("id", createdTemplate.id);
    redirectWithFeedback(path, "error", "Не удалось создать черновую версию системного теста.");
  }

  await recordPlatformAudit(context, "create_system_test", "test_template", createdTemplate.id);
  await auditSystemVersion(context, "create_system_test_version", createdVersion.id, createdTemplate.id);
  revalidateSystemTestPaths(createdTemplate.id);
  redirectWithFeedback(getTestPath(createdTemplate.id), "message", "Системный тест и первая версия созданы.");
}

export async function updateSystemTestTemplateAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");
  if (!templateId.success) {
    redirect("/admin/tests");
  }

  const path = getTestPath(templateId.data);
  const { admin, context } = await requireSystemTestManager(path);
  const template = parseTemplate(formData);
  if (!template.success) {
    redirectWithFeedback(path, "error", template.error.issues[0].message);
  }

  const { data, error } = await admin
    .from("test_templates")
    .update({
      category: template.data.category,
      description: template.data.description,
      title: template.data.title,
    })
    .eq("id", templateId.data)
    .eq("is_system", true)
    .is("company_id", null)
    .eq("status", "active")
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirectWithFeedback(path, "error", "Изменять можно только активный системный тест.");
  }

  await recordPlatformAudit(context, "update_system_test", "test_template", templateId.data);
  revalidateSystemTestPaths(templateId.data);
  redirectWithFeedback(path, "message", "Карточка системного теста обновлена.");
}

export async function setSystemTestTemplateStatusAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");
  const status = z.enum(TEST_TEMPLATE_STATUS_VALUES).safeParse(formString(formData, "status"));
  if (!templateId.success || !status.success) {
    redirect("/admin/tests");
  }

  const path = getTestPath(templateId.data);
  const { admin, context } = await requireSystemTestManager(path);
  const { data, error } = await admin
    .from("test_templates")
    .update({ status: status.data })
    .eq("id", templateId.data)
    .eq("is_system", true)
    .is("company_id", null)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirectWithFeedback(path, "error", "Системный тест не найден.");
  }

  await recordPlatformAudit(
    context,
    status.data === "archived" ? "archive_system_test" : "activate_system_test",
    "test_template",
    templateId.data,
  );
  revalidateSystemTestPaths(templateId.data);
  redirectWithFeedback(
    path,
    "message",
    status.data === "archived" ? "Системный тест перемещен в архив." : "Системный тест активирован.",
  );
}

export async function createSystemTestVersionAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");
  if (!templateId.success) {
    redirect("/admin/tests");
  }

  const path = getTestPath(templateId.data);
  const { admin, context } = await requireSystemTestManager(path);
  const version = parseVersion(formData);
  if (!version.success) {
    redirectWithFeedback(path, "error", version.error.issues[0].message);
  }

  const template = await findEditableSystemTemplate(admin, templateId.data);
  if (!template || template.status !== "active") {
    redirectWithFeedback(path, "error", "Версии можно создавать только для активного системного теста.");
  }

  const [{ data: existingDraft }, { data: latestVersion, error: versionLookupError }] =
    await Promise.all([
      admin
        .from("test_versions")
        .select("id")
        .eq("test_template_id", templateId.data)
        .eq("status", "draft")
        .limit(1)
        .maybeSingle(),
      admin
        .from("test_versions")
        .select("version_number")
        .eq("test_template_id", templateId.data)
        .order("version_number", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (existingDraft) {
    redirectWithFeedback(path, "error", "Сначала завершите существующий черновик.");
  }
  if (versionLookupError) {
    redirectWithFeedback(path, "error", "Не удалось определить номер новой версии.");
  }

  const nextVersionNumber = (latestVersion?.version_number ?? 0) + 1;
  const { data: createdVersion, error } = await admin
    .from("test_versions")
    .insert({
      description: version.data.description,
      duration_minutes: version.data.durationMinutes,
      instructions: version.data.instructions,
      scoring_type: version.data.scoringType,
      status: "draft",
      test_template_id: templateId.data,
      title: formatTestVersionTitle(nextVersionNumber),
      version_number: nextVersionNumber,
    })
    .select("id")
    .single();

  if (error || !createdVersion) {
    redirectWithFeedback(path, "error", "Не удалось создать новую версию.");
  }

  await auditSystemVersion(context, "create_system_test_version", createdVersion.id, templateId.data);
  revalidateSystemTestPaths(templateId.data);
  redirectWithFeedback(path, "message", "Новая черновая версия создана.");
}

export async function updateSystemTestVersionAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");
  const versionId = parseId(formData, "versionId");
  if (!templateId.success || !versionId.success) {
    redirect("/admin/tests");
  }

  const path = getTestPath(templateId.data);
  const { admin, context } = await requireSystemTestManager(path);
  const version = parseVersion(formData);
  if (!version.success) {
    redirectWithFeedback(path, "error", version.error.issues[0].message);
  }

  const template = await findEditableSystemTemplate(admin, templateId.data);
  if (!template || template.status !== "active") {
    redirectWithFeedback(path, "error", "Черновики можно изменять только в активном системном тесте.");
  }

  const { data: draftVersion, error: draftLookupError } = await admin
    .from("test_versions")
    .select("id, version_number")
    .eq("id", versionId.data)
    .eq("test_template_id", templateId.data)
    .eq("status", "draft")
    .maybeSingle();

  if (draftLookupError || !draftVersion) {
    redirectWithFeedback(path, "error", "Изменять можно только черновую версию.");
  }

  const { data, error } = await admin
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

  if (error || !data) {
    redirectWithFeedback(path, "error", "Изменять можно только черновую версию.");
  }

  await auditSystemVersion(context, "update_system_test_version", versionId.data, templateId.data);
  revalidateSystemTestPaths(templateId.data);
  redirectWithFeedback(path, "message", "Черновая версия обновлена.");
}

export async function archiveSystemTestDraftVersionAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");
  const versionId = parseId(formData, "versionId");
  if (!templateId.success || !versionId.success) {
    redirect("/admin/tests");
  }

  const path = getTestPath(templateId.data);
  const { admin, context } = await requireSystemTestManager(path);
  const template = await findEditableSystemTemplate(admin, templateId.data);
  if (!template || template.status !== "active") {
    redirectWithFeedback(path, "error", "Черновики можно архивировать только в активном системном тесте.");
  }

  const { data, error } = await admin
    .from("test_versions")
    .update({ status: "archived" })
    .eq("id", versionId.data)
    .eq("test_template_id", templateId.data)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error || !data) {
    redirectWithFeedback(path, "error", "Архивировать можно только черновую версию.");
  }

  await auditSystemVersion(context, "archive_system_test_version", versionId.data, templateId.data);
  revalidateSystemTestPaths(templateId.data);
  redirectWithFeedback(path, "message", "Черновая версия перемещена в архив.");
}

export async function publishSystemTestVersionAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");
  const versionId = parseId(formData, "versionId");
  if (!templateId.success || !versionId.success) {
    redirect("/admin/tests");
  }

  const path = getTestPath(templateId.data);
  const { admin, context } = await requireSystemTestManager(path);
  const template = await findEditableSystemTemplate(admin, templateId.data);
  if (!template || template.status !== "active") {
    redirectWithFeedback(path, "error", "Публиковать версии можно только в активном системном тесте.");
  }

  const { data: draftVersion, error: draftLookupError } = await admin
    .from("test_versions")
    .select("id, version_number")
    .eq("id", versionId.data)
    .eq("test_template_id", templateId.data)
    .eq("status", "draft")
    .maybeSingle();

  if (draftLookupError || !draftVersion) {
    redirectWithFeedback(path, "error", "Опубликовать можно только черновую версию.");
  }

  const { data, error } = await admin
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

  if (error || !data) {
    redirectWithFeedback(path, "error", "Опубликовать можно только черновую версию.");
  }

  await auditSystemVersion(context, "publish_system_test_version", versionId.data, templateId.data);
  revalidateSystemTestPaths(templateId.data);
  redirectWithFeedback(path, "message", "Версия опубликована и теперь доступна компаниям только для чтения.");
}

type CloneSection = {
  description: string | null;
  order_index: number;
  questions?: Array<{
    answer_options?: Array<{
      competency_effect_json: Record<string, number>;
      explanation: string | null;
      is_correct: boolean | null;
      order_index: number;
      points: number;
      text: string;
    }> | null;
    competency_key: string | null;
    description: string | null;
    difficulty: string | null;
    media_url: string | null;
    order_index: number;
    points: number;
    question_type: string;
    settings_json: Record<string, unknown>;
    text: string;
  }> | null;
  settings_json: Record<string, unknown>;
  time_limit_minutes: number | null;
  title: string;
};

export async function createSystemDraftFromPublishedVersionAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");
  const versionId = parseId(formData, "versionId");
  if (!templateId.success || !versionId.success) {
    redirect("/admin/tests");
  }

  const sourcePath = getBuilderPath(templateId.data, versionId.data);
  const { admin, context } = await requireSystemTestManager(sourcePath);
  const template = await findEditableSystemTemplate(admin, templateId.data);
  if (!template || template.status !== "active") {
    redirectWithFeedback(sourcePath, "error", "Новая версия доступна только для активного системного теста.");
  }

  const { data: existingDraft } = await admin
    .from("test_versions")
    .select("id")
    .eq("test_template_id", templateId.data)
    .eq("status", "draft")
    .limit(1)
    .maybeSingle();
  if (existingDraft) {
    redirectWithFeedback(
      getBuilderPath(templateId.data, existingDraft.id),
      "message",
      "Открыт уже существующий черновик.",
    );
  }

  const [{ data: source }, { data: latest }] = await Promise.all([
    admin
      .from("test_versions")
      .select("description, instructions, duration_minutes, scoring_type, settings_json")
      .eq("id", versionId.data)
      .eq("test_template_id", templateId.data)
      .eq("status", "published")
      .maybeSingle(),
    admin
      .from("test_versions")
      .select("version_number")
      .eq("test_template_id", templateId.data)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!source) {
    redirectWithFeedback(sourcePath, "error", "Копировать можно только опубликованную версию.");
  }

  const nextVersionNumber = (latest?.version_number ?? 0) + 1;
  const { data: draft, error: draftError } = await admin
    .from("test_versions")
    .insert({
      description: source.description,
      duration_minutes: source.duration_minutes,
      instructions: source.instructions,
      scoring_type: source.scoring_type,
      settings_json: source.settings_json,
      status: "draft",
      test_template_id: templateId.data,
      title: formatTestVersionTitle(nextVersionNumber),
      version_number: nextVersionNumber,
    })
    .select("id")
    .single();
  if (draftError || !draft) {
    redirectWithFeedback(sourcePath, "error", "Не удалось создать черновую версию.");
  }

  const { data: sourceSections, error: contentError } = await admin
    .from("test_sections")
    .select(
      "title, description, order_index, time_limit_minutes, settings_json, questions(question_type, text, description, media_url, order_index, points, competency_key, difficulty, settings_json, answer_options(text, order_index, is_correct, points, competency_effect_json, explanation))",
    )
    .eq("test_version_id", versionId.data)
    .order("order_index");

  if (contentError) {
    await admin.from("test_versions").delete().eq("id", draft.id).eq("status", "draft");
    redirectWithFeedback(sourcePath, "error", "Не удалось скопировать содержание опубликованной версии.");
  }

  for (const section of (sourceSections ?? []) as unknown as CloneSection[]) {
    const { data: copiedSection, error: sectionError } = await admin
      .from("test_sections")
      .insert({
        description: section.description,
        order_index: section.order_index,
        settings_json: section.settings_json,
        test_version_id: draft.id,
        time_limit_minutes: section.time_limit_minutes,
        title: section.title,
      })
      .select("id")
      .single();
    if (sectionError || !copiedSection) {
      await admin.from("test_versions").delete().eq("id", draft.id).eq("status", "draft");
      redirectWithFeedback(sourcePath, "error", "Не удалось скопировать секции версии.");
    }

    for (const question of section.questions ?? []) {
      const { data: copiedQuestion, error: questionError } = await admin
        .from("questions")
        .insert({
          competency_key: question.competency_key,
          description: question.description,
          difficulty: question.difficulty,
          media_url: question.media_url,
          order_index: question.order_index,
          points: question.points,
          question_type: question.question_type,
          section_id: copiedSection.id,
          settings_json: question.settings_json,
          text: question.text,
        })
        .select("id")
        .single();
      if (questionError || !copiedQuestion) {
        await admin.from("test_versions").delete().eq("id", draft.id).eq("status", "draft");
        redirectWithFeedback(sourcePath, "error", "Не удалось скопировать вопросы версии.");
      }

      if (question.answer_options?.length) {
        const { error: optionsError } = await admin.from("answer_options").insert(
          question.answer_options.map((option) => ({
            competency_effect_json: option.competency_effect_json,
            explanation: option.explanation,
            is_correct: option.is_correct,
            order_index: option.order_index,
            points: option.points,
            question_id: copiedQuestion.id,
            text: option.text,
          })),
        );
        if (optionsError) {
          await admin.from("test_versions").delete().eq("id", draft.id).eq("status", "draft");
          redirectWithFeedback(sourcePath, "error", "Не удалось скопировать варианты ответов версии.");
        }
      }
    }
  }

  await auditSystemVersion(context, "create_system_test_draft_from_published", draft.id, templateId.data);
  revalidateSystemTestPaths(templateId.data);
  redirectWithFeedback(
    getBuilderPath(templateId.data, draft.id),
    "message",
    "Создан новый черновик на основе опубликованной версии.",
  );
}

async function getSystemDocumentContext(templateId: string, versionId: string) {
  const context = await requirePlatformContext();
  if (!canManageSystemTests(context.role)) {
    return null;
  }

  const admin = createAdminClient();
  const { data: version } = await admin
    .from("test_versions")
    .select("id, version_number, test_templates!inner(id, company_id, is_system, status)")
    .eq("id", versionId)
    .eq("test_template_id", templateId)
    .eq("status", "draft")
    .eq("test_templates.is_system", true)
    .is("test_templates.company_id", null)
    .eq("test_templates.status", "active")
    .maybeSingle();

  return version ? { admin, context, versionNumber: version.version_number } : null;
}

export async function saveSystemTestBuilderDocumentAction(input: unknown): Promise<BuilderSaveResult> {
  const parsed = builderDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте заполнение конструктора.", ok: false };
  }

  const document = parsed.data;
  const actionContext = await getSystemDocumentContext(document.templateId, document.versionId);
  if (!actionContext) {
    return { error: "Редактировать можно только активную черновую системную версию.", ok: false };
  }

  const { admin, context } = actionContext;
  const { data: currentSections, error: currentError } = await admin
    .from("test_sections")
    .select("id, questions(id, answer_options(id))")
    .eq("test_version_id", document.versionId);
  if (currentError) {
    return { error: "Не удалось проверить текущее содержание.", ok: false };
  }

  const sectionIds = document.sections.map((section) => section.id);
  const questionIds = document.sections.flatMap((section) =>
    section.questions.map((question) => question.id),
  );
  const optionIds = document.sections.flatMap((section) =>
    section.questions.flatMap((question) => question.options.map((option) => option.id)),
  );
  if (
    new Set(sectionIds).size !== sectionIds.length ||
    new Set(questionIds).size !== questionIds.length ||
    new Set(optionIds).size !== optionIds.length
  ) {
    return { error: "Содержание содержит повторяющиеся идентификаторы.", ok: false };
  }

  type StoredSection = {
    id: string;
    questions?: Array<{ answer_options?: Array<{ id: string }> | null; id: string }> | null;
  };
  const storedSections = (currentSections ?? []) as unknown as StoredSection[];
  const storedSectionIds = new Set(storedSections.map((section) => section.id));
  const storedQuestionIds = new Set(
    storedSections.flatMap((section) => (section.questions ?? []).map((question) => question.id)),
  );
  const storedOptionIds = new Set(
    storedSections.flatMap((section) =>
      (section.questions ?? []).flatMap((question) =>
        (question.answer_options ?? []).map((option) => option.id),
      ),
    ),
  );
  const newSectionIds = sectionIds.filter((id) => !storedSectionIds.has(id));
  const newQuestionIds = questionIds.filter((id) => !storedQuestionIds.has(id));
  const newOptionIds = optionIds.filter((id) => !storedOptionIds.has(id));
  const [sectionConflicts, questionConflicts, optionConflicts] = await Promise.all([
    newSectionIds.length
      ? admin.from("test_sections").select("id").in("id", newSectionIds)
      : Promise.resolve({ data: [], error: null }),
    newQuestionIds.length
      ? admin.from("questions").select("id").in("id", newQuestionIds)
      : Promise.resolve({ data: [], error: null }),
    newOptionIds.length
      ? admin.from("answer_options").select("id").in("id", newOptionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (sectionConflicts.error || questionConflicts.error || optionConflicts.error) {
    return { error: "Не удалось проверить новые элементы конструктора.", ok: false };
  }
  if (sectionConflicts.data.length || questionConflicts.data.length || optionConflicts.data.length) {
    return { error: "Один из элементов конструктора уже относится к другой версии.", ok: false };
  }

  const nextSectionIds = new Set(sectionIds);
  const nextQuestionIds = new Set(questionIds);
  const nextOptionIds = new Set(optionIds);
  const removedOptionIds = storedSections.flatMap((section) =>
    (section.questions ?? []).flatMap((question) =>
      (question.answer_options ?? [])
        .filter((option) => !nextOptionIds.has(option.id))
        .map((option) => option.id),
    ),
  );
  const removedQuestionIds = storedSections.flatMap((section) =>
    (section.questions ?? [])
      .filter((question) => !nextQuestionIds.has(question.id))
      .map((question) => question.id),
  );
  const removedSectionIds = storedSections
    .filter((section) => !nextSectionIds.has(section.id))
    .map((section) => section.id);

  if (removedOptionIds.length > 0) {
    const { error } = await admin.from("answer_options").delete().in("id", removedOptionIds);
    if (error) return { error: "Не удалось удалить варианты ответа.", ok: false };
  }
  if (removedQuestionIds.length > 0) {
    const { error } = await admin.from("questions").delete().in("id", removedQuestionIds);
    if (error) return { error: "Не удалось удалить вопросы.", ok: false };
  }
  if (removedSectionIds.length > 0) {
    const { error } = await admin.from("test_sections").delete().in("id", removedSectionIds);
    if (error) return { error: "Не удалось удалить секции.", ok: false };
  }

  const { error: versionError } = await admin
    .from("test_versions")
    .update({
      description: document.version.description,
      duration_minutes: document.version.durationMinutes,
      instructions: document.version.instructions,
      scoring_type: document.version.scoringType,
      title: formatTestVersionTitle(actionContext.versionNumber),
    })
    .eq("id", document.versionId)
    .eq("status", "draft");
  if (versionError) {
    return { error: "Не удалось сохранить параметры версии.", ok: false };
  }

  if (document.sections.length > 0) {
    const { error } = await admin.from("test_sections").upsert(
      document.sections.map((section, orderIndex) => ({
        description: section.description,
        id: section.id,
        order_index: orderIndex + 1,
        test_version_id: document.versionId,
        time_limit_minutes: section.timeLimitMinutes,
        title: section.title,
      })),
    );
    if (error) return { error: "Не удалось сохранить секции.", ok: false };
  }

  const questions = document.sections.flatMap((section) =>
    section.questions.map((question, orderIndex) => ({
      competency_key: question.competencyKey,
      description: question.description,
      difficulty: question.difficulty,
      id: question.id,
      order_index: orderIndex + 1,
      points: question.points,
      question_type: question.questionType,
      section_id: section.id,
      settings_json: {
        ...(question.questionType === "scale"
          ? { max: question.scaleMax, min: question.scaleMin }
          : {}),
        required: question.isRequired,
      },
      text: question.text,
    })),
  );
  if (questions.length > 0) {
    const { error } = await admin.from("questions").upsert(questions);
    if (error) return { error: "Не удалось сохранить вопросы.", ok: false };
  }

  const options = document.sections.flatMap((section) =>
    section.questions.flatMap((question) =>
      question.options.map((option, orderIndex) => ({
        competency_effect_json: option.competencyEffects,
        explanation: option.explanation,
        id: option.id,
        is_correct: option.isCorrect,
        order_index: orderIndex + 1,
        points: option.points,
        question_id: question.id,
        text: option.text,
      })),
    ),
  );
  if (options.length > 0) {
    const { error } = await admin.from("answer_options").upsert(options);
    if (error) return { error: "Не удалось сохранить варианты ответа.", ok: false };
  }

  await auditSystemVersion(context, "update_system_test_content", document.versionId, document.templateId);
  revalidateSystemTestPaths(document.templateId);
  return { ok: true, savedAt: new Date().toISOString() };
}
