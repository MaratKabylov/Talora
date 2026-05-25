import Link from "next/link";
import { notFound } from "next/navigation";

import { FeedbackMessage } from "@/components/feedback-message";
import { TestBuilderEditor } from "@/components/tests/builder/test-builder-editor";
import { TestPreview } from "@/components/tests/builder/test-preview";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import { canManageTests, TEST_VERSION_STATUS_LABELS } from "@/lib/tests/constants";
import { getTestBuilderData } from "@/lib/tests/builder-data";
import { cn } from "@/lib/utils";

type BuilderParams = Promise<{ id: string }>;
type BuilderSearchParams = Promise<{
  error?: string;
  message?: string;
  version?: string;
}>;

export default async function TestBuilderPage({
  params,
  searchParams,
}: {
  params: BuilderParams;
  searchParams: BuilderSearchParams;
}) {
  const context = await requireCompanyContext();
  const { id } = await params;
  const query = await searchParams;
  const data = await getTestBuilderData(context.activeCompany.id, id, query.version);

  if (!data) {
    notFound();
  }

  const mayManage = canManageTests(context.activeCompany.role);
  const isEditable =
    mayManage &&
    !data.template.isSystem &&
    data.template.status === "active" &&
    data.version.status === "draft";

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
            href={`/dashboard/tests/${data.template.id}`}
          >
            К тесту
          </Link>
          <a className={buttonVariants()} href="#preview">
            Preview
          </a>
        </div>
      </div>

      <FeedbackMessage error={query.error} message={query.message} />

      <Card>
        <CardHeader>
          <CardTitle>Версии</CardTitle>
          <CardDescription>
            Редактирование доступно только для черновика активного теста компании.
          </CardDescription>
          <div className="flex flex-wrap gap-2 pt-3">
            {data.template.versions.map((version) => (
              <Link
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" }),
                  version.id === data.version.id && "bg-accent text-accent-foreground",
                )}
                href={`/dashboard/tests/${data.template.id}/builder?version=${version.id}`}
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
                ? "Опубликованная версия зафиксирована и не может быть изменена."
                : data.template.isSystem
                  ? "Системный тест управляется централизованно."
                  : "Для изменения содержания нужна активная черновая версия и роль редактора."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {isEditable ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(22rem,0.9fr)]">
          <TestBuilderEditor
            sections={data.sections}
            templateId={data.template.id}
            versionId={data.version.id}
          />
          <div className="space-y-4 xl:sticky xl:top-6" id="preview">
            <h2 className="text-lg font-semibold">Preview кандидата</h2>
            <TestPreview sections={data.sections} version={data.version} />
          </div>
        </div>
      ) : (
        <div className="max-w-3xl space-y-4" id="preview">
          <h2 className="text-lg font-semibold">Preview кандидата</h2>
          <TestPreview sections={data.sections} version={data.version} />
        </div>
      )}
    </div>
  );
}
