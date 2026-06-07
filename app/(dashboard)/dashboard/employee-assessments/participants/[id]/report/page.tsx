import Link from "next/link";
import { notFound } from "next/navigation";

import { FeedbackMessage } from "@/components/feedback-message";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RECOMMENDATION_LABELS,
  RISK_LEVEL_LABELS,
} from "@/lib/candidates/constants";
import { requireCompanyContext } from "@/lib/auth/context";
import { getEmployeeAssessmentReportData } from "@/lib/employee-assessments/data";
import { COMPETENCIES } from "@/lib/jobs/constants";

type EmployeeReportParams = Promise<{ id: string }>;
type EmployeeReportSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

const COMPETENCY_LABELS = new Map(
  COMPETENCIES.map((competency) => [competency.key, competency.label]),
);

function formatScore(value: number | null | undefined) {
  return value === null || value === undefined
    ? "-"
    : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

function objectLabel(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return String(value ?? "");
  }

  const record = value as Record<string, unknown>;
  const label = record.label ?? record.title ?? record.competencyKey ?? record.risk_key;
  const percentage = record.percentage;

  return `${String(label ?? "Пункт")}${typeof percentage === "number" ? `: ${formatScore(percentage)}` : ""}`;
}

export default async function EmployeeAssessmentReportPage({
  params,
  searchParams,
}: {
  params: EmployeeReportParams;
  searchParams: EmployeeReportSearchParams;
}) {
  const context = await requireCompanyContext();
  const { id } = await params;
  const feedback = await searchParams;
  const data = await getEmployeeAssessmentReportData(context.activeCompany.id, id);

  if (!data) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Отчет сотрудника</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.employee.fullName} / {data.assessment.title}
          </p>
        </div>
        <Link
          className={buttonVariants({ variant: "outline" })}
          href={`/dashboard/employee-assessments/${data.assessment.id}`}
        >
          К оценке
        </Link>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Overall score</CardDescription>
            <CardTitle>{formatScore(data.participant.overallScore)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Fit score</CardDescription>
            <CardTitle>{formatScore(data.participant.fitScore)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Рекомендация</CardDescription>
            <CardTitle className="text-xl">
              {data.participant.requiresReview
                ? RECOMMENDATION_LABELS.requires_review
                : data.participant.recommendation
                  ? RECOMMENDATION_LABELS[data.participant.recommendation] ?? data.participant.recommendation
                  : "-"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Риск</CardDescription>
            <CardTitle className="text-xl">
              {data.participant.riskLevel
                ? RISK_LEVEL_LABELS[data.participant.riskLevel] ?? data.participant.riskLevel
                : "-"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Сотрудник</CardTitle>
          <CardDescription>Контекст участия в оценке.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground">Email</p>
            <p className="font-medium">{data.employee.email}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Телефон</p>
            <p className="font-medium">{data.employee.phone ?? "-"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Отдел</p>
            <p className="font-medium">{data.employee.department ?? "-"}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Должность</p>
            <p className="font-medium">{data.employee.roleTitle ?? "-"}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Компетенции</CardTitle>
          <CardDescription>Сводка по компетенциям в рамках оценки сотрудников.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Компетенция</th>
                  <th className="px-4 py-3 font-medium">Результат</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody>
                {data.summary.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-center text-muted-foreground" colSpan={3}>
                      Сводка по компетенциям пока не рассчитана.
                    </td>
                  </tr>
                ) : (
                  data.summary.map((summary) => (
                    <tr className="border-t" key={summary.competencyKey}>
                      <td className="px-4 py-3 font-medium">
                        {COMPETENCY_LABELS.get(summary.competencyKey) ?? summary.competencyKey}
                      </td>
                      <td className="px-4 py-3">{formatScore(summary.percentage)}</td>
                      <td className="px-4 py-3">
                        {summary.isBelowMinimum ? "Ниже обязательного минимума" : "В норме"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Сильные стороны</CardTitle>
            <CardDescription>Автоматическая сводка по высоким компетенциям.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {data.report?.strengths.length ? (
              <ul className="space-y-2 text-sm">
                {data.report.strengths.map((item, index) => (
                  <li className="rounded-md bg-muted/50 p-3" key={index}>
                    {objectLabel(item)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Пока нет рассчитанных сильных сторон.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Риски и вопросы</CardTitle>
            <CardDescription>Зоны, которые стоит обсудить с сотрудником или руководителем.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {data.report?.risks.length ? (
              <ul className="space-y-2 text-sm">
                {data.report.risks.map((item, index) => (
                  <li className="rounded-md bg-muted/50 p-3" key={index}>
                    {objectLabel(item)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Скоринговых рисков нет.</p>
            )}
            {data.report?.interviewQuestions.length ? (
              <div className="space-y-2">
                <h2 className="text-sm font-medium">Вопросы для обсуждения</h2>
                <ul className="space-y-2 text-sm">
                  {data.report.interviewQuestions.map((item, index) => (
                    <li className="rounded-md border p-3" key={index}>
                      {objectLabel(item)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Тесты</CardTitle>
          <CardDescription>История прохождения тестов в этой оценке.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Тест</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">Результат</th>
                  <th className="px-4 py-3 font-medium">Завершен</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((session) => (
                  <tr className="border-t" key={session.id}>
                    <td className="px-4 py-3 font-medium">{session.testTitle}</td>
                    <td className="px-4 py-3">{session.status}</td>
                    <td className="px-4 py-3">{formatScore(session.percentage)}</td>
                    <td className="px-4 py-3">
                      {session.completedAt
                        ? new Intl.DateTimeFormat("ru-RU").format(new Date(session.completedAt))
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
