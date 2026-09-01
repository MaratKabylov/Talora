import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { CancelCandidateAssessmentForm } from "@/components/candidates/cancel-candidate-assessment-form";
import { FeedbackMessage } from "@/components/feedback-message";
import { AssessmentDimensionsReport } from "@/components/reports/assessment-dimensions-report";
import { ScoringResultDetails } from "@/components/scoring-result-details";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import {
  APPLICATION_STATUS_LABELS,
  canCancelCandidateAssessment,
  canManageCandidates,
  RECOMMENDATION_LABELS,
  RISK_LEVEL_LABELS,
} from "@/lib/candidates/constants";
import {
  getCandidateReportData,
  type ReportIntegrityEventType,
} from "@/lib/reports/data";
import { QUESTION_TYPE_LABELS } from "@/lib/tests/builder-constants";

type ReportParams = Promise<{ id: string }>;
type ReportSearchParams = Promise<{ error?: string; message?: string }>;

const TEST_SESSION_STATUS_LABELS = {
  cancelled: "Отменен",
  completed: "Завершен",
  expired: "Истек",
  in_progress: "В процессе",
  not_started: "Не начат",
} as const;

function score(value: number | null) {
  return value === null ? "-" : `${value}%`;
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : "Не завершено";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatDuration(seconds: number) {
  if (seconds < 60) {
    return `${seconds} сек.`;
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} мин. ${rest} сек.` : `${minutes} мин.`;
}

const INTEGRITY_EVENT_LABELS: Record<ReportIntegrityEventType, string> = {
  clipboard_copy: "Попытка копирования",
  clipboard_cut: "Попытка вырезания",
  clipboard_paste: "Попытка вставки",
  concurrent_session_blocked: "Заблокирован параллельный вход",
  focus_lost: "Страница потеряла фокус",
  focus_returned: "Кандидат вернулся на страницу",
  session_recovered: "Сессия восстановлена после тайм-аута активности",
  timer_expired: "Тест завершен по таймеру",
};

export default async function CandidateReportPage({
  params,
  searchParams,
}: {
  params: ReportParams;
  searchParams: ReportSearchParams;
}) {
  const context = await requireCompanyContext();
  const { id } = await params;
  const feedback = await searchParams;
  const report = await getCandidateReportData(context.activeCompany.id, id);

  if (!report) {
    notFound();
  }

  const mayCancel =
    canManageCandidates(context.activeCompany.role) && canCancelCandidateAssessment(report.status);
  const reportPath = `/dashboard/applications/${report.id}/report`;
  const answerCounts = report.tests.reduce(
    (counts, test) => ({
      correct: counts.correct + test.correctAnswersCount,
      incorrect: counts.incorrect + test.incorrectAnswersCount,
    }),
    { correct: 0, incorrect: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Карточка кандидата / {report.job.title}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{report.candidate.fullName}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {[report.candidate.email, report.candidate.phone, report.candidate.city]
              .filter(Boolean)
              .join(" / ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mayCancel ? (
            <CancelCandidateAssessmentForm applicationId={report.id} returnTo={reportPath} />
          ) : null}
          <Link className={buttonVariants({ variant: "outline" })} href={`/dashboard/jobs/${report.job.id}`}>
            К вакансии
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/candidates">
            К кандидатам
          </Link>
        </div>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      {report.requiresReview ? (
        <p className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          В отчете есть развернутые ответы, требующие ручной проверки перед решением по кандидату.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-7">
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
            <CardDescription>Motivation Fit</CardDescription>
            <CardTitle className="text-3xl">{score(report.motivationFit)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Behavior Fit</CardDescription>
            <CardTitle className="text-3xl">{score(report.behaviorFit)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Composite</CardDescription>
            <CardTitle className="text-3xl">{score(report.compositeScore)}</CardTitle>
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

      {report.compositeResult ? (
        <Card>
          <CardHeader>
            <CardTitle>Структура Composite Assessment</CardTitle>
            <CardDescription>
              Покрытие {score(report.compositeResult.coverage)} / статус {report.compositeResult.status}.
              Пропущенные источники сохраняются в snapshot и не подменяются нулём.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Источник</th>
                    <th className="px-4 py-3 font-medium">Результат</th>
                    <th className="px-4 py-3 font-medium">Вес</th>
                    <th className="px-4 py-3 font-medium">Вклад</th>
                  </tr>
                </thead>
                <tbody>
                  {report.compositeResult.components.map((component) => (
                    <tr className="border-t" key={component.source}>
                      <td className="px-4 py-3 font-medium">{component.source}</td>
                      <td className="px-4 py-3">{score(component.score)}</td>
                      <td className="px-4 py-3">{component.weight}</td>
                      <td className="px-4 py-3">{score(component.contribution)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Контроль прохождения</CardTitle>
              <CardDescription className="mt-1">
                События показываются отдельно и не изменяют overall score или fit score.
              </CardDescription>
            </div>
            <span
              className={
                report.integrity.status === "critical"
                  ? "rounded-full bg-destructive/10 px-3 py-1 text-sm font-medium text-destructive"
                  : report.integrity.status === "attention"
                    ? "rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                    : "rounded-full bg-muted px-3 py-1 text-sm font-medium"
              }
            >
              {report.integrity.status === "critical"
                ? "Существенные события"
                : report.integrity.status === "attention"
                  ? "Требует внимания"
                  : "Событий нет"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Потери фокуса</p>
              <p className="mt-1 text-2xl font-semibold">{report.integrity.focusLossCount}</p>
              <p className="text-xs text-muted-foreground">
                Вне страницы: {formatDuration(report.integrity.focusLossDurationSeconds)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Clipboard</p>
              <p className="mt-1 text-2xl font-semibold">{report.integrity.clipboardAttemptCount}</p>
              <p className="text-xs text-muted-foreground">copy / cut / paste</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Параллельные входы</p>
              <p className="mt-1 text-2xl font-semibold">{report.integrity.concurrentSessionAttemptCount}</p>
              <p className="text-xs text-muted-foreground">
                Восстановлений: {report.integrity.recoveredSessionCount}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Завершено по таймеру</p>
              <p className="mt-1 text-2xl font-semibold">{report.integrity.timerExpiredCount}</p>
              <p className="text-xs text-muted-foreground">По всем тестам пакета</p>
            </div>
          </div>

          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer font-medium">
              Журнал событий ({report.integrity.events.length})
            </summary>
            <div className="mt-4 space-y-3 border-t pt-4">
              {report.integrity.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">Контрольные события не зафиксированы.</p>
              ) : (
                report.integrity.events.map((event) => (
                  <div className="rounded-md bg-muted/50 p-3 text-sm" key={event.id}>
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="font-medium">{INTEGRITY_EVENT_LABELS[event.eventType]}</p>
                      <time className="text-muted-foreground" dateTime={event.occurredAt}>
                        {formatDateTime(event.occurredAt)}
                      </time>
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      {event.testTitle}
                      {event.question ? ` / ${event.question}` : ""}
                    </p>
                  </div>
                ))
              )}
            </div>
          </details>
        </CardContent>
      </Card>

      {report.reportText ? (
        <Card>
          <CardHeader>
            <CardTitle>Общий вывод</CardTitle>
          </CardHeader>
          <CardContent className="pt-6 text-sm text-muted-foreground">{report.reportText}</CardContent>
        </Card>
      ) : null}

      <AssessmentDimensionsReport groups={report.groups} highlights={report.highlights} />

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
          <CardDescription>
            История прохождения по конкретным версиям тестов. Верных ответов: {answerCounts.correct},
            неверных: {answerCounts.incorrect}. Учитываются только ответы с определенной правильностью.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pt-6">
          {report.tests.length === 0 ? (
            <EmptyState
              className="py-6"
              description="История ответов появится после начала прохождения оценки."
              title="Кандидат еще не проходил тесты"
            />
          ) : (
            report.tests.map((test) => (
              <details className="rounded-lg border p-4" key={test.id}>
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="font-medium">{test.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {TEST_SESSION_STATUS_LABELS[test.status]}
                      {test.percentage !== null ? ` / ${score(test.percentage)}` : ""}
                      {` / Верных: ${test.correctAnswersCount} / Неверных: ${test.incorrectAnswersCount}`}
                      {test.requiresReview ? " / Нужна проверка" : ""}
                    </p>
                  </div>
                  {test.summary ? <p className="mt-2 text-sm text-muted-foreground">{test.summary}</p> : null}
                  {test.startedAt || test.completedAt ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {test.startedAt ? `Начат: ${formatDateTime(test.startedAt)}` : ""}
                      {test.startedAt && test.completedAt ? " / " : ""}
                      {test.completedAt ? `Завершен: ${formatDateTime(test.completedAt)}` : ""}
                    </p>
                  ) : null}
                </summary>
                <div className="mt-4 space-y-4 border-t pt-4">
                  <ScoringResultDetails details={test.scoringDetails} />
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
                        <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3">{answer.answer}</p>
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
