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
import { getJobComparisonData, type ComparisonCandidate } from "@/lib/comparison/data";
import { JOB_STATUS_LABELS } from "@/lib/jobs/constants";

type JobCompareParams = Promise<{ id: string }>;
type JobCompareSearchParams = Promise<{
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

function filterApplications(applications: ComparisonCandidate[], filters: ComparisonFilters) {
  return applications.filter(
    (application) =>
      (!filters.status || application.status === filters.status) &&
      (!filters.recommendation || application.recommendation === filters.recommendation) &&
      (!filters.riskLevel || application.riskLevel === filters.riskLevel),
  );
}

function sortByFitScore(applications: ComparisonCandidate[], sort: ComparisonFilters["sort"]) {
  return applications.slice().sort((left, right) => {
    if (left.fitScore === null && right.fitScore !== null) {
      return 1;
    }

    if (left.fitScore !== null && right.fitScore === null) {
      return -1;
    }

    if (left.fitScore !== null && right.fitScore !== null && left.fitScore !== right.fitScore) {
      return sort === "fit_desc" ? right.fitScore - left.fitScore : left.fitScore - right.fitScore;
    }

    return left.candidate.fullName.localeCompare(right.candidate.fullName, "ru");
  });
}

function averageFitScore(applications: ComparisonCandidate[]) {
  const values = applications.flatMap((application) =>
    application.fitScore === null ? [] : [application.fitScore],
  );

  if (values.length === 0) {
    return "-";
  }

  const value = values.reduce((total, score) => total + score, 0) / values.length;
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
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
  const data = await getJobComparisonData(context.activeCompany.id, id);

  if (!data) {
    notFound();
  }

  const filters: ComparisonFilters = {
    recommendation: validFilter(query.recommendation, RECOMMENDATION_VALUES),
    riskLevel: validFilter(query.risk, RISK_LEVEL_VALUES),
    sort: query.sort === "fit_asc" ? "fit_asc" : "fit_desc",
    status: validFilter(query.status, APPLICATION_STATUS_VALUES),
  };
  const applications = sortByFitScore(filterApplications(data.applications, filters), filters.sort);
  const completedCount = data.applications.filter(
    (application) => application.status === "completed" || application.status === "shortlisted",
  ).length;
  const shortlistedCount = data.applications.filter(
    (application) => application.status === "shortlisted",
  ).length;

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
        <Link className={buttonVariants({ variant: "outline" })} href={`/dashboard/jobs/${data.job.id}`}>
          К вакансии
        </Link>
      </div>

      <FeedbackMessage error={query.error} message={query.message} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Всего кандидатов</CardDescription>
            <CardTitle>{data.applications.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Завершили оценку</CardDescription>
            <CardTitle>{completedCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Средний fit score</CardDescription>
            <CardTitle>{averageFitScore(data.applications)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>В шорт-листе</CardDescription>
            <CardTitle>{shortlistedCount}</CardTitle>
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
            Показано {applications.length} из {data.applications.length} кандидатов. Решение о найме принимает HR.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <CandidateComparisonTable
            applications={applications}
            jobId={data.job.id}
            mayManage={canManageCandidates(context.activeCompany.role)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
