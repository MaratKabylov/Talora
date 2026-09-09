import Link from "next/link";
import { notFound } from "next/navigation";

import {
  EmployeeComparisonFilterForm,
  EmployeeComparisonTable,
  type EmployeeComparisonFilters,
} from "@/components/employee-assessments/employee-comparison-table";
import { FeedbackMessage } from "@/components/feedback-message";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RECOMMENDATION_VALUES,
  RISK_LEVEL_VALUES,
} from "@/lib/candidates/constants";
import { requireCompanyContext } from "@/lib/auth/context";
import { ASSESSMENT_REPORT_GROUP_TITLES } from "@/lib/assessment-results/report-groups";
import {
  EMPLOYEE_ASSESSMENT_STATUS_LABELS,
  EMPLOYEE_PARTICIPANT_STATUS_VALUES,
} from "@/lib/employee-assessments/constants";
import {
  getEmployeeComparisonData,
} from "@/lib/employee-assessments/data";

type EmployeeCompareParams = Promise<{ id: string }>;
type EmployeeCompareSearchParams = Promise<{
  cursor?: string;
  department?: string;
  error?: string;
  message?: string;
  group?: string;
  recommendation?: string;
  risk?: string;
  role?: string;
  sort?: string;
  status?: string;
}>;

function validFilter<T extends string>(value: string | undefined, values: readonly T[]) {
  return values.includes(value as T) ? value ?? "" : "";
}

function formatAverage(value: number | null) {
  return value === null ? "-" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

export default async function EmployeeAssessmentComparePage({
  params,
  searchParams,
}: {
  params: EmployeeCompareParams;
  searchParams: EmployeeCompareSearchParams;
}) {
  const context = await requireCompanyContext();
  const { id } = await params;
  const query = await searchParams;
  const pageFilters = {
    department: (query.department ?? "").slice(0, 180),
    roleTitle: (query.role ?? "").slice(0, 180),
    recommendation: validFilter(query.recommendation, RECOMMENDATION_VALUES),
    riskLevel: validFilter(query.risk, RISK_LEVEL_VALUES),
    sort: query.sort === "fit_asc" ? "fit_asc" as const : "fit_desc" as const,
    status: validFilter(query.status, EMPLOYEE_PARTICIPANT_STATUS_VALUES),
  };
  const data = await getEmployeeComparisonData(context.activeCompany.id, id, pageFilters, query.cursor);

  if (!data) {
    notFound();
  }

  const departments = data.departments;
  const roleTitles = data.roleTitles;
  const availableGroups = new Set(data.dimensions.map((dimension) => dimension.group));
  // Retain an explicitly selected group even when this page has no dimensions in it.
  if (query.group && Object.hasOwn(ASSESSMENT_REPORT_GROUP_TITLES, query.group)) {
    availableGroups.add(query.group as keyof typeof ASSESSMENT_REPORT_GROUP_TITLES);
  }
  const reportGroups = Array.from(availableGroups).map(
    (group) => ({ key: group, title: ASSESSMENT_REPORT_GROUP_TITLES[group] }),
  );
  const selectedGroup = reportGroups.some((group) => group.key === query.group)
    ? query.group!
    : reportGroups[0]?.key ?? "";
  const filters: EmployeeComparisonFilters = { ...pageFilters, group: selectedGroup };
  const participants = data.participants;
  const nextParams = new URLSearchParams({ status: filters.status, recommendation: filters.recommendation,
    risk: filters.riskLevel, sort: filters.sort, department: filters.department,
    role: filters.roleTitle, group: selectedGroup });
  const firstHref = `/dashboard/employee-assessments/${id}/compare?${nextParams}`;
  if (data.nextCursor) nextParams.set("cursor", data.nextCursor);
  const nextHref = `/dashboard/employee-assessments/${id}/compare?${nextParams}`;
  const comparisonDimensions = data.dimensions.filter(
    (dimension) => dimension.group === selectedGroup,
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Сравнение сотрудников</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.assessment.title} / {EMPLOYEE_ASSESSMENT_STATUS_LABELS[data.assessment.status]}
          </p>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href={`/dashboard/employee-assessments/${data.assessment.id}`}>
          К оценке
        </Link>
      </div>

      <FeedbackMessage error={query.error} message={query.message} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Всего сотрудников</CardDescription>
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
            <CardDescription>Отделов в выборке</CardDescription>
            <CardTitle>{departments.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Фильтры и сортировка</CardTitle>
          <CardDescription>
            Сравнение выполняется только внутри одной оценки сотрудников.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <EmployeeComparisonFilterForm
            assessmentId={data.assessment.id}
            departments={departments}
            filters={filters}
            reportGroups={reportGroups}
            roleTitles={roleTitles}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Результаты сравнения</CardTitle>
          <CardDescription>
            Показано {participants.length} из {data.summary.participantCount} сотрудников.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <EmployeeComparisonTable dimensions={comparisonDimensions} participants={participants} />
          <div className="mt-4 flex gap-3">
            {query.cursor ? <Link className={buttonVariants({ variant: "outline" })} href={firstHref}>К началу</Link> : null}
            {data.nextCursor ? <Link className={buttonVariants({ variant: "outline" })} href={nextHref}>Следующие 50</Link> : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
