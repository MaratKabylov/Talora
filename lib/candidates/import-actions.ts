"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireCompanyContext } from "@/lib/auth/context";
import { canManageCandidates } from "@/lib/candidates/constants";
import {
  candidateImportCandidatesSchema,
  parseCandidateImportWorkbook,
} from "@/lib/candidates/import-workbook";
import type {
  CandidateImportPreviewState,
  CandidateImportResult,
  CandidateImportResultRow,
} from "@/lib/candidates/import-types";
import { createClient } from "@/lib/supabase/server";

const MAX_IMPORT_FILE_SIZE = 1024 * 1024;
const jobIdSchema = z.string().uuid();
const expirationSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

type ExistingApplicationRecord = {
  candidates: { email: string | null } | { email: string | null }[] | null;
};

type BulkImportRecord = {
  candidate_email: string | null;
  detail: string | null;
  outcome: string | null;
  row_number: number | null;
};

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function getExpiration(value: string) {
  const parsed = expirationSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  const date = new Date(`${parsed.data}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) || date.getTime() <= Date.now() ? null : date;
}

function relatedEmail(record: ExistingApplicationRecord) {
  const candidate = Array.isArray(record.candidates) ? record.candidates[0] : record.candidates;
  return candidate?.email?.trim().toLowerCase() ?? null;
}

function rpcErrorMessage(message: string) {
  if (message.includes("Could not find the function") || message.includes("schema cache")) {
    return "Массовый импорт не настроен в базе. Примените последнюю миграцию Supabase.";
  }
  if (message.includes("User cannot invite candidates")) {
    return "У вашей роли нет права импортировать кандидатов.";
  }
  if (message.includes("Job is unavailable")) {
    return "Назначьте вакансии доступный пакет оценки и убедитесь, что вакансия не закрыта.";
  }
  if (message.includes("cannot exceed 100 rows")) {
    return "За один раз можно импортировать не более 100 кандидатов.";
  }

  return "Не удалось завершить массовый импорт. Проверьте файл и повторите попытку.";
}

function resultMessage(detail: string | null) {
  const messages: Record<string, string> = {
    already_in_job: "Кандидат уже добавлен в эту вакансию.",
    concurrent_duplicate: "Кандидат был добавлен другим запросом и пропущен.",
    duplicate_in_file: "Повтор email внутри файла.",
    field_too_long: "Одно из полей превышает допустимую длину.",
    invalid_email: "Некорректный email.",
    invalid_full_name: "Некорректное ФИО.",
    invalid_row_number: "Некорректный номер строки.",
    invitation_created: "Кандидат и ссылка-приглашение созданы.",
    unexpected_error: "Строку не удалось импортировать.",
  };

  return detail ? messages[detail] ?? "Строка обработана." : "Строка обработана.";
}

export async function previewCandidateImportAction(
  _previousState: CandidateImportPreviewState,
  formData: FormData,
): Promise<CandidateImportPreviewState> {
  const jobId = jobIdSchema.safeParse(formString(formData, "jobId"));
  const expiresAtValue = formString(formData, "expiresAt");
  const expiration = getExpiration(expiresAtValue);
  const fileValue = formData.get("file");

  if (!jobId.success) {
    return { status: "error", error: "Вакансия указана некорректно." };
  }
  if (!expiration) {
    return { status: "error", error: "Укажите будущую дату окончания приглашений." };
  }
  if (!(fileValue instanceof File) || fileValue.size === 0) {
    return { status: "error", error: "Выберите Excel-файл для импорта." };
  }
  if (!fileValue.name.toLowerCase().endsWith(".xlsx")) {
    return { status: "error", error: "Поддерживаются только файлы Excel в формате .xlsx." };
  }
  if (fileValue.size > MAX_IMPORT_FILE_SIZE) {
    return { status: "error", error: "Размер Excel-файла не должен превышать 1 МБ." };
  }

  const context = await requireCompanyContext();
  if (!canManageCandidates(context.activeCompany.role)) {
    return { status: "error", error: "У вашей роли нет права импортировать кандидатов." };
  }

  const supabase = await createClient();
  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id, status, assessment_package_id")
    .eq("company_id", context.activeCompany.id)
    .eq("id", jobId.data)
    .maybeSingle();

  if (jobError || !job) {
    return { status: "error", error: "Вакансия недоступна." };
  }
  if (!job.assessment_package_id) {
    return { status: "error", error: "Сначала назначьте вакансии пакет оценки." };
  }
  if (job.status === "closed" || job.status === "archived") {
    return { status: "error", error: "В закрытую или архивную вакансию импорт недоступен." };
  }

  try {
    const rows = await parseCandidateImportWorkbook(fileValue);
    const { data: existingApplications, error: applicationsError } = await supabase
      .from("candidate_applications")
      .select("candidates(email)")
      .eq("company_id", context.activeCompany.id)
      .eq("job_id", jobId.data);

    if (applicationsError) {
      return { status: "error", error: "Не удалось проверить кандидатов этой вакансии." };
    }

    const existingEmails = new Set(
      ((existingApplications ?? []) as unknown as ExistingApplicationRecord[])
        .map(relatedEmail)
        .filter((email): email is string => Boolean(email)),
    );
    const checkedRows = rows.map((row) =>
      row.status === "ready" && existingEmails.has(row.email)
        ? {
            ...row,
            issues: ["Кандидат уже добавлен в эту вакансию."],
            status: "skipped" as const,
          }
        : row,
    );

    return {
      errorCount: checkedRows.filter((row) => row.status === "error").length,
      expiresAt: expiresAtValue,
      fileName: fileValue.name,
      readyCount: checkedRows.filter((row) => row.status === "ready").length,
      rows: checkedRows,
      skippedCount: checkedRows.filter((row) => row.status === "skipped").length,
      status: "ready",
    };
  } catch (error) {
    return {
      status: "error",
      error: error instanceof Error ? error.message : "Не удалось обработать Excel-файл.",
    };
  }
}

export async function confirmCandidateImportAction(formData: FormData): Promise<CandidateImportResult> {
  const jobId = jobIdSchema.safeParse(formString(formData, "jobId"));
  const expiration = getExpiration(formString(formData, "expiresAt"));
  let rawRows: unknown;

  try {
    rawRows = JSON.parse(formString(formData, "rows"));
  } catch {
    return { status: "error", error: "Данные предварительного просмотра повреждены. Загрузите файл заново." };
  }

  const rows = candidateImportCandidatesSchema.safeParse(rawRows);
  if (!jobId.success || !expiration || !rows.success) {
    return { status: "error", error: "Проверьте данные импорта и загрузите Excel-файл заново." };
  }

  const context = await requireCompanyContext();
  if (!canManageCandidates(context.activeCompany.role)) {
    return { status: "error", error: "У вашей роли нет права импортировать кандидатов." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_invite_candidates_to_job", {
    candidate_rows: rows.data,
    invitation_expires_at: expiration.toISOString(),
    target_company_id: context.activeCompany.id,
    target_job_id: jobId.data,
  });

  if (error) {
    return { status: "error", error: rpcErrorMessage(error.message) };
  }

  const resultRows: CandidateImportResultRow[] = ((data ?? []) as BulkImportRecord[]).map((row) => {
    const outcome =
      row.outcome === "imported" || row.outcome === "skipped" ? row.outcome : "error";

    return {
      email: row.candidate_email ?? "Email не указан",
      message: resultMessage(row.detail),
      outcome,
      rowNumber: row.row_number ?? 0,
    };
  });

  revalidatePath(`/dashboard/jobs/${jobId.data}/candidates`);
  revalidatePath("/dashboard/candidates");

  return {
    errorCount: resultRows.filter((row) => row.outcome === "error").length,
    importedCount: resultRows.filter((row) => row.outcome === "imported").length,
    rows: resultRows,
    skippedCount: resultRows.filter((row) => row.outcome === "skipped").length,
    status: "success",
  };
}
