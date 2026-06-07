import Link from "next/link";
import { redirect } from "next/navigation";

import { AssessmentShell, AssessmentUnavailable } from "@/components/assessment/assessment-shell";
import { FeedbackMessage } from "@/components/feedback-message";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptEmployeeAssessmentConsentAction } from "@/lib/employee-assessments/public-actions";
import { getEmployeeAssessmentByToken } from "@/lib/employee-assessments/public-data";

type EmployeeAssessmentParams = Promise<{ token: string }>;
type EmployeeAssessmentSearchParams = Promise<{ error?: string }>;

export default async function EmployeeAssessmentStartPage({
  params,
  searchParams,
}: {
  params: EmployeeAssessmentParams;
  searchParams: EmployeeAssessmentSearchParams;
}) {
  const { token } = await params;
  const feedback = await searchParams;
  const assessment = await getEmployeeAssessmentByToken(token);

  if (assessment.availability !== "active") {
    if (assessment.availability === "completed") {
      redirect(`/employee-assessment/${token}/complete`);
    }

    return <AssessmentUnavailable state={assessment.availability} />;
  }

  const activeSession = assessment.sessions.find((session) => session.status === "in_progress");

  return (
    <AssessmentShell companyName={assessment.companyName}>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">Приглашение на оценку сотрудников</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            {assessment.assessment.title}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {assessment.companyName}
            {[assessment.employee.department, assessment.employee.roleTitle].filter(Boolean).length
              ? ` / ${[assessment.employee.department, assessment.employee.roleTitle].filter(Boolean).join(" / ")}`
              : ""}
          </p>
        </div>

        <FeedbackMessage error={feedback.error} />

        <Card>
          <CardHeader>
            <CardTitle>{assessment.package.title}</CardTitle>
            <CardDescription>
              {assessment.package.description ?? "Пакет оценки компетенций сотрудника."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm">
              Примерное время:{" "}
              <span className="font-medium">
                {assessment.totalDurationMinutes > 0
                  ? `${assessment.totalDurationMinutes} мин.`
                  : "не указано"}
              </span>
            </p>
            <div className="space-y-2">
              {assessment.tests.map((test) => (
                <div
                  className="flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm"
                  key={test.versionId}
                >
                  <span>{test.title}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {test.durationMinutes ? `${test.durationMinutes} мин.` : ""}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {activeSession ? (
          <Card>
            <CardHeader>
              <CardTitle>Оценка уже начата</CardTitle>
              <CardDescription>Продолжите с места, на котором остановились.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <Link
                className={`${buttonVariants()} w-full sm:w-auto`}
                href={`/employee-assessment/${token}/test/${activeSession.id}`}
              >
                Продолжить прохождение
              </Link>
            </CardContent>
          </Card>
        ) : assessment.consentGivenAt ? (
          <Card>
            <CardHeader>
              <CardTitle>Согласие сохранено</CardTitle>
              <CardDescription>Проверьте данные сотрудника, чтобы начать тестирование.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <Link className={`${buttonVariants()} w-full sm:w-auto`} href={`/employee-assessment/${token}/profile`}>
                Перейти к данным
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Согласие на обработку данных</CardTitle>
              <CardDescription>
                Результаты используются {assessment.companyName} для внутренней оценки компетенций сотрудника
                в рамках «{assessment.assessment.title}». Итог не является автоматическим кадровым решением.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <form action={acceptEmployeeAssessmentConsentAction} className="space-y-5">
                <input name="token" type="hidden" value={token} />
                <label className="flex items-start gap-3 rounded-md border p-4 text-sm">
                  <input
                    className="mt-0.5 size-5 shrink-0 accent-primary"
                    name="consent"
                    required
                    type="checkbox"
                    value="accepted"
                  />
                  <span>
                    Я согласен(на) на обработку предоставленных персональных данных и результатов оценки
                    для внутренней оценки компетенций.
                  </span>
                </label>
                <PendingSubmitButton className="w-full sm:w-auto" pendingText="Сохраняем согласие..." type="submit">
                  Продолжить
                </PendingSubmitButton>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </AssessmentShell>
  );
}
