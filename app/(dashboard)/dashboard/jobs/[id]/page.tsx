import Link from "next/link";
import { notFound } from "next/navigation";

import { FeedbackMessage } from "@/components/feedback-message";
import { CompetencyWeightsFields } from "@/components/jobs/competency-weights-fields";
import { CompositeScoringFields } from "@/components/jobs/composite-scoring-fields";
import { JobDetailsFields } from "@/components/jobs/job-details-fields";
import { ProfileTargetFields } from "@/components/jobs/profile-target-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import {
  updateJobAction,
  updateJobCompositeConfigAction,
  updateJobProfileTargetsAction,
  updateJobWeightsAction,
} from "@/lib/jobs/actions";
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
        <div className="flex flex-wrap gap-2">
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={`/dashboard/jobs/${data.job.id}/candidates`}
          >
            Кандидаты
          </Link>
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={`/dashboard/jobs/${data.job.id}/compare`}
          >
            Сравнить кандидатов
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/jobs">
            К списку
          </Link>
        </div>
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
          <CardTitle>Целевые профили</CardTitle>
          <CardDescription>
            Диапазоны рассчитывают отдельные Motivation Fit и Behavior Fit. Они не изменяют competency Fit Score.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form action={updateJobProfileTargetsAction} className="space-y-5">
            <input name="jobId" type="hidden" value={data.job.id} />
            <ProfileTargetFields
              behaviorTargets={data.job.behaviorTargetProfile}
              disabled={!mayManage}
              motivationTargets={data.job.motivationTargetProfile}
            />
            {mayManage ? <Button type="submit">Сохранить целевые профили</Button> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Composite assessment</CardTitle>
          <CardDescription>
            Составная оценка объединяет результаты тестов, dimensions и отдельные fit-метрики. Overall Score остаётся самостоятельным показателем.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form action={updateJobCompositeConfigAction} className="space-y-5">
            <input name="jobId" type="hidden" value={data.job.id} />
            <CompositeScoringFields
              config={data.job.compositeScoringConfig}
              disabled={!mayManage}
            />
            {mayManage ? <Button type="submit">Сохранить composite scoring</Button> : null}
          </form>
        </CardContent>
      </Card>

    </div>
  );
}
