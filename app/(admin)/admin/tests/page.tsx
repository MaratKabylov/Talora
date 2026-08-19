import Link from "next/link";

import { FeedbackMessage } from "@/components/feedback-message";
import { SystemTestGroups } from "@/components/tests/system-test-groups";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageSystemTests } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";
import { listAdminSystemTests } from "@/lib/admin/tests-data";

type SearchParams = Promise<{ error?: string; message?: string }>;

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
          <div className="flex flex-wrap gap-3">
            <Link
              className={buttonVariants({ variant: "outline" })}
              href="/admin/tests/import"
            >
              Импортировать JSON
            </Link>
            <Link className={buttonVariants()} href="/admin/tests/new">
              Создать системный тест
            </Link>
          </div>
        ) : null}
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <Card>
        <CardHeader>
          <CardTitle>Предустановленные тесты Talvia</CardTitle>
          <CardDescription>
            Опубликованные версии доступны компаниям только для использования и просмотра.
            Изменения выпускаются новой версией.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <SystemTestGroups
            emptyText="Создайте первый системный тест и опубликуйте его версию для HR workspace."
            hrefBase="/admin/tests"
            statusMode="template-status"
            templates={templates}
          />
        </CardContent>
      </Card>
    </div>
  );
}
