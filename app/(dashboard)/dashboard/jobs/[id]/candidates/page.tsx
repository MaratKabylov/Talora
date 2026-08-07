import Link from "next/link";
import { notFound } from "next/navigation";

import { CandidateApplicationsTable } from "@/components/candidates/candidate-applications-table";
import { InviteCandidateForm } from "@/components/candidates/invite-candidate-form";
import { FeedbackMessage } from "@/components/feedback-message";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import { canManageCandidates } from "@/lib/candidates/constants";
import { listJobCandidateApplications } from "@/lib/candidates/data";
import { JOB_STATUS_LABELS } from "@/lib/jobs/constants";
import { getJobPageData } from "@/lib/jobs/data";

type JobCandidatesParams = Promise<{ id: string }>;
type JobCandidatesSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

export default async function JobCandidatesPage({
  params,
  searchParams,
}: {
  params: JobCandidatesParams;
  searchParams: JobCandidatesSearchParams;
}) {
  const context = await requireCompanyContext();
  const { id } = await params;
  const feedback = await searchParams;
  const [data, applications] = await Promise.all([
    getJobPageData(context.activeCompany.id, id),
    listJobCandidateApplications(context.activeCompany.id, id),
  ]);

  if (!data) {
    notFound();
  }

  const mayManage = canManageCandidates(context.activeCompany.role);
  const mayInvite =
    mayManage &&
    Boolean(data.job.assessmentPackageId) &&
    data.job.status !== "closed" &&
    data.job.status !== "archived";
  const candidatesPath = `/dashboard/jobs/${data.job.id}/candidates`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Кандидаты вакансии</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.job.title} / {JOB_STATUS_LABELS[data.job.status]}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mayManage ? (
            <Link
              className={buttonVariants({ variant: "outline" })}
              href={`/dashboard/jobs/${data.job.id}/candidates/import`}
            >
              Загрузить Excel
            </Link>
          ) : null}
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={`/dashboard/jobs/${data.job.id}/compare`}
          >
            Сравнить кандидатов
          </Link>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={`/dashboard/jobs/${data.job.id}`}
          >
            К вакансии
          </Link>
        </div>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <Card>
        <CardHeader>
          <CardTitle>Пригласить кандидата</CardTitle>
          <CardDescription>
            Добавьте кандидата и создайте персональную ссылку на пакет оценки этой вакансии.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {mayInvite ? <InviteCandidateForm jobId={data.job.id} /> : null}
          {mayManage && !data.job.assessmentPackageId ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Чтобы приглашать кандидатов, сначала назначьте вакансии пакет оценки.
            </p>
          ) : null}
          {mayManage && (data.job.status === "closed" || data.job.status === "archived") ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              В закрытую или архивную вакансию новые приглашения не создаются.
            </p>
          ) : null}
          {!mayManage ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Ваша роль позволяет просматривать кандидатов без создания приглашений.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Кандидаты</CardTitle>
          <CardDescription>
            Всего в вакансии: {applications.length}. Здесь доступны приглашения, результаты и отчеты.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <CandidateApplicationsTable
            applications={applications}
            mayManage={mayManage}
            returnTo={candidatesPath}
          />
        </CardContent>
      </Card>
    </div>
  );
}
