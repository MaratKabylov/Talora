import "server-only";

import ExcelJS from "exceljs";
import { z } from "zod";

import type {
  CandidateImportCandidate,
  CandidateImportPreviewRow,
} from "@/lib/candidates/import-types";

const IMPORT_HEADERS = ["ФИО", "Email", "Телефон", "Город", "Источник"] as const;
const IMPORT_ROW_LIMIT = 100;

const optionalText = (maximum: number, fieldName: string) =>
  z
    .string()
    .trim()
    .max(maximum, `${fieldName}: значение слишком длинное.`)
    .nullable()
    .transform((value) => value || null);

export const candidateImportCandidateSchema = z.object({
  city: optionalText(120, "Город"),
  email: z
    .string()
    .trim()
    .email("Укажите корректный email.")
    .max(255, "Email: значение слишком длинное.")
    .transform((value) => value.toLowerCase()),
  fullName: z
    .string()
    .trim()
    .min(2, "ФИО должно содержать минимум 2 символа.")
    .max(180, "ФИО: значение слишком длинное."),
  phone: optionalText(40, "Телефон"),
  rowNumber: z.number().int().min(2),
  source: optionalText(120, "Источник"),
});

export const candidateImportCandidatesSchema = z
  .array(candidateImportCandidateSchema)
  .min(1, "Нет строк для импорта.")
  .max(IMPORT_ROW_LIMIT, `За один раз можно импортировать не более ${IMPORT_ROW_LIMIT} кандидатов.`);

type CellText = {
  containsFormula: boolean;
  text: string;
};

function readCell(cell: ExcelJS.Cell): CellText {
  const value = cell.value;
  const containsFormula =
    typeof value === "object" &&
    value !== null &&
    ("formula" in value || "sharedFormula" in value);

  return {
    containsFormula,
    text: cell.text.trim(),
  };
}

function normalizeHeader(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru-RU");
}

function issueMessages(error: z.ZodError) {
  return Array.from(new Set(error.issues.map((issue) => issue.message)));
}

export async function parseCandidateImportWorkbook(file: File): Promise<CandidateImportPreviewRow[]> {
  const workbook = new ExcelJS.Workbook();

  try {
    const bytes = await file.arrayBuffer();
    await workbook.xlsx.load(bytes);
  } catch {
    throw new Error("Не удалось прочитать Excel-файл. Проверьте, что это корректный файл .xlsx.");
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("В Excel-файле нет листов.");
  }
  if (worksheet.rowCount > 1002 || worksheet.columnCount > 50) {
    throw new Error("Excel-файл содержит слишком большую рабочую область. Используйте шаблон Talvia без лишних строк и столбцов.");
  }

  const headerIndexes = new Map<string, number>();
  for (let columnIndex = 1; columnIndex <= Math.max(worksheet.columnCount, IMPORT_HEADERS.length); columnIndex += 1) {
    const header = readCell(worksheet.getCell(1, columnIndex));
    if (header.containsFormula) {
      throw new Error("Заголовки Excel-файла не должны содержать формулы.");
    }

    const normalized = normalizeHeader(header.text);
    if (normalized) {
      if (headerIndexes.has(normalized)) {
        throw new Error(`Заголовок «${header.text}» указан несколько раз.`);
      }
      headerIndexes.set(normalized, columnIndex);
    }
  }

  const missingHeaders = IMPORT_HEADERS.filter(
    (header) => !headerIndexes.has(normalizeHeader(header)),
  );
  if (missingHeaders.length > 0) {
    throw new Error(`В файле отсутствуют столбцы: ${missingHeaders.join(", ")}.`);
  }

  const columnIndex = (header: (typeof IMPORT_HEADERS)[number]) =>
    headerIndexes.get(normalizeHeader(header))!;
  const parsedRows: CandidateImportPreviewRow[] = [];
  const seenEmails = new Set<string>();

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const cells = {
      city: readCell(worksheet.getCell(rowNumber, columnIndex("Город"))),
      email: readCell(worksheet.getCell(rowNumber, columnIndex("Email"))),
      fullName: readCell(worksheet.getCell(rowNumber, columnIndex("ФИО"))),
      phone: readCell(worksheet.getCell(rowNumber, columnIndex("Телефон"))),
      source: readCell(worksheet.getCell(rowNumber, columnIndex("Источник"))),
    };
    const values = Object.values(cells).map((cell) => cell.text);

    if (values.every((value) => !value)) {
      continue;
    }

    if (parsedRows.length >= IMPORT_ROW_LIMIT) {
      throw new Error(`В файле больше ${IMPORT_ROW_LIMIT} заполненных строк. Разделите импорт на несколько файлов.`);
    }

    const rawCandidate: CandidateImportCandidate = {
      city: cells.city.text || null,
      email: cells.email.text,
      fullName: cells.fullName.text,
      phone: cells.phone.text || null,
      rowNumber,
      source: cells.source.text || null,
    };
    const formulaIssue = Object.values(cells).some((cell) => cell.containsFormula)
      ? ["Формулы не поддерживаются. Замените их обычными значениями."]
      : [];
    const validation = candidateImportCandidateSchema.safeParse(rawCandidate);

    if (!validation.success) {
      parsedRows.push({
        ...rawCandidate,
        issues: [...formulaIssue, ...issueMessages(validation.error)],
        status: "error",
      });
      continue;
    }

    if (formulaIssue.length > 0) {
      parsedRows.push({ ...rawCandidate, issues: formulaIssue, status: "error" });
      continue;
    }

    const candidate = validation.data as CandidateImportCandidate;
    if (seenEmails.has(candidate.email)) {
      parsedRows.push({
        ...candidate,
        issues: ["Повтор email внутри файла. Будет обработана только первая строка."],
        status: "skipped",
      });
      continue;
    }

    seenEmails.add(candidate.email);
    parsedRows.push({ ...candidate, issues: [], status: "ready" });
  }

  if (parsedRows.length === 0) {
    throw new Error("В Excel-файле нет заполненных строк с кандидатами.");
  }

  return parsedRows;
}

