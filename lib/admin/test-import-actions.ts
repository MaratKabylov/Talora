"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canManageSystemTests } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getTalviaTestImportWarnings,
  TALVIA_TEST_IMPORT_MAX_FILE_SIZE,
} from "@/lib/tests/import-parser";
import {
  parseTalviaTestImportAny,
  summarizeTalviaTestImportAny,
} from "@/lib/tests/import-parser-v2";
import type {
  SystemTestImportTarget,
  TalviaTestImportPreviewState,
  TalviaTestImportResult,
} from "@/lib/tests/import-types";

type ImportRpcRecord = {
  created_template_id: string | null;
  created_version_id: string | null;
};

type SystemTemplateRecord = {
  category: string | null;
  id: string;
  status: string;
  test_versions?: Array<{ status: string; version_number: number }> | null;
  title: string;
};

const templateIdSchema = z.string().uuid();

type SystemImportTargetResult =
  | { error: string; ok: false }
  | { ok: true; target: SystemTestImportTarget };

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function getSystemImportContext() {
  const context = await requirePlatformContext();
  return { context, mayImport: canManageSystemTests(context.role) };
}

async function getSystemImportTarget(
  admin: ReturnType<typeof createAdminClient>,
  templateId: string,
  documentCategory: string,
): Promise<SystemImportTargetResult> {
  const { data, error } = await admin
    .from("test_templates")
    .select("id, title, category, status, test_versions(status, version_number)")
    .eq("id", templateId)
    .eq("is_system", true)
    .is("company_id", null)
    .maybeSingle();

  if (error || !data) {
    return { error: "Выбранный системный тест не найден.", ok: false };
  }

  const template = data as unknown as SystemTemplateRecord;
  if (template.status !== "active") {
    return { error: "Добавлять версии можно только в активный системный тест.", ok: false };
  }
  if ((template.test_versions ?? []).some((version) => version.status === "draft")) {
    return { error: "У выбранного системного теста уже есть черновик.", ok: false };
  }
  if (template.category !== documentCategory) {
    return {
      error: `Категория файла «${documentCategory}» не совпадает с категорией выбранного теста «${template.category ?? "не указана"}».`,
      ok: false,
    };
  }

  const latestVersionNumber = Math.max(
    0,
    ...(template.test_versions ?? []).map((version) => version.version_number),
  );
  return {
    ok: true,
    target: {
      nextVersionNumber: latestVersionNumber + 1,
      templateId: template.id,
      title: template.title,
    },
  };
}

function rpcErrorMessage(message: string) {
  if (message.includes("Could not find the function") || message.includes("schema cache")) {
    return "Импорт системных тестов еще не настроен в базе данных. Примените последнюю миграцию Supabase.";
  }
  if (message.includes("Importer cannot manage system tests")) {
    return "У вашей платформенной роли нет права импортировать системные тесты.";
  }
  if (message.includes("System test already has a draft")) {
    return "У выбранного системного теста уже есть черновик. Завершите или архивируйте его перед импортом.";
  }
  if (message.includes("System test target is unavailable")) {
    return "Выбранный системный тест не найден или неактивен.";
  }
  if (message.includes("Import category does not match system test")) {
    return "Категория файла не совпадает с категорией выбранного системного теста.";
  }
  if (message.includes("Invalid Talvia test import document")) {
    return "Данные предпросмотра повреждены. Загрузите и проверьте JSON-файл заново.";
  }

  return "Не удалось импортировать системный тест. Данные не были записаны; повторите попытку.";
}

