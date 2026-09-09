import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CandidateComparisonTable,
  ComparisonFilterForm,
  type ComparisonFilters,
} from "@/components/comparison/candidate-comparison-table";
import { FeedbackMessage } from "@/components/feedback-message";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import {
  APPLICATION_STATUS_VALUES,
  RECOMMENDATION_VALUES,
  RISK_LEVEL_VALUES,
  canManageCandidates,
} from "@/lib/candidates/constants";
import { getJobComparisonData } from "@/lib/comparison/data";
import { JOB_STATUS_LABELS } from "@/lib/jobs/constants";

type JobCompareParams = Promise<{ id: string }>;
type JobCompareSearchParams = Promise<{
  cursor?: string;
  error?: string;
  message?: string;
  recommendation?: string;
  risk?: string;
  sort?: string;
  status?: string;
}>;

function validFilter<T extends string>(value: string | undefined, values: readonly T[]) {
  return values.includes(value as T) ? value ?? "" : "";
}

function formatAverage(value: number | null) {
  return value === null ? "-" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

export default async function JobComparePage({
  params,
  searchParams,
}: {
  params: JobCompareParams;
  searchParams: JobCompareSearchParams;
}) {
  const context = await requireCompanyContext();
  const { id } = await params;
  const query = await searchParams;
  const filters: ComparisonFilters = {
    recommendation: validFilter(query.recommendation, RECOMMENDATION_VALUES),
    riskLevel: validFilter(query.risk, RISK_LEVEL_VALUES),
    sort: query.sort === "fit_asc" ? "fit_asc" : "fit_desc",
    status: validFilter(query.status, APPLICATION_STATUS_VALUES),
  };
  const data = await getJobComparisonData(context.activeCompany.id, id, filters, query.cursor);
  if (!data) notFound();
  const applications = data.applications;
  const nextParams = new URLSearchParams({ status: filters.status, recommendation: filters.recommendation,
    risk: filters.riskLevel, sort: filters.sort });
  const firstHref = `/dashboard/jobs/${id}/compare?${nextParams}`;
  if (data.nextCursor) nextParams.set("cursor", data.nextCursor);
  const nextHref = `/dashboard/jobs/${id}/compare?${nextParams}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Сравнение кандидатов</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.job.title} / {JOB_STATUS_LABELS[data.job.status]}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={`/dashboard/jobs/${data.job.id}/candidates`}
          >
            К кандидатам
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href={`/dashboard/jobs/${data.job.id}`}>
            К вакансии
          </Link>
        </div>
      </div>

      <FeedbackMessage error={query.error} message={query.message} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Всего кандидатов</CardDescription>
            <CardTitle>{data.summary.participantCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Завершили оценку</CardDescription>
            <CardTitle>{data.summary.completedCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Средний fit score</CardDescription>
            <CardTitle>{formatAverage(data.summary.averageFitScore)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>В шорт-листе</CardDescription>
            <CardTitle>{data.summary.shortlistedCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Фильтры и сортировка</CardTitle>
          <CardDescription>
            По умолчанию кандидаты отсортированы по соответствию вакансии, от высокого fit score к низкому.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <ComparisonFilterForm filters={filters} jobId={data.job.id} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Результаты сравнения</CardTitle>
          <CardDescription>
            Показано {applications.length} из {data.summary.participantCount} кандидатов. Решение о найме принимает HR.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <CandidateComparisonTable
            applications={applications}
            jobId={data.job.id}
            mayManage={canManageCandidates(context.activeCompany.role)}
          />
          <div className="mt-4 flex gap-3">
            {query.cursor ? <Link className={buttonVariants({ variant: "outline" })} href={firstHref}>К началу</Link> : null}
            {data.nextCursor ? <Link className={buttonVariants({ variant: "outline" })} href={nextHref}>Следующие 50</Link> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
