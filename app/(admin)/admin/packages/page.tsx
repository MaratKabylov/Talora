import Link from "next/link";

import { FeedbackMessage } from "@/components/feedback-message";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageSystemAssessmentPackages } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";
import { listAdminSystemAssessmentPackages } from "@/lib/admin/packages-data";

type SearchParams = Promise<{ error?: string; message?: string }>;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU").format(new Date(value));
}

export default async function AdminPackagesPage({ searchParams }: { searchParams: SearchParams }) {
  const [feedback, context, packages] = await Promise.all([
    searchParams,
    requirePlatformContext(),
    listAdminSystemAssessmentPackages(),
  ]);
  const mayManage = canManageSystemAssessmentPackages(context.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Библиотека платформы</p>
          <h1 className="text-3xl font-semibold tracking-tight">Системные пакеты оценки</h1>
        </div>
        {mayManage ? (
          <Link className={buttonVariants()} href="/admin/packages/new">
            Создать системный пакет
          </Link>
        ) : null}
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      {packages.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Системных пакетов пока нет</CardTitle>
            <CardDescription>
              Соберите первый пакет из опубликованных системных тестов, чтобы компании могли
              назначать его вакансиям и оценкам сотрудников.
            </CardDescription>
          </CardHeader>
          {mayManage ? (
            <CardContent>
              <Link className={buttonVariants({ variant: "outline" })} href="/admin/packages/new">
                Создать первый пакет
              </Link>
            </CardContent>
          ) : null}
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Пакеты Talvia</CardTitle>
            <CardDescription>
              Пакет доступен компании, когда ей открыт доступ ко всем входящим в него системным
              тестам.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Пакет</th>
                    <th className="px-4 py-3 font-medium">Тесты</th>
                    <th className="px-4 py-3 font-medium">Обязательные</th>
                    <th className="px-4 py-3 font-medium">Время</th>
                    <th className="px-4 py-3 font-medium">Обновлен</th>
                    <th className="px-4 py-3 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.map((assessmentPackage) => {
                    const duration = assessmentPackage.tests.reduce(
                      (total, test) => total + (test.durationMinutes ?? 0),
                      0,
                    );
                    const required = assessmentPackage.tests.filter((test) => test.isRequired).length;

                    return (
                      <tr className="border-t" key={assessmentPackage.id}>
                        <td className="px-4 py-3">
                          <p className="font-medium">{assessmentPackage.title}</p>
                          <p className="max-w-xl text-muted-foreground">
                            {assessmentPackage.description ?? "Описание не указано"}
                          </p>
                        </td>
                        <td className="px-4 py-3">{assessmentPackage.tests.length}</td>
                        <td className="px-4 py-3">{required}</td>
                        <td className="px-4 py-3">{duration > 0 ? `${duration} мин.` : "—"}</td>
                        <td className="px-4 py-3">{formatDate(assessmentPackage.updatedAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            className={buttonVariants({ size: "sm", variant: "outline" })}
                            href={`/admin/packages/${assessmentPackage.id}`}
                          >
                            {mayManage ? "Управлять" : "Открыть"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