export async function previewSystemTestImportAction(
  _previousState: TalviaTestImportPreviewState,
  formData: FormData,
): Promise<TalviaTestImportPreviewState> {
  const templateId = templateIdSchema.safeParse(formString(formData, "templateId"));
  if (!templateId.success) {
    return { error: "Выберите системный тест для новой версии.", status: "error" };
  }

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File) || fileValue.size === 0) {
    return { error: "Выберите JSON-файл системного теста.", status: "error" };
  }
  if (!fileValue.name.toLowerCase().endsWith(".json")) {
    return { error: "Поддерживаются только файлы с расширением .json.", status: "error" };
  }
  if (fileValue.size > TALVIA_TEST_IMPORT_MAX_FILE_SIZE) {
    return {
      error: `Размер JSON-файла не должен превышать ${Math.floor(TALVIA_TEST_IMPORT_MAX_FILE_SIZE / 1024)} КБ.`,
      status: "error",
    };
  }

  const { mayImport } = await getSystemImportContext();
  if (!mayImport) {
    return {
      error: "У вашей платформенной роли нет права импортировать системные тесты.",
      status: "error",
    };
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(await fileValue.arrayBuffer());
  } catch {
    return { error: "Файл должен быть сохранен в кодировке UTF-8.", status: "error" };
  }

  try {
    const document = parseTalviaTestImportAny(source);
    const admin = createAdminClient();
    const targetResult = await getSystemImportTarget(
      admin,
      templateId.data,
      document.test.category,
    );
    if (!targetResult.ok) {
      return { error: targetResult.error, status: "error" };
    }

    const summary = summarizeTalviaTestImportAny(document);
    const normalizedDocument = JSON.stringify(document);
    if (new TextEncoder().encode(normalizedDocument).byteLength > TALVIA_TEST_IMPORT_MAX_FILE_SIZE) {
      return {
        error: "После нормализации документ превышает допустимый размер 750 КБ.",
        status: "error",
      };
    }

    const warnings = getTalviaTestImportWarnings(summary);
    if (document.test.title !== targetResult.target.title) {
      warnings.unshift(
        `Название файла «${document.test.title}» отличается от шаблона «${targetResult.target.title}». Название шаблона не изменится.`,
      );
    }

    return {
      fileName: fileValue.name,
      normalizedDocument,
      status: "ready",
      summary,
      target: targetResult.target,
      warnings,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Не удалось проверить JSON-файл.",
      status: "error",
    };
  }
}

export async function confirmSystemTestImportAction(
  formData: FormData,
): Promise<TalviaTestImportResult> {
  const templateId = templateIdSchema.safeParse(formString(formData, "templateId"));
  if (!templateId.success) {
    return { error: "Выберите системный тест и проверьте файл заново.", status: "error" };
  }

  const normalizedDocument = formString(formData, "document");
  if (
    !normalizedDocument ||
    new TextEncoder().encode(normalizedDocument).byteLength > TALVIA_TEST_IMPORT_MAX_FILE_SIZE
  ) {
    return {
      error: "Данные предпросмотра отсутствуют или слишком велики. Загрузите файл заново.",
      status: "error",
    };
  }

  let document;
  try {
    document = parseTalviaTestImportAny(normalizedDocument);
  } catch {
    return {
      error: "Данные предпросмотра повреждены. Загрузите и проверьте JSON-файл заново.",
      status: "error",
    };
  }

  const { context, mayImport } = await getSystemImportContext();
  if (!mayImport) {
    return {
      error: "У вашей платформенной роли нет права импортировать системные тесты.",
      status: "error",
    };
  }

  const admin = createAdminClient();
  const targetResult = await getSystemImportTarget(
    admin,
    templateId.data,
    document.test.category,
  );
  if (!targetResult.ok) {
    return { error: targetResult.error, status: "error" };
  }

  const { data, error } = await admin.rpc(
    document.schema_version === "talvia.test.v2"
      ? "import_system_test_v2"
      : "import_system_test_v1",
    {
      import_document: document,
      target_created_by: context.user.id,
      target_template_id: targetResult.target.templateId,
    },
  );

  if (error) {
    return { error: rpcErrorMessage(error.message), status: "error" };
  }

  const record = ((data ?? []) as ImportRpcRecord[])[0];
  if (!record?.created_template_id || !record.created_version_id) {
    return {
      error: "База данных не вернула созданный системный тест. Проверьте журнал Supabase.",
      status: "error",
    };
  }

  revalidatePath("/admin/tests");
  revalidatePath(`/admin/tests/${record.created_template_id}`);
  revalidatePath(`/admin/tests/${record.created_template_id}/builder`);
  revalidatePath("/admin/audit");

  return {
    status: "success",
    templateId: record.created_template_id,
    title: targetResult.target.title,
    versionId: record.created_version_id,
    versionNumber: targetResult.target.nextVersionNumber,
  };
}
