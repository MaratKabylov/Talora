import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { FeedbackMessage } from "@/components/feedback-message";
import { SystemTestGroups } from "@/components/tests/system-test-groups";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import {
  canManageTests,
  TEST_TEMPLATE_STATUS_LABELS,
  TEST_VERSION_STATUS_LABELS,
} from "@/lib/tests/constants";
import { listTestTemplates, type TestTemplate } from "@/lib/tests/data";
import { getCompanyTestPermissions } from "@/lib/tests/permissions";

type TestsSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

function TemplatesTable({
  emptyText,
  templates,
}: {
  emptyText: string;
  templates: TestTemplate[];
}) {
  if (templates.length === 0) {
    return (
      <EmptyState
        description={emptyText}
        title="Доступных тестов пока нет"
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Тест</th>
            <th className="px-4 py-3 font-medium">Статус</th>
            <th className="px-4 py-3 font-medium">Последняя версия</th>
            <th className="px-4 py-3 text-right font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <tr className="border-t" key={template.id}>
              <td className="px-4 py-3">
                <p className="font-medium">{template.title}</p>
                <p className="text-muted-foreground">{template.category ?? "Без категории"}</p>
              </td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                  {template.isSystem ? "Системный" : TEST_TEMPLATE_STATUS_LABELS[template.status]}
                </span>
              </td>
              <td className="px-4 py-3">
                {template.latestVersion ? (
                  <>
                    v{template.latestVersion.versionNumber} ·{" "}
                    {TEST_VERSION_STATUS_LABELS[template.latestVersion.status]}
                  </>
                ) : (
                  "Версий нет"
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                  href={`/dashboard/tests/${template.id}`}
                >
                  Открыть
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function TestsPage({
  searchParams,
}: {
  searchParams: TestsSearchParams;
}) {
  const context = await requireCompanyContext();
  const params = await searchParams;
  const [templates, permissions] = await Promise.all([
    listTestTemplates(context.activeCompany.id),
    getCompanyTestPermissions(context.activeCompany.id),
  ]);
  const systemTemplates = templates.filter(
    (template) => template.isSystem && template.status === "active",
  );
  const activeCompanyTemplates = templates.filter(
    (template) => !template.isSystem && template.status === "active",
  );
  const archivedCompanyTemplates = templates.filter(
    (template) => !template.isSystem && template.status === "archived",
  );
  const mayManage = canManageTests(context.activeCompany.role);
  const mayCreate = mayManage && permissions.canCreateCustomTests;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Библиотека тестов</h1>
        </div>
        {mayCreate ? (
          <div className="flex flex-wrap gap-3">
            <Link
              className={buttonVariants({ variant: "outline" })}
              href="/dashboard/tests/import"
            >
              Импортировать JSON
            </Link>
            <Link className={buttonVariants()} href="/dashboard/tests/new">
              Создать тест
            </Link>
          </div>
        ) : null}
      </div>

      <FeedbackMessage error={params.error} message={params.message} />

      <Card>
        <CardHeader>
          <CardTitle>Системные тесты</CardTitle>
          <CardDescription>
            Предустановленные методики Talvia доступны компании только для просмотра и
            использования в пакетах оценки.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <SystemTestGroups
            emptyText="Системные тесты появятся после назначения доступа в админ-панели."
            hrefBase="/dashboard/tests"
            statusMode="system-badge"
            templates={systemTemplates}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Активные тесты компании</CardTitle>
          <CardDescription>
            Создавайте собственные тесты. Опубликованные версии остаются неизменяемыми.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <TemplatesTable
            emptyText="У компании пока нет активных собственных тестов."
            templates={activeCompanyTemplates}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Архив</CardTitle>
          <CardDescription>
            Архивный тест можно открыть, восстановить или удалить, если у него нет опубликованных версий.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <TemplatesTable
            emptyText="Архивных тестов пока нет."
            templates={archivedCompanyTemplates}
          />
        </CardContent>
      </Card>
    </div>
  );
}
