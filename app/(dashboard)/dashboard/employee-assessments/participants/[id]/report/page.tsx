import Link from "next/link";
import { notFound } from "next/navigation";

import { CancelEmployeeAssessmentForm } from "@/components/employee-assessments/cancel-employee-assessment-form";
import { FeedbackMessage } from "@/components/feedback-message";
import { ScoringResultDetails } from "@/components/scoring-result-details";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RECOMMENDATION_LABELS,
  RISK_LEVEL_LABELS,
} from "@/lib/candidates/constants";
import { requireCompanyContext } from "@/lib/auth/context";
import {
  canCancelEmployeeAssessment,
  canManageEmployeeAssessments,
  EMPLOYEE_PARTICIPANT_STATUS_LABELS,
} from "@/lib/employee-assessments/constants";
import { getEmployeeAssessmentReportData } from "@/lib/employee-assessments/data";
import { COMPETENCIES } from "@/lib/jobs/constants";
import type { ReportIntegrityEventType } from "@/lib/reports/data";
import { QUESTION_TYPE_LABELS } from "@/lib/tests/builder-constants";

type EmployeeReportParams = Promise<{ id: string }>;
type EmployeeReportSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

const COMPETENCY_LABELS = new Map(
  COMPETENCIES.map((competency) => [competency.key, competency.label]),
);

const TEST_SESSION_STATUS_LABELS: Record<string, string> = {
  cancelled: "Отменен",
  completed: "Завершен",
  expired: "Истек",
  in_progress: "В процессе",
  not_started: "Не начат",
};

