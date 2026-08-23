"use server";

import { revalidatePath } from "next/cache";

import { requireCompanyContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { canManageTests } from "@/lib/tests/constants";
import {
  getTalviaTestImportWarnings,
  TALVIA_TEST_IMPORT_MAX_FILE_SIZE,
} from "@/lib/tests/import-parser";
import {
  parseTalviaTestImportAny,
  summarizeTalviaTestImportAny,
} from "@/lib/tests/import-parser-v2";
import type {
  TalviaTestImportPreviewState,
  TalviaTestImportResult,
} from "@/lib/tests/import-types";
import { canCreateCompanyTests } from "@/lib/tests/permissions";

type ImportRpcRecord = {
  created_template_id: string | null;
  created_version_id: string | null;
};

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

async function getImportContext() {
  const context = await requireCompanyContext();
  const mayImport =
    canManageTests(context.activeCompany.role) &&
    (await canCreateCompanyTests(context.activeCompany.id));

  return { context, mayImport };
}

function rpcErrorMessage(message: string) {
  if (message.includes("Could not find the function") || message.includes("schema cache")) {
    return "Импорт тестов еще не настроен в базе данных. Примените последнюю миграцию Supabase.";
  }
  if (message.includes("Company cannot create custom tests")) {
    return "Для этой компании не включено создание пользовательских тестов.";
  }
  if (message.includes("Importer cannot manage this company")) {
    return "У вашей учетной записи нет права импортировать тесты для активной компании.";
  }
  if (message.includes("Invalid Talvia test import document")) {
    return "Данные предпросмотра повреждены. Загрузите и проверьте JSON-файл заново.";
  }

  return "Не удалось импортировать тест. Данные не были записаны; повторите попытку.";
}

export async function previewTalviaTestImportAction(
  _previousState: TalviaTestImportPreviewState,
  formData: FormData,
): Promise<TalviaTestImportPreviewState> {
  const fileValue = formData.get("file");
  if (!(fileValue instanceof File) || fileValue.size === 0) {
    return { error: "Выберите JSON-файл теста.", status: "error" };
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

  const { mayImport } = await getImportContext();
  if (!mayImport) {
    return { error: "У вас нет права импортировать пользовательские тесты.", status: "error" };
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(await fileValue.arrayBuffer());
  } catch {
    return { error: "Файл должен быть сохранен в кодировке UTF-8.", status: "error" };
  }

  try {
    const document = parseTalviaTestImportAny(source);
    const summary = summarizeTalviaTestImportAny(document);
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

export async function confirmTalviaTestImportAction(
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
    document = parseTalviaTestImportAny(normalizedDocument);
  } catch {
    return {
      error: "Данные предпросмотра повреждены. Загрузите и проверьте JSON-файл заново.",
      status: "error",
    };
  }

  const { context, mayImport } = await getImportContext();
  if (!mayImport) {
    return { error: "У вас нет права импортировать пользовательские тесты.", status: "error" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    document.schema_version === "talvia.test.v2"
      ? "import_company_test_v2"
      : "import_company_test_v1",
    {
      import_document: document,
      target_company_id: context.activeCompany.id,
      target_created_by: context.user.id,
    },
  );

  if (error) {
    return { error: rpcErrorMessage(error.message), status: "error" };
  }

  const record = ((data ?? []) as ImportRpcRecord[])[0];
  if (!record?.created_template_id || !record.created_version_id) {
    return {
      error: "База данных не вернула созданный тест. Проверьте журнал Supabase.",
      status: "error",
    };
  }

  revalidatePath("/dashboard/tests");
  revalidatePath(`/dashboard/tests/${record.created_template_id}`);

  return {
    status: "success",
    templateId: record.created_template_id,
    title: document.test.title,
    versionId: record.created_version_id,
    versionNumber: 1,
  };
}
