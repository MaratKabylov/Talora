import Link from "next/link";
import { redirect } from "next/navigation";

import { AssessmentShell, AssessmentUnavailable } from "@/components/assessment/assessment-shell";
import { QuestionResponseFields } from "@/components/assessment/question-response-fields";
import { FeedbackMessage } from "@/components/feedback-message";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  completeEmptySessionAction,
  saveCandidateAnswerAction,
} from "@/lib/assessment/actions";
import { getAssessmentByToken, getAssessmentQuestionPageData } from "@/lib/assessment/data";

type TestParams = Promise<{ sessionId: string; token: string }>;
type TestSearchParams = Promise<{ error?: string; question?: string }>;

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

  const data = await getAssessmentQuestionPageData(token, sessionId);
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

  const requestedIndex = Number(feedback.question ?? "0");
  const questionIndex = Number.isInteger(requestedIndex)
    ? Math.min(Math.max(requestedIndex, 0), Math.max(data.questions.length - 1, 0))
    : 0;
  const question = data.questions[questionIndex];
  const completedSessions = data.assessment.sessions.filter((session) => session.status === "completed").length;

  return (
    <AssessmentShell companyName={data.assessment.companyName}>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">{data.assessment.job.title}</p>
          <h1 className="mt-2 text-2xl font-semibold">{data.session.test.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Тест {completedSessions + 1} из {data.assessment.sessions.length}
            {question ? ` / вопрос ${questionIndex + 1} из ${data.questions.length}` : ""}
          </p>
        </div>

        <FeedbackMessage error={feedback.error} />

        {!question ? (
          <Card>
            <CardHeader>
              <CardTitle>В тесте нет вопросов</CardTitle>
              <CardDescription>Перейдите к следующему тесту в пакете оценки.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <form action={completeEmptySessionAction}>
                <input name="token" type="hidden" value={token} />
                <input name="sessionId" type="hidden" value={sessionId} />
                <Button type="submit">Продолжить</Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardDescription>{question.sectionTitle}</CardDescription>
              <CardTitle className="text-lg leading-snug">{question.text}</CardTitle>
              {question.description ? <p className="text-sm text-muted-foreground">{question.description}</p> : null}
            </CardHeader>
            <CardContent className="pt-6">
              <form action={saveCandidateAnswerAction} className="space-y-6">
                <input name="token" type="hidden" value={token} />
                <input name="sessionId" type="hidden" value={sessionId} />
                <input name="questionId" type="hidden" value={question.id} />
                <QuestionResponseFields answer={data.answers[question.id] ?? null} question={question} />
                <div className="flex flex-wrap justify-between gap-3">
                  {questionIndex > 0 ? (
                    <Link
                      className={buttonVariants({ variant: "outline" })}
                      href={`/assessment/${token}/test/${sessionId}?question=${questionIndex - 1}`}
                    >
                      Назад
                    </Link>
                  ) : (
                    <span />
                  )}
                  <Button name="direction" type="submit" value="next">
                    {questionIndex === data.questions.length - 1 ? "Завершить тест" : "Сохранить и далее"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </AssessmentShell>
  );
}