const INTEGRITY_EVENT_LABELS: Record<ReportIntegrityEventType, string> = {
  clipboard_copy: "Попытка копирования",
  clipboard_cut: "Попытка вырезания",
  clipboard_paste: "Попытка вставки",
  concurrent_session_blocked: "Заблокирован параллельный вход",
  focus_lost: "Страница потеряла фокус",
  focus_returned: "Сотрудник вернулся на страницу",
  session_recovered: "Сессия восстановлена после тайм-аута активности",
  timer_expired: "Тест завершен по таймеру",
};

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

  const mayCancel =
    canManageEmployeeAssessments(context.activeCompany.role) &&
    canCancelEmployeeAssessment(data.participant.status);
  const reportPath = `/dashboard/employee-assessments/participants/${data.participant.id}/report`;
  const answerCounts = data.sessions.reduce(
    (counts, session) => ({
      correct: counts.correct + session.correctAnswersCount,
      incorrect: counts.incorrect + session.incorrectAnswersCount,
    }),
    { correct: 0, incorrect: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Карточка сотрудника / {data.assessment.title}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">{data.employee.fullName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[data.employee.email, data.employee.phone, data.employee.department, data.employee.roleTitle]
              .filter(Boolean)
              .join(" / ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mayCancel ? (
            <CancelEmployeeAssessmentForm
              participantId={data.participant.id}
              returnTo={reportPath}
            />
          ) : null}
          <Link
            className={buttonVariants({ variant: "outline" })}
            href={`/dashboard/employee-assessments/${data.assessment.id}`}
          >
            К оценке
          </Link>
        </div>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader>
            <CardDescription>Статус</CardDescription>
            <CardTitle className="text-xl">
              {EMPLOYEE_PARTICIPANT_STATUS_LABELS[data.participant.status]}
            </CardTitle>
          </CardHeader>
        </Card>
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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Контроль прохождения</CardTitle>
              <CardDescription className="mt-1">
                События показываются отдельно и не изменяют overall score или fit score.
              </CardDescription>
            </div>
            <span
              className={
                data.integrity.status === "critical"
                  ? "rounded-full bg-destructive/10 px-3 py-1 text-sm font-medium text-destructive"
                  : data.integrity.status === "attention"
                    ? "rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                    : "rounded-full bg-muted px-3 py-1 text-sm font-medium"
              }
            >
              {data.integrity.status === "critical"
                ? "Существенные события"
                : data.integrity.status === "attention"
                  ? "Требует внимания"
                  : "Событий нет"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Потери фокуса</p>
              <p className="mt-1 text-2xl font-semibold">{data.integrity.focusLossCount}</p>
              <p className="text-xs text-muted-foreground">
                Вне страницы: {formatDuration(data.integrity.focusLossDurationSeconds)}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Clipboard</p>
              <p className="mt-1 text-2xl font-semibold">{data.integrity.clipboardAttemptCount}</p>
              <p className="text-xs text-muted-foreground">copy / cut / paste</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Параллельные входы</p>
              <p className="mt-1 text-2xl font-semibold">
                {data.integrity.concurrentSessionAttemptCount}
              </p>
              <p className="text-xs text-muted-foreground">
                Восстановлений: {data.integrity.recoveredSessionCount}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Завершено по таймеру</p>
              <p className="mt-1 text-2xl font-semibold">{data.integrity.timerExpiredCount}</p>
              <p className="text-xs text-muted-foreground">По всем тестам пакета</p>
            </div>
          </div>

          <details className="rounded-lg border p-4">
            <summary className="cursor-pointer font-medium">
              Журнал событий ({data.integrity.events.length})
            </summary>
            <div className="mt-4 space-y-3 border-t pt-4">
              {data.integrity.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">Контрольные события не зафиксированы.</p>
              ) : (
                data.integrity.events.map((event) => (
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
          <CardDescription>
            История прохождения тестов. Верных ответов: {answerCounts.correct}, неверных:{" "}
            {answerCounts.incorrect}. Учитываются только ответы с определенной правильностью.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Тест</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">Результат</th>
                  <th className="px-4 py-3 font-medium">Верных</th>
                  <th className="px-4 py-3 font-medium">Неверных</th>
                  <th className="px-4 py-3 font-medium">Завершен</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((session) => (
                  <tr className="border-t" key={session.id}>
                    <td className="px-4 py-3 font-medium">{session.testTitle}</td>
                    <td className="px-4 py-3">
                      {TEST_SESSION_STATUS_LABELS[session.status] ?? session.status}
                    </td>
                    <td className="px-4 py-3">{formatScore(session.percentage)}</td>
                    <td className="px-4 py-3">{session.correctAnswersCount}</td>
                    <td className="px-4 py-3">{session.incorrectAnswersCount}</td>
                    <td className="px-4 py-3">
                      {session.completedAt
                        ? new Intl.DateTimeFormat("ru-RU").format(new Date(session.completedAt))
                        : session.startedAt
                          ? `Начат ${formatDateTime(session.startedAt)}`
                          : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 space-y-3">
            <h2 className="font-medium">Результаты и ответы сотрудника</h2>
            {data.sessions.every(
              (session) => session.answers.length === 0 && !session.scoringDetails,
            ) ? (
              <p className="text-sm text-muted-foreground">Результаты пока отсутствуют.</p>
            ) : (
              data.sessions.map((session) =>
                session.answers.length > 0 || session.scoringDetails ? (
                  <details className="rounded-lg border p-4" key={session.id}>
                    <summary className="cursor-pointer font-medium">
                      {session.testTitle} / Верных: {session.correctAnswersCount} / Неверных:{" "}
                      {session.incorrectAnswersCount}
                    </summary>
                    <div className="mt-4 space-y-4 border-t pt-4">
                      <ScoringResultDetails details={session.scoringDetails} />
                      {session.answers.map((answer, index) => (
                        <div className="space-y-2 text-sm" key={`${session.id}-${index}`}>
                          <div className="flex flex-wrap justify-between gap-3">
                            <p className="font-medium">{index + 1}. {answer.question}</p>
                            <span className="text-muted-foreground">
                              {QUESTION_TYPE_LABELS[answer.questionType]}
                            </span>
                          </div>
                          <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3">
                            {answer.answer}
                          </p>
                          {answer.questionType !== "forced_choice" &&
                          (answer.pointsAwarded !== null || answer.isCorrect !== null) ? (
                            <p className="text-muted-foreground">
                              {answer.pointsAwarded !== null ? `Баллы: ${answer.pointsAwarded}` : ""}
                              {answer.isCorrect !== null
                                ? `${answer.pointsAwarded !== null ? " / " : ""}${answer.isCorrect ? "Верно" : "Неверно"}`
                                : ""}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null,
              )
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
