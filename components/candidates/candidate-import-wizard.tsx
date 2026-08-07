"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useMemo, useState, useTransition } from "react";

import {
  confirmCandidateImportAction,
  previewCandidateImportAction,
} from "@/lib/candidates/import-actions";
import type {
  CandidateImportCandidate,
  CandidateImportPreviewState,
  CandidateImportResult,
} from "@/lib/candidates/import-types";
import { cn } from "@/lib/utils";

import { FeedbackMessage } from "@/components/feedback-message";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INITIAL_PREVIEW_STATE: CandidateImportPreviewState = { status: "idle" };

function defaultExpirationDate() {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

function rowStatusLabel(status: "ready" | "skipped" | "error") {
  if (status === "ready") {
    return "Готов";
  }
  if (status === "skipped") {
    return "Пропуск";
  }
  return "Ошибка";
}

function resultStatusLabel(status: "imported" | "skipped" | "error") {
  if (status === "imported") {
    return "Добавлен";
  }
  if (status === "skipped") {
    return "Пропущен";
  }
  return "Ошибка";
}

export function CandidateImportWizard({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [preview, previewAction, isPreviewing] = useActionState(
    previewCandidateImportAction,
    INITIAL_PREVIEW_STATE,
  );
  const [result, setResult] = useState<CandidateImportResult | null>(null);
  const [isImporting, startImport] = useTransition();
  const rowsForImport = useMemo<CandidateImportCandidate[]>(() => {
    if (preview.status !== "ready") {
      return [];
    }

    return preview.rows
      .filter((row) => row.status !== "error")
      .map((row) => ({
        city: row.city,
        email: row.email,
        fullName: row.fullName,
        phone: row.phone,
        rowNumber: row.rowNumber,
        source: row.source,
      }));
  }, [preview]);

  function confirmImport(formData: FormData) {
    setResult(null);
    startImport(async () => {
      const nextResult = await confirmCandidateImportAction(formData);
      setResult(nextResult);
      if (nextResult.status === "success") {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Загрузите Excel-файл</CardTitle>
          <CardDescription>
            Используйте шаблон Talvia. В одном файле допускается не более 100 заполненных строк.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <Link
            className={buttonVariants({ variant: "outline" })}
            download
            href="/api/candidates/import-template"
          >
            Скачать шаблон Excel
          </Link>

          <form action={previewAction} className="space-y-5" onSubmit={() => setResult(null)}>
            <input name="jobId" type="hidden" value={jobId} />
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="candidate-import-file">Файл .xlsx</Label>
                <Input
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  id="candidate-import-file"
                  name="file"
                  onChange={() => setResult(null)}
                  required
                  type="file"
                />
                <p className="text-xs text-muted-foreground">Максимальный размер файла — 1 МБ.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="candidate-import-expiration">Ссылки действуют до</Label>
                <Input
                  defaultValue={defaultExpirationDate()}
                  id="candidate-import-expiration"
                  name="expiresAt"
                  required
                  type="date"
                />
              </div>
            </div>
            <Button disabled={isPreviewing} type="submit">
              {isPreviewing ? "Проверяем файл..." : "Проверить файл"}
            </Button>
          </form>

          {preview.status === "error" ? <FeedbackMessage error={preview.error} /> : null}
        </CardContent>
      </Card>

      {preview.status === "ready" ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Проверьте кандидатов</CardTitle>
            <CardDescription>
              Файл: {preview.fileName}. После подтверждения отклики и ссылки-приглашения создаются сразу.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Готовы к импорту</p>
                <p className="mt-1 text-2xl font-semibold">{preview.readyCount}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Будут пропущены</p>
                <p className="mt-1 text-2xl font-semibold">{preview.skippedCount}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Ошибки в файле</p>
                <p className="mt-1 text-2xl font-semibold">{preview.errorCount}</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Строка</th>
                    <th className="px-4 py-3 font-medium">ФИО</th>
                    <th className="px-4 py-3 font-medium">Email</th>
                    <th className="px-4 py-3 font-medium">Телефон</th>
                    <th className="px-4 py-3 font-medium">Город</th>
                    <th className="px-4 py-3 font-medium">Источник</th>
                    <th className="px-4 py-3 font-medium">Проверка</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr className="border-t align-top" key={row.rowNumber}>
                      <td className="px-4 py-3">{row.rowNumber}</td>
                      <td className="px-4 py-3 font-medium">{row.fullName || "—"}</td>
                      <td className="px-4 py-3">{row.email || "—"}</td>
                      <td className="px-4 py-3">{row.phone ?? "—"}</td>
                      <td className="px-4 py-3">{row.city ?? "—"}</td>
                      <td className="px-4 py-3">{row.source ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "font-medium",
                            row.status === "ready" && "text-green-700",
                            row.status === "skipped" && "text-amber-700",
                            row.status === "error" && "text-destructive",
                          )}
                        >
                          {rowStatusLabel(row.status)}
                        </span>
                        {row.issues.length > 0 ? (
                          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                            {row.issues.join(" ")}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form action={confirmImport}>
              <input name="jobId" type="hidden" value={jobId} />
              <input name="expiresAt" type="hidden" value={preview.expiresAt} />
              <input name="rows" type="hidden" value={JSON.stringify(rowsForImport)} />
              <Button
                disabled={isImporting || preview.readyCount === 0 || result?.status === "success"}
                type="submit"
              >
                {isImporting
                  ? "Создаем приглашения..."
                  : `Создать приглашения (${preview.readyCount})`}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>3. Результат импорта</CardTitle>
            <CardDescription>Итоги создания кандидатов, откликов и приглашений.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            {result.status === "error" ? <FeedbackMessage error={result.error} /> : null}
            {result.status === "success" ? (
              <>
                <FeedbackMessage
                  message={`Импорт завершен: добавлено ${result.importedCount}, пропущено ${result.skippedCount}, ошибок ${result.errorCount}.`}
                />
                <div className="overflow-x-auto rounded-lg border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/50 text-left text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium">Строка</th>
                        <th className="px-4 py-3 font-medium">Email</th>
                        <th className="px-4 py-3 font-medium">Результат</th>
                        <th className="px-4 py-3 font-medium">Комментарий</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, index) => (
                        <tr className="border-t" key={`${row.rowNumber}-${row.email}-${index}`}>
                          <td className="px-4 py-3">{row.rowNumber || "—"}</td>
                          <td className="px-4 py-3">{row.email}</td>
                          <td className="px-4 py-3 font-medium">
                            {resultStatusLabel(row.outcome)}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{row.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Link
                  className={buttonVariants({ variant: "outline" })}
                  href={`/dashboard/jobs/${jobId}/candidates`}
                >
                  К кандидатам вакансии
                </Link>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
