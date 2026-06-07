import Link from "next/link";

import { FeedbackMessage } from "@/components/feedback-message";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import {
  canManageEmployeeAssessments,
  EMPLOYEE_ASSESSMENT_STATUS_LABELS,
} from "@/lib/employee-assessments/constants";
import { listEmployeeAssessments } from "@/lib/employee-assessments/data";

type EmployeeAssessmentsSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

function formatScore(value: number | null) {
  return value === null ? "-" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

export default async function EmployeeAssessmentsPage({
  searchParams,
}: {
  searchParams: EmployeeAssessmentsSearchParams;
}) {
  const context = await requireCompanyContext();
  const params = await searchParams;
  const assessments = await listEmployeeAssessments(context.activeCompany.id);
  const mayManage = canManageEmployeeAssessments(context.activeCompany.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Оценки сотрудников</h1>
        </div>
        {mayManage ? (
          <Link className={buttonVariants()} href="/dashboard/employee-assessments/new">
            Создать оценку
          </Link>
        ) : null}
      </div>

      <FeedbackMessage error={params.error} message={params.message} />

      {assessments.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Оценок сотрудников пока нет</CardTitle>
            <CardDescription>
              Создайте оценку, выберите пакет тестов и отправьте сотрудникам персональные ссылки.
            </CardDescription>
          </CardHeader>
          {mayManage ? (
            <CardContent>
              <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/employee-assessments/new">
                Создать первую оценку
              </Link>
            </CardContent>
          ) : null}
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Все оценки сотрудников</CardTitle>
            <CardDescription>
              Сравнение и отчеты доступны внутри конкретной оценки.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Оценка</th>
                    <th className="px-4 py-3 font-medium">Статус</th>
                    <th className="px-4 py-3 font-medium">Пакет</th>
                    <th className="px-4 py-3 font-medium">Участники</th>
                    <th className="px-4 py-3 font-medium">Средний fit</th>
                    <th className="px-4 py-3 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {assessments.map((assessment) => (
                    <tr className="border-t" key={assessment.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{assessment.title}</p>
                        <p className="text-muted-foreground">
                          Обновлена {new Intl.DateTimeFormat("ru-RU").format(new Date(assessment.updatedAt))}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                          {EMPLOYEE_ASSESSMENT_STATUS_LABELS[assessment.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">{assessment.assessmentPackageTitle ?? "-"}</td>
                      <td className="px-4 py-3">
                        {assessment.invitedCount} / завершили {assessment.completedCount}
                      </td>
                      <td className="px-4 py-3">{formatScore(assessment.averageFitScore)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          className={buttonVariants({ size: "sm", variant: "outline" })}
                          href={`/dashboard/employee-assessments/${assessment.id}`}
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