export async function createCandidateImportTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Talvia";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.subject = "Шаблон массового импорта кандидатов";
  workbook.title = "Импорт кандидатов Talvia";

  const candidates = workbook.addWorksheet("Кандидаты", {
    views: [{ showGridLines: false, state: "frozen", ySplit: 1 }],
  });
  candidates.addRow([...IMPORT_HEADERS]);
  candidates.autoFilter = "A1:E1";
  candidates.columns = [
    { key: "fullName", width: 30 },
    { key: "email", width: 34 },
    { key: "phone", width: 22 },
    { key: "city", width: 20 },
    { key: "source", width: 26 },
  ];

  const header = candidates.getRow(1);
  header.height = 26;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { horizontal: "left", vertical: "middle" };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } };
  header.border = {
    bottom: { color: { argb: "FF1E40AF" }, style: "medium" },
  };

  const instructions = workbook.addWorksheet("Инструкция", {
    views: [{ showGridLines: false }],
  });
  instructions.columns = [{ width: 28 }, { width: 78 }];
  instructions.addRows([
    ["Массовый импорт кандидатов", "Talvia"],
    ["Как заполнить", "Вносите кандидатов на листе «Кандидаты», начиная со второй строки."],
    ["Обязательные поля", "ФИО и Email."],
    ["Необязательные поля", "Телефон, Город и Источник."],
    ["Ограничение", "Не более 100 заполненных строк за один импорт."],
    ["Дубли", "Повторные email и кандидаты, уже добавленные в вакансию, будут пропущены."],
    ["Важно", "Не меняйте названия столбцов и не используйте формулы."],
  ]);
  instructions.getRow(1).height = 30;
  instructions.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
  instructions.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF1D4ED8" },
  };
  instructions.getColumn(1).font = { bold: true };
  instructions.getRows(2, 6)?.forEach((row) => {
    row.height = 32;
    row.alignment = { vertical: "middle", wrapText: true };
    row.border = {
      bottom: { color: { argb: "FFE2E8F0" }, style: "thin" },
    };
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
