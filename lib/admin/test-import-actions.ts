"use server";

import { revalidatePath } from "next/cache";

import { canManageSystemTests } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getTalviaTestImportWarnings,
  parseTalviaTestImport,
  summarizeTalviaTestImport,
  TALVIA_TEST_IMPORT_MAX_FILE_SIZE,
} from "@/lib/tests/import-parser";
import type {
  TalviaTestImportPreviewState,
  TalviaTestImportResult,
} from "@/lib/tests/import-types";

type ImportRpcRecord = {
  created_template_id: string | null;
  created_version_id: string | null;
};

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function getSystemImportContext() {
  const context = await requirePlatformContext();
  return { context, mayImport: canManageSystemTests(context.role) };
}

function rpcErrorMessage(message: string) {
  if (message.includes("Could not find the function") || message.includes("schema cache")) {
    return "Импорт системных тестов еще не настроен в базе данных. Примените последнюю миграцию Supabase.";
  }
  if (message.includes("Importer cannot manage system tests")) {
    return "У вашей платформенной роли нет права импортировать системные тесты.";
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
    const document = parseTalviaTestImport(source);
    const summary = summarizeTalviaTestImport(document);
    const normalizedDocument = JSON.stringify(document);
    if (new TextEncoder().encode(normalizedDocument).byteLength > TALVIA_TEST_IMPORT_MAX_FILE_SIZE) {
      return {
        error: "После нормализации документ превышает допустимый размер 750 КБ.",
        status: "error",
      };
    }

    return {
      fileName: fileValue.name,
      normalizedDocument,
      status: "ready",
      summary,
      warnings: getTalviaTestImportWarnings(summary),
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
    document = parseTalviaTestImport(normalizedDocument);
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
  const { data, error } = await admin.rpc("import_system_test_v1", {
    import_document: document,
    target_created_by: context.user.id,
  });

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
    title: document.test.title,
    versionId: record.created_version_id,
  };
}
