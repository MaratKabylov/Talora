import { redirect } from "next/navigation";

import { AssessmentShell, AssessmentUnavailable } from "@/components/assessment/assessment-shell";
import { QuestionResponseFields } from "@/components/assessment/question-response-fields";
import { TestTakingGuard } from "@/components/assessment/test-taking-guard";
import { FeedbackMessage } from "@/components/feedback-message";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RichTextContent } from "@/components/ui/rich-text-content";
import {
  completeEmptyEmployeeAssessmentSessionAction,
  saveEmployeeAssessmentSectionAction,
} from "@/lib/employee-assessments/public-actions";
import {
  getEmployeeAssessmentByToken,
  getEmployeeAssessmentQuestionPageData,
} from "@/lib/employee-assessments/public-data";

type TestParams = Promise<{ sessionId: string; token: string }>;
type TestSearchParams = Promise<{ error?: string; section?: string }>;

export default async function EmployeeAssessmentTestPage({
  params,
  searchParams,
}: {
  params: TestParams;
  searchParams: TestSearchParams;
}) {
  const { sessionId, token } = await params;
  const feedback = await searchParams;
  const overview = await getEmployeeAssessmentByToken(token);

  if (overview.availability !== "active") {
    if (overview.availability === "completed") {
      redirect(`/employee-assessment/${token}/complete`);
    }

    return <AssessmentUnavailable state={overview.availability} />;
  }

  if (!overview.consentGivenAt) {
    redirect(`/employee-assessment/${token}`);
  }

  const data = await getEmployeeAssessmentQuestionPageData(token, sessionId, overview);
  if (!data) {
    return <AssessmentUnavailable state="invalid" />;
  }

  if (data.session.status === "completed") {
    const nextSession = data.assessment.sessions.find((session) => session.status === "in_progress");
    redirect(nextSession ? `/employee-assessment/${token}/test/${nextSession.id}` : `/employee-assessment/${token}/complete`);
  }

  if (data.session.status !== "in_progress") {
    redirect(`/employee-assessment/${token}/profile`);
  }

  const requestedIndex = Number(feedback.section ?? "0");
  const sectionIndex = Number.isInteger(requestedIndex)
    ? Math.min(Math.max(requestedIndex, 0), Math.max(data.sections.length - 1, 0))
    : 0;
  const section = data.sections[sectionIndex];
  const visibleQuestions = (section?.questions ?? []).filter(
    (question) =>
      !question.remediationParentId ||
      data.answers[question.remediationParentId]?.isCorrect === false,
  );
  const sectionContent = [
    ...(section?.contentBlocks ?? []).map((block) => ({
      block,
      kind: "content-block" as const,
      orderIndex: block.orderIndex,
      sortIndex: block.positionIndex * 2,
    })),
    ...visibleQuestions.map((question) => ({
      kind: "question" as const,
      orderIndex: question.orderIndex,
      question,
      sortIndex: question.orderIndex * 2 - 1,
    })),
  ].sort(
    (left, right) => left.sortIndex - right.sortIndex || left.orderIndex - right.orderIndex,
  );
  const completedSessions = data.assessment.sessions.filter((session) => session.status === "completed").length;
  const progress = section ? ((sectionIndex + 1) / data.sections.length) * 100 : 0;

  return (
    <TestTakingGuard>
      <AssessmentShell companyName={data.assessment.companyName}>
        <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">{data.assessment.assessment.title}</p>
          <h1 className="mt-2 text-xl font-semibold sm:text-2xl">{data.session.test.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Тест {completedSessions + 1} из {data.assessment.sessions.length}
            {section ? ` / секция ${sectionIndex + 1} из ${data.sections.length}` : ""}
          </p>
          {sectionIndex === 0 && data.session.test.description ? (
            <RichTextContent
              className="mt-3 text-sm text-muted-foreground"
              value={data.session.test.description}
            />
          ) : null}
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

        {sectionIndex === 0 && data.session.test.instructions ? (
          <RichTextContent
            className="rounded-lg border bg-muted/40 p-4 text-sm"
            value={data.session.test.instructions}
          />
        ) : null}

        {!section ? (
          <Card>
            <CardHeader>
              <CardTitle>В тесте нет вопросов</CardTitle>
              <CardDescription>Перейдите к следующему тесту в пакете оценки.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <form action={completeEmptyEmployeeAssessmentSessionAction}>
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
              {section.description ? (
                <RichTextContent className="text-sm text-muted-foreground" value={section.description} />
              ) : null}
            </CardHeader>
            <CardContent className="pt-6">
              <form action={saveEmployeeAssessmentSectionAction} className="space-y-8">
                <input name="token" type="hidden" value={token} />
                <input name="sessionId" type="hidden" value={sessionId} />
                <input name="sectionIndex" type="hidden" value={sectionIndex} />
                {sectionContent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">В этой секции нет вопросов.</p>
                ) : (
                  sectionContent.map((item) => {
                    if (item.kind === "content-block") {
                      return (
                        <div
                          className="border-l-4 border-l-primary bg-muted/30 px-4 py-3"
                          key={item.block.id}
                        >
                          <h3 className="font-semibold">{item.block.title}</h3>
                          {item.block.description ? (
                            <RichTextContent
                              className="mt-1 text-sm text-muted-foreground"
                              value={item.block.description}
                            />
                          ) : null}
                        </div>
                      );
                    }

                    const question = item.question;
                    const index = visibleQuestions.findIndex((entry) => entry.id === question.id);
                    return (
                    <div className="space-y-4 border-b pb-8 last:border-0 last:pb-0" key={question.id}>
                      <div>
                        {question.remediationParentId ? (
                          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-primary">
                            Повторный вопрос
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap font-medium">
                          {index + 1}. {question.text}
                          {question.isRequired ? <span className="ml-1 text-destructive">*</span> : null}
                        </p>
                        {question.description ? (
                          <RichTextContent
                            className="mt-1 text-sm text-muted-foreground"
                            value={question.description}
                          />
                        ) : null}
                      </div>
                      <QuestionResponseFields
                        answer={data.answers[question.id] ?? null}
                        inputPrefix={`q_${question.id}`}
                        question={
                          question.remediationParentId
                            ? { ...question, isRequired: true }
                            : question
                        }
                      />
                      {data.answers[question.id]?.isCorrect === false && question.incorrectFeedback ? (
                        <div
                          className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950"
                          role="status"
                        >
                          <p className="text-sm font-semibold">Разбор ответа</p>
                          <p className="mt-2 whitespace-pre-wrap text-sm">
                            {question.incorrectFeedback}
                          </p>
                        </div>
                      ) : null}
                    </div>
                    );
                  })
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
    </TestTakingGuard>
  );
}
