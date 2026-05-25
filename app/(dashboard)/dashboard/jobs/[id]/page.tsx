import Link from "next/link";
import { notFound } from "next/navigation";

import { CandidateApplicationsTable } from "@/components/candidates/candidate-applications-table";
import { InviteCandidateForm } from "@/components/candidates/invite-candidate-form";
import { FeedbackMessage } from "@/components/feedback-message";
import { CompetencyWeightsFields } from "@/components/jobs/competency-weights-fields";
import { JobDetailsFields } from "@/components/jobs/job-details-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import { listJobCandidateApplications } from "@/lib/candidates/data";
import { updateJobAction, updateJobWeightsAction } from "@/lib/jobs/actions";
import { canManageJobs, JOB_STATUS_LABELS } from "@/lib/jobs/constants";
import { getJobPageData } from "@/lib/jobs/data";

type JobPageParams = Promise<{ id: string }>;
type JobSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

export default async function JobPage({
  params,
  searchParams,
}: {
  params: JobPageParams;
  searchParams: JobSearchParams;
}) {
  const context = await requireCompanyContext();
  const { id } = await params;
  const feedback = await searchParams;
  const data = await getJobPageData(context.activeCompany.id, id);

  if (!data) {
    notFound();
  }

  const mayManage = canManageJobs(context.activeCompany.role);
  const applications = await listJobCandidateApplications(context.activeCompany.id, data.job.id);
  const mayInvite =
    mayManage &&
    Boolean(data.job.assessmentPackageId) &&
    data.job.status !== "closed" &&
    data.job.status !== "archived";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{data.job.title}</h1>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {JOB_STATUS_LABELS[data.job.status]}
            </span>
          </div>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/jobs">
          К списку
        </Link>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <Card>
        <CardHeader>
          <CardTitle>Карточка вакансии</CardTitle>
          <CardDescription>
            Создана {new Intl.DateTimeFormat("ru-RU").format(new Date(data.job.createdAt))}.
            Пакет оценки: {data.job.assessmentPackageTitle ?? "не назначен"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form action={updateJobAction} className="space-y-5">
            <input name="jobId" type="hidden" value={data.job.id} />
            <JobDetailsFields disabled={!mayManage} job={data.job} packages={data.packages} />
            {mayManage ? <Button type="submit">Сохранить параметры</Button> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Веса компетенций</CardTitle>
          <CardDescription>
            Настройка используется для будущего расчета fit score. Сумма весов должна быть 100%.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form action={updateJobWeightsAction} className="space-y-5">
            <input name="jobId" type="hidden" value={data.job.id} />
            <CompetencyWeightsFields disabled={!mayManage} weights={data.weights} />
            {mayManage ? <Button type="submit">Сохранить веса</Button> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Кандидаты</CardTitle>
          <CardDescription>
            Добавьте кандидата и отправьте персональную ссылку на пакет оценки этой вакансии.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8 pt-6">
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
          <div className="space-y-3">
            <h2 className="text-sm font-medium">Кандидаты вакансии</h2>
            <CandidateApplicationsTable
              applications={applications}
              mayManage={mayManage}
              returnTo={`/dashboard/jobs/${data.job.id}`}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
