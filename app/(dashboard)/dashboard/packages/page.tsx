import Link from "next/link";

import { FeedbackMessage } from "@/components/feedback-message";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import { canManageAssessmentPackages } from "@/lib/packages/constants";
import { listAssessmentPackages } from "@/lib/packages/data";

type PackagesSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU").format(new Date(value));
}

export default async function PackagesPage({
  searchParams,
}: {
  searchParams: PackagesSearchParams;
}) {
  const context = await requireCompanyContext();
  const params = await searchParams;
  const packages = await listAssessmentPackages(context.activeCompany.id);
  const mayManage = canManageAssessmentPackages(context.activeCompany.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Пакеты оценки</h1>
        </div>
        {mayManage ? (
          <Link className={buttonVariants()} href="/dashboard/packages/new">
            Создать пакет
          </Link>
        ) : null}
      </div>

      <FeedbackMessage error={params.error} message={params.message} />

      {packages.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Пакетов оценки пока нет</CardTitle>
            <CardDescription>
              Создайте пакет из опубликованных тестов, чтобы назначать его вакансиям и оценкам сотрудников.
            </CardDescription>
          </CardHeader>
          {mayManage ? (
            <CardContent>
              <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/packages/new">
                Создать первый пакет
              </Link>
            </CardContent>
          ) : null}
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Все пакеты оценки</CardTitle>
            <CardDescription>
              Системные пакеты доступны только для чтения, пакеты компании можно редактировать.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Пакет</th>
                    <th className="px-4 py-3 font-medium">Тип</th>
                    <th className="px-4 py-3 font-medium">Тесты</th>
                    <th className="px-4 py-3 font-medium">Обновлен</th>
                    <th className="px-4 py-3 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.map((assessmentPackage) => (
                    <tr className="border-t" key={assessmentPackage.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{assessmentPackage.title}</p>
                        <p className="text-muted-foreground">
                          {assessmentPackage.description ?? "Описание не указано"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                          {assessmentPackage.isSystem ? "Системный" : "Компании"}
                        </span>
                      </td>
                      <td className="px-4 py-3">{assessmentPackage.tests.length}</td>
                      <td className="px-4 py-3">{formatDate(assessmentPackage.updatedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          className={buttonVariants({ size: "sm", variant: "outline" })}
                          href={`/dashboard/packages/${assessmentPackage.id}`}
                        >
                          Открыть
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
