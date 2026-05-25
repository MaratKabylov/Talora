import Link from "next/link";

import { FeedbackMessage } from "@/components/feedback-message";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import { canManageJobs, JOB_STATUS_LABELS } from "@/lib/jobs/constants";
import { listJobs } from "@/lib/jobs/data";

type JobsSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

export default async function JobsPage({
  searchParams,
}: {
  searchParams: JobsSearchParams;
}) {
  const context = await requireCompanyContext();
  const params = await searchParams;
  const jobs = await listJobs(context.activeCompany.id);
  const mayManage = canManageJobs(context.activeCompany.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Вакансии</h1>
        </div>
        {mayManage ? (
          <Link className={buttonVariants()} href="/dashboard/jobs/new">
            Создать вакансию
          </Link>
        ) : null}
      </div>

      <FeedbackMessage error={params.error} message={params.message} />

      {jobs.length === 0 ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Вакансий пока нет</CardTitle>
            <CardDescription>
              Создайте позицию, назначьте пакет оценки и настройте вклад компетенций в fit score.
            </CardDescription>
          </CardHeader>
          {mayManage ? (
            <CardContent>
              <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/jobs/new">
                Создать первую вакансию
              </Link>
            </CardContent>
          ) : null}
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Все вакансии</CardTitle>
            <CardDescription>Открывайте карточку для настройки оценки и весов.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Вакансия</th>
                    <th className="px-4 py-3 font-medium">Статус</th>
                    <th className="px-4 py-3 font-medium">Пакет оценки</th>
                    <th className="px-4 py-3 font-medium">Обновлена</th>
                    <th className="px-4 py-3 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr className="border-t" key={job.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{job.title}</p>
                        <p className="text-muted-foreground">
                          {[job.department, job.location].filter(Boolean).join(" / ") ||
                            "Подразделение не указано"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                          {JOB_STATUS_LABELS[job.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">{job.assessmentPackageTitle ?? "Не назначен"}</td>
                      <td className="px-4 py-3">
                        {new Intl.DateTimeFormat("ru-RU").format(new Date(job.updatedAt))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          className={buttonVariants({ size: "sm", variant: "outline" })}
                          href={`/dashboard/jobs/${job.id}`}
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
