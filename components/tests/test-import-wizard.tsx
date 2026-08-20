"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";

import { FeedbackMessage } from "@/components/feedback-message";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  confirmSystemTestImportAction,
  previewSystemTestImportAction,
} from "@/lib/admin/test-import-actions";
import {
  confirmTalviaTestImportAction,
  previewTalviaTestImportAction,
} from "@/lib/tests/import-actions";
import type {
  SystemTestImportTargetOption,
  TalviaTestImportPreviewState,
  TalviaTestImportResult,
} from "@/lib/tests/import-types";
import { SCORING_TYPE_LABELS } from "@/lib/tests/constants";
import { TEST_COMPETENCY_LABELS, type TestCompetencyKey } from "@/lib/tests/builder-constants";

const INITIAL_PREVIEW_STATE: TalviaTestImportPreviewState = { status: "idle" };

export function TestImportWizard({
  mode = "company",
  systemTargets = [],
}: {
  mode?: "company" | "system";
  systemTargets?: SystemTestImportTargetOption[];
}) {
  const router = useRouter();
  const isSystemImport = mode === "system";
  const [preview, previewAction, isPreviewing] = useActionState(
    isSystemImport ? previewSystemTestImportAction : previewTalviaTestImportAction,
    INITIAL_PREVIEW_STATE,
  );
  const [result, setResult] = useState<TalviaTestImportResult | null>(null);
  const [isImporting, startImport] = useTransition();

  function confirmImport(formData: FormData) {
    setResult(null);
    startImport(async () => {
      const nextResult = isSystemImport
        ? await confirmSystemTestImportAction(formData)
        : await confirmTalviaTestImportAction(formData);
      setResult(nextResult);
      if (nextResult.status === "success") router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>1. Загрузите JSON-файл</CardTitle>
          <CardDescription>
            Talvia принимает один тест в формате <code>talvia.test.v1</code>. На этом шаге данные
            только проверяются — {isSystemImport ? "новая версия" : "тест компании"} еще не
            создается.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <Link
            className={buttonVariants({ variant: "outline" })}
            download
            href="/api/tests/import-schema"
          >
            Скачать JSON Schema для ИИ
          </Link>

          <form
            action={previewAction}
            className="space-y-5"
            onSubmit={() => setResult(null)}
          >
            {isSystemImport ? (
              <div className="max-w-xl space-y-2">
                <Label htmlFor="system-test-import-target">Существующий системный тест</Label>
                <Select id="system-test-import-target" name="templateId" required>
                  <option value="">Выберите тест для новой версии</option>
                  {systemTargets.map((target) => (
                    <option disabled={target.hasDraft} key={target.id} value={target.id}>
                      {target.title} · {target.category ?? "без категории"} ·{" "}
                      {target.hasDraft
                        ? "уже есть черновик"
                        : `будет v${target.latestVersionNumber + 1}`}
                    </option>
                  ))}
                </Select>
                <p className="text-xs text-muted-foreground">
                  Категория выбранного теста должна совпадать с <code>test.category</code> в файле.
                </p>
              </div>
            ) : null}
            <div className="max-w-xl space-y-2">
              <Label htmlFor="test-import-file">Файл .json</Label>
              <Input
                accept=".json,application/json"
                id="test-import-file"
                name="file"
                onChange={() => setResult(null)}
                required
                type="file"
              />
              <p className="text-xs text-muted-foreground">
                UTF-8, не более 750 КБ. До 100 секций, 300 вопросов и 3000 вариантов ответа.
              </p>
            </div>
            <Button disabled={isPreviewing} type="submit">
              {isPreviewing ? "Проверяем файл..." : "Проверить и показать"}
            </Button>
          </form>

          {preview.status === "error" ? <FeedbackMessage error={preview.error} /> : null}
        </CardContent>
      </Card>

      {preview.status === "ready" ? (
        <Card>
          <CardHeader>
            <CardTitle>2. Проверьте будущий тест</CardTitle>
            <CardDescription>
              Файл: {preview.fileName}. После подтверждения Talvia{" "}
              {isSystemImport
                ? "добавит новую черновую версию в выбранный системный тест"
                : "создаст активный шаблон компании и черновик версии 1"}
              . Автоматической публикации не будет.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 pt-6">
            <div>
              <p className="text-sm text-muted-foreground">Название</p>
              <p className="mt-1 text-lg font-semibold">{preview.summary.title}</p>
            </div>

            {isSystemImport && preview.target ? (
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Куда будет добавлен черновик</p>
                <p className="mt-1 font-medium">
                  {preview.target.title} · версия {preview.target.nextVersionNumber}
                </p>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryCard label="Секции" value={preview.summary.sectionCount} />
              <SummaryCard label="Вопросы" value={preview.summary.totalQuestionCount} />
              <SummaryCard label="Обязательные" value={preview.summary.requiredQuestionCount} />
              <SummaryCard label="Длительность" value={`${preview.summary.durationMinutes} мин`} />
              <SummaryCard label="Один вариант" value={preview.summary.singleChoiceCount} />
              <SummaryCard label="Forced Choice" value={preview.summary.forcedChoiceCount} />
              <SummaryCard label="Шкала" value={preview.summary.scaleCount} />
              <SummaryCard label="Открытый ответ" value={preview.summary.openTextCount} />
              <SummaryCard
                label="Повторные вопросы"
                value={preview.summary.remediationQuestionCount}
              />
              <SummaryCard label="Варианты ответа" value={preview.summary.optionCount} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Тип оценки</p>
                <p className="mt-1 font-medium">
                  {SCORING_TYPE_LABELS[preview.summary.scoringType]}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Компетенции</p>
                <p className="mt-1 font-medium">
                  {preview.summary.competencyKeys.length > 0
                    ? preview.summary.competencyKeys
                        .map(
                          (key) =>
                            TEST_COMPETENCY_LABELS[key as TestCompetencyKey] ?? key,
                        )
                        .join(", ")
                    : "Не указаны"}
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
              <p className="font-medium">Перед импортом проверьте вручную</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {isSystemImport ? (
                  <li>
                    Импорт не публикует тест и не назначает его компаниям. Эти действия выполняются
                    отдельно после проверки черновика.
                  </li>
                ) : null}
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>

            <form action={confirmImport}>
              <input name="document" type="hidden" value={preview.normalizedDocument} />
              {isSystemImport && preview.target ? (
                <input name="templateId" type="hidden" value={preview.target.templateId} />
              ) : null}
              <Button
                disabled={isImporting || result?.status === "success"}
                type="submit"
              >
                {isImporting
                  ? "Создаем черновик..."
                  : isSystemImport
                    ? "Импортировать системный тест"
                    : "Подтвердить импорт"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>3. Результат импорта</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {result.status === "error" ? <FeedbackMessage error={result.error} /> : null}
            {result.status === "success" ? (
              <>
                <FeedbackMessage
                  message={
                    isSystemImport
                      ? `В системный тест «${result.title}» добавлен черновик v${result.versionNumber}.`
                      : `Тест «${result.title}» создан. Версия 1 сохранена как черновик.`
                  }
                />
                <div className="flex flex-wrap gap-3">
                  <Link
                    className={buttonVariants()}
                    href={`${isSystemImport ? "/admin" : "/dashboard"}/tests/${result.templateId}/builder?version=${result.versionId}`}
                  >
                    Открыть в конструкторе
                  </Link>
                  <Link
                    className={buttonVariants({ variant: "outline" })}
                    href={`${isSystemImport ? "/admin" : "/dashboard"}/tests/${result.templateId}`}
                  >
                    Карточка теста
                  </Link>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
