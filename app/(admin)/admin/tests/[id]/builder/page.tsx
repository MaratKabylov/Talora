import Link from "next/link";
import { notFound } from "next/navigation";

import { FeedbackMessage } from "@/components/feedback-message";
import { TestBuilderEditor } from "@/components/tests/builder/test-builder-editor";
import { TestPreview } from "@/components/tests/builder/test-preview";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createSystemDraftFromPublishedVersionAction,
  publishSystemTestVersionAction,
  saveSystemTestBuilderDocumentAction,
} from "@/lib/admin/test-actions";
import { canManageSystemTests } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";
import {
  getAdminSystemBuilderImportSources,
  getAdminSystemTestBuilderData,
} from "@/lib/admin/tests-data";
import { TEST_VERSION_STATUS_LABELS } from "@/lib/tests/constants";
import { cn } from "@/lib/utils";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; message?: string; version?: string }>;

export default async function AdminSystemTestBuilderPage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const [{ id }, query, context] = await Promise.all([
    params,
    searchParams,
    requirePlatformContext(),
  ]);
  const data = await getAdminSystemTestBuilderData(id, query.version);
  if (!data) {
    notFound();
  }

  const mayManage = canManageSystemTests(context.role);
  const isEditable =
    mayManage && data.template.status === "active" && data.version.status === "draft";
  const importSources = isEditable
    ? await getAdminSystemBuilderImportSources(data.version.id)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{data.template.title}</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              Конструктор v{data.version.versionNumber}
            </h1>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {TEST_VERSION_STATUS_LABELS[data.version.status]}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={`/admin/tests/${data.template.id}`}
          >
            К тесту
          </Link>
          {!isEditable ? (
            <a className={buttonVariants()} href="#preview">
              Preview
            </a>
          ) : null}
        </div>
      </div>

      <FeedbackMessage error={query.error} message={query.message} />

      <Card>
        <CardHeader>
          <CardTitle>Версии</CardTitle>
          <CardDescription>
            Редактирование доступно только для черновика активного системного теста.
          </CardDescription>
          <div className="flex flex-wrap gap-2 pt-3">
            {data.template.versions.map((version) => (
              <Link
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" }),
                  version.id === data.version.id && "bg-accent text-accent-foreground",
                )}
                href={`/admin/tests/${data.template.id}/builder?version=${version.id}`}
                key={version.id}
              >
                v{version.versionNumber} / {TEST_VERSION_STATUS_LABELS[version.status]}
              </Link>
            ))}
          </div>
        </CardHeader>
      </Card>

      {!isEditable ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Режим просмотра</CardTitle>
            <CardDescription>
              {data.version.status === "published"
                ? "Опубликованная системная версия зафиксирована и доступна только для preview."
                : data.template.status === "archived"
                  ? "Активируйте системный тест, чтобы редактировать его черновик."
                  : "Ваша роль позволяет только просматривать содержание."}
            </CardDescription>
            {mayManage &&
            data.template.status === "active" &&
            data.version.status === "published" ? (
              <form action={createSystemDraftFromPublishedVersionAction} className="pt-3">
                <input name="templateId" type="hidden" value={data.template.id} />
                <input name="versionId" type="hidden" value={data.version.id} />
                <Button type="submit">Редактировать в новой версии</Button>
              </form>
            ) : null}
          </CardHeader>
        </Card>
      ) : null}

      {isEditable ? (
        <TestBuilderEditor
          imports={importSources}
          initialSections={data.sections}
          publishAction={publishSystemTestVersionAction}
          saveAction={saveSystemTestBuilderDocumentAction}
          templateId={data.template.id}
          version={data.version}
        />
      ) : (
        <div className="max-w-3xl space-y-4" id="preview">
          <h2 className="text-lg font-semibold">Preview кандидата</h2>
          <TestPreview sections={data.sections} version={data.version} />
        </div>
      )}
    </div>
  );
}
