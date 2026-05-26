import { redirect } from "next/navigation";

import { AssessmentShell, AssessmentUnavailable } from "@/components/assessment/assessment-shell";
import { QuestionResponseFields } from "@/components/assessment/question-response-fields";
import { FeedbackMessage } from "@/components/feedback-message";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  completeEmptySessionAction,
  saveCandidateSectionAction,
} from "@/lib/assessment/actions";
import { getAssessmentByToken, getAssessmentQuestionPageData } from "@/lib/assessment/data";

type TestParams = Promise<{ sessionId: string; token: string }>;
type TestSearchParams = Promise<{ error?: string; section?: string }>;

export default async function CandidateTestPage({
  params,
  searchParams,
}: {
  params: TestParams;
  searchParams: TestSearchParams;
}) {
  const { sessionId, token } = await params;
  const feedback = await searchParams;
  const overview = await getAssessmentByToken(token);

  if (overview.availability !== "active") {
    if (overview.availability === "completed") {
      redirect(`/assessment/${token}/complete`);
    }

    return <AssessmentUnavailable state={overview.availability} />;
  }

  if (!overview.consentGivenAt) {
    redirect(`/assessment/${token}`);
  }

  const data = await getAssessmentQuestionPageData(token, sessionId, overview);
  if (!data) {
    return <AssessmentUnavailable state="invalid" />;
  }

  if (data.session.status === "completed") {
    const nextSession = data.assessment.sessions.find((session) => session.status === "in_progress");
    redirect(nextSession ? `/assessment/${token}/test/${nextSession.id}` : `/assessment/${token}/complete`);
  }

  if (data.session.status !== "in_progress") {
    redirect(`/assessment/${token}/profile`);
  }

  const requestedIndex = Number(feedback.section ?? "0");
  const sectionIndex = Number.isInteger(requestedIndex)
    ? Math.min(Math.max(requestedIndex, 0), Math.max(data.sections.length - 1, 0))
    : 0;
  const section = data.sections[sectionIndex];
  const completedSessions = data.assessment.sessions.filter((session) => session.status === "completed").length;
  const progress = section ? ((sectionIndex + 1) / data.sections.length) * 100 : 0;

  return (
    <AssessmentShell companyName={data.assessment.companyName}>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">{data.assessment.job.title}</p>
          <h1 className="mt-2 text-xl font-semibold sm:text-2xl">{data.session.test.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Тест {completedSessions + 1} из {data.assessment.sessions.length}
            {section ? ` / секция ${sectionIndex + 1} из ${data.sections.length}` : ""}
          </p>
          {section ? (
            <div
              aria-label={`Секция ${sectionIndex + 1} из ${data.sections.length}`}
              aria-valuemax={data.sections.length}
              aria-valuemin={1}
              aria-valuenow={sectionIndex + 1}
              className="mt-4 h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
            >
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </div>

        <FeedbackMessage error={feedback.error} />

        {!section ? (
          <Card>
            <CardHeader>
              <CardTitle>В тесте нет вопросов</CardTitle>
              <CardDescription>Перейдите к следующему тесту в пакете оценки.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <form action={completeEmptySessionAction}>
                <input name="token" type="hidden" value={token} />
                <input name="sessionId" type="hidden" value={sessionId} />
                <PendingSubmitButton className="w-full sm:w-auto" pendingText="Переходим..." type="submit">
                  Продолжить
                </PendingSubmitButton>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardDescription>Секция {sectionIndex + 1}</CardDescription>
              <CardTitle className="text-lg leading-snug">{section.title}</CardTitle>
              {section.description ? <p className="text-sm text-muted-foreground">{section.description}</p> : null}
            </CardHeader>
            <CardContent className="pt-6">
              <form action={saveCandidateSectionAction} className="space-y-8">
                <input name="token" type="hidden" value={token} />
                <input name="sessionId" type="hidden" value={sessionId} />
                <input name="sectionIndex" type="hidden" value={sectionIndex} />
                {section.questions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">В этой секции нет вопросов.</p>
                ) : (
                  section.questions.map((question, index) => (
                    <div className="space-y-4 border-b pb-8 last:border-0 last:pb-0" key={question.id}>
                      <div>
                        <p className="font-medium">
                          {index + 1}. {question.text}
                          {question.isRequired ? <span className="ml-1 text-destructive">*</span> : null}
                        </p>
                        {question.description ? (
                          <p className="mt-1 text-sm text-muted-foreground">{question.description}</p>
                        ) : null}
                      </div>
                      <QuestionResponseFields
                        answer={data.answers[question.id] ?? null}
                        inputPrefix={`q_${question.id}`}
                        question={question}
                      />
                    </div>
                  ))
                )}
                <div className="-mx-6 -mb-6 flex flex-col-reverse gap-3 border-t bg-background/95 px-6 py-4 sm:mx-0 sm:mb-0 sm:flex-row sm:justify-between sm:border-0 sm:p-0">
                  {sectionIndex > 0 ? (
                    <PendingSubmitButton
                      className="w-full sm:w-auto"
                      name="direction"
                      pendingText="Сохраняем..."
                      type="submit"
                      value="previous"
                    >
                      Назад
                    </PendingSubmitButton>
                  ) : (
                    <span className="hidden sm:block" />
                  )}
                  <PendingSubmitButton
                    className="w-full sm:w-auto"
                    name="direction"
                    pendingText="Сохраняем ответ..."
                    type="submit"
                    value="next"
                  >
                    {sectionIndex === data.sections.length - 1 ? "Завершить тест" : "Сохранить и далее"}
                  </PendingSubmitButton>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </AssessmentShell>
  );
}
