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
import {
  EMPLOYEE_ASSESSMENT_STATUS_LABELS,
  EMPLOYEE_PARTICIPANT_STATUS_VALUES,
} from "@/lib/employee-assessments/constants";
import {
  getEmployeeComparisonData,
  type EmployeeComparisonParticipant,
} from "@/lib/employee-assessments/data";

type EmployeeCompareParams = Promise<{ id: string }>;
type EmployeeCompareSearchParams = Promise<{
  department?: string;
  error?: string;
  message?: string;
  recommendation?: string;
  risk?: string;
  role?: string;
  sort?: string;
  status?: string;
}>;

function validFilter<T extends string>(value: string | undefined, values: readonly T[]) {
  return values.includes(value as T) ? value ?? "" : "";
}

function uniqueValues(values: Array<string | null>) {
  return [...new Set(values.flatMap((value) => (value ? [value] : [])))].sort((left, right) =>
    left.localeCompare(right, "ru"),
  );
}

function filterParticipants(
  participants: EmployeeComparisonParticipant[],
  filters: EmployeeComparisonFilters,
) {
  return participants.filter(
    (participant) =>
      (!filters.status || participant.status === filters.status) &&
      (!filters.department || participant.employee.department === filters.department) &&
      (!filters.roleTitle || participant.employee.roleTitle === filters.roleTitle) &&
      (!filters.recommendation || participant.recommendation === filters.recommendation) &&
      (!filters.riskLevel || participant.riskLevel === filters.riskLevel),
  );
}

function sortByFitScore(
  participants: EmployeeComparisonParticipant[],
  sort: EmployeeComparisonFilters["sort"],
) {
  return participants.slice().sort((left, right) => {
    if (left.fitScore === null && right.fitScore !== null) {
      return 1;
    }

    if (left.fitScore !== null && right.fitScore === null) {
      return -1;
    }

    if (left.fitScore !== null && right.fitScore !== null && left.fitScore !== right.fitScore) {
      return sort === "fit_desc" ? right.fitScore - left.fitScore : left.fitScore - right.fitScore;
    }

    return left.employee.fullName.localeCompare(right.employee.fullName, "ru");
  });
}

function averageFitScore(participants: EmployeeComparisonParticipant[]) {
  const values = participants.flatMap((participant) =>
    participant.fitScore === null ? [] : [participant.fitScore],
  );

  if (values.length === 0) {
    return "-";
  }

  const value = values.reduce((total, score) => total + score, 0) / values.length;
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
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
  const data = await getEmployeeComparisonData(context.activeCompany.id, id);

  if (!data) {
    notFound();
  }

  const departments = uniqueValues(data.participants.map((participant) => participant.employee.department));
  const roleTitles = uniqueValues(data.participants.map((participant) => participant.employee.roleTitle));
  const filters: EmployeeComparisonFilters = {
    department: departments.includes(query.department ?? "") ? query.department ?? "" : "",
    recommendation: validFilter(query.recommendation, RECOMMENDATION_VALUES),
    riskLevel: validFilter(query.risk, RISK_LEVEL_VALUES),
    roleTitle: roleTitles.includes(query.role ?? "") ? query.role ?? "" : "",
    sort: query.sort === "fit_asc" ? "fit_asc" : "fit_desc",
    status: validFilter(query.status, EMPLOYEE_PARTICIPANT_STATUS_VALUES),
  };
  const participants = sortByFitScore(
    filterParticipants(data.participants, filters),
    filters.sort,
  );
  const completedCount = data.participants.filter((participant) => participant.status === "completed").length;

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
            <CardTitle>{data.participants.length}</CardTitle>
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
            <CardTitle>{averageFitScore(data.participants)}</CardTitle>
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
            roleTitles={roleTitles}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Результаты сравнения</CardTitle>
          <CardDescription>
            Показано {participants.length} из {data.participants.length} сотрудников.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <EmployeeComparisonTable participants={participants} />
        </CardContent>
      </Card>
    </div>
  );
}
