import Link from "next/link";
import { notFound } from "next/navigation";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import {
  APPLICATION_STATUS_LABELS,
  RECOMMENDATION_LABELS,
  RISK_LEVEL_LABELS,
} from "@/lib/candidates/constants";
import { getCandidateReportData, type ReportCompetency } from "@/lib/reports/data";
import { QUESTION_TYPE_LABELS } from "@/lib/tests/builder-constants";

type ReportParams = Promise<{ id: string }>;

function score(value: number | null) {
  return value === null ? "-" : `${value}%`;
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : "Не завершено";
}

function CompetencyRows({ competencies }: { competencies: ReportCompetency[] }) {
  if (competencies.length === 0) {
    return <p className="text-sm text-muted-foreground">Данных для отображения пока нет.</p>;
  }

  return (
    <div className="space-y-4">
      {competencies.map((competency) => (
        <div className="space-y-2" key={competency.key}>
          <div className="flex flex-wrap justify-between gap-3 text-sm">
            <span className="font-medium">{competency.label}</span>
            <span className={competency.isBelowMinimum ? "text-destructive" : "text-muted-foreground"}>
              {score(competency.percentage)}
              {competency.weightedScore !== null ? ` / вклад ${competency.weightedScore}` : ""}
              {competency.isBelowMinimum ? " / ниже минимума" : ""}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={competency.isBelowMinimum ? "h-full bg-destructive" : "h-full bg-primary"}
              style={{ width: `${Math.min(Math.max(competency.percentage ?? 0, 0), 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function CandidateReportPage({ params }: { params: ReportParams }) {
  const context = await requireCompanyContext();
  const { id } = await params;
  const report = await getCandidateReportData(context.activeCompany.id, id);

  if (!report) {
    notFound();
  }

  const assessedCompetencies = report.competencies.filter((competency) => !competency.isMotivation);
  const motivationProfile = report.competencies.filter((competency) => competency.isMotivation);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{report.job.title}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{report.candidate.fullName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {[report.candidate.email, report.candidate.phone, report.candidate.city]
              .filter(Boolean)
              .join(" / ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={buttonVariants({ variant: "outline" })} href={`/dashboard/jobs/${report.job.id}`}>
            К вакансии
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/candidates">
            К кандидатам
          </Link>
        </div>
      </div>

      {report.requiresReview ? (
        <p className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          В отчете есть развернутые ответы, требующие ручной проверки перед решением по кандидату.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Overall score</CardDescription>
            <CardTitle className="text-3xl">{score(report.overallScore)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Fit score</CardDescription>
            <CardTitle className="text-3xl">{score(report.fitScore)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Рекомендация</CardDescription>
            <CardTitle>
              {report.recommendation
                ? RECOMMENDATION_LABELS[report.recommendation] ?? report.recommendation
                : "Нет оценки"}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Статус / риски</CardDescription>
            <CardTitle>{APPLICATION_STATUS_LABELS[report.status]}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {report.riskLevel ? RISK_LEVEL_LABELS[report.riskLevel] ?? report.riskLevel : "Риски не выявлены"}
              {" / "}
              {formatDate(report.completedAt)}
            </p>
          </CardHeader>
        </Card>
      </div>

      {report.reportText ? (
        <Card>
          <CardHeader>
            <CardTitle>Общий вывод</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 text-sm text-muted-foreground">{report.reportText}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Компетенции</CardTitle>
            <CardDescription>Результаты, используемые для оценки соответствия вакансии.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <CompetencyRows competencies={assessedCompetencies} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Мотивационный профиль</CardTitle>
            <CardDescription>
              Профиль показывается как контекст для интервью и не является оценкой правильности.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <CompetencyRows competencies={motivationProfile} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Сильные стороны</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {report.strengths.length === 0 ? (
              <p className="text-sm text-muted-foreground">Выраженные сильные стороны по порогу 75% не выделены.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {report.strengths.map((strength) => (
                  <li className="rounded-md bg-muted/50 p-3" key={strength.key}>
                    <span className="font-medium">{strength.label}</span>: {score(strength.percentage)}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Риски</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {report.risks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Автоматические risk flags не выявлены.</p>
            ) : (
              <div className="space-y-3">
                {report.risks.map((risk) => (
                  <div className="rounded-md border p-3 text-sm" key={risk.id}>
                    <p className="font-medium">
                      {risk.title} / {RISK_LEVEL_LABELS[risk.level] ?? risk.level}
                    </p>
                    {risk.description ? (
                      <p className="mt-1 text-muted-foreground">{risk.description}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Вопросы для интервью</CardTitle>
          <CardDescription>Подсказки сформированы из результатов и областей для уточнения.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <ol className="space-y-3 text-sm">
            {report.interviewQuestions.map((question, index) => (
              <li className="rounded-md bg-muted/50 p-3" key={`${index}-${question}`}>
                {index + 1}. {question}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ответы кандидата</CardTitle>
          <CardDescription>История прохождения и ответы по конкретным версиям тестов.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {report.tests.length === 0 ? (
            <p className="text-sm text-muted-foreground">Кандидат еще не проходил тесты.</p>
          ) : (
            report.tests.map((test) => (
              <details className="rounded-lg border p-4" key={test.id}>
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium">{test.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {test.requiresReview ? "Нужна проверка" : score(test.percentage)}
                    </p>
                  </div>
                  {test.summary ? <p className="mt-2 text-sm text-muted-foreground">{test.summary}</p> : null}
                </summary>
                <div className="mt-4 space-y-4 border-t pt-4">
                  {test.answers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Ответы отсутствуют.</p>
                  ) : (
                    test.answers.map((answer, index) => (
                      <div className="space-y-2 text-sm" key={`${test.id}-${index}`}>
                        <div className="flex flex-wrap justify-between gap-3">
                          <p className="font-medium">
                            {index + 1}. {answer.question}
                          </p>
                          <span className="text-muted-foreground">
                            {QUESTION_TYPE_LABELS[answer.questionType]}
                            {answer.competencyLabel ? ` / ${answer.competencyLabel}` : ""}
                          </span>
                        </div>
                        <p className="rounded-md bg-muted/50 p-3">{answer.answer}</p>
                        {answer.pointsAwarded !== null || answer.isCorrect !== null ? (
                          <p className="text-muted-foreground">
                            {answer.pointsAwarded !== null ? `Баллы: ${answer.pointsAwarded}` : ""}
                            {answer.isCorrect !== null
                              ? `${answer.pointsAwarded !== null ? " / " : ""}${answer.isCorrect ? "Верно" : "Неверно"}`
                              : ""}
                          </p>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </details>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
