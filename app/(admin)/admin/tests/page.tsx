import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { FeedbackMessage } from "@/components/feedback-message";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageSystemTests } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";
import { listAdminSystemTests } from "@/lib/admin/tests-data";
import {
  TEST_TEMPLATE_STATUS_LABELS,
  TEST_VERSION_STATUS_LABELS,
} from "@/lib/tests/constants";
import type { TestTemplate } from "@/lib/tests/data";

type SearchParams = Promise<{ error?: string; message?: string }>;

function TestsTable({ templates }: { templates: TestTemplate[] }) {
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
              <td className="px-4 py-3">{TEST_TEMPLATE_STATUS_LABELS[template.status]}</td>
              <td className="px-4 py-3">
                {template.latestVersion
                  ? `v${template.latestVersion.versionNumber} / ${TEST_VERSION_STATUS_LABELS[template.latestVersion.status]}`
                  : "Версий нет"}
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  className={buttonVariants({ size: "sm", variant: "outline" })}
                  href={`/admin/tests/${template.id}`}
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

export default async function AdminTestsPage({ searchParams }: { searchParams: SearchParams }) {
  const [feedback, context, templates] = await Promise.all([
    searchParams,
    requirePlatformContext(),
    listAdminSystemTests(),
  ]);
  const mayManage = canManageSystemTests(context.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Библиотека платформы</p>
          <h1 className="text-3xl font-semibold tracking-tight">Системные тесты</h1>
        </div>
        {mayManage ? (
          <Link className={buttonVariants()} href="/admin/tests/new">
            Создать системный тест
          </Link>
        ) : null}
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <Card>
        <CardHeader>
          <CardTitle>Предустановленные тесты Talora</CardTitle>
          <CardDescription>
            Опубликованные версии доступны компаниям только для использования и просмотра.
            Изменения выпускаются новой версией.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {templates.length ? (
            <TestsTable templates={templates} />
          ) : (
            <EmptyState
              description="Создайте первый системный тест и опубликуйте его версию для HR workspace."
              title="Системных тестов пока нет"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
