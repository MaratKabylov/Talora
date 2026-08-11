import { redirect } from "next/navigation";

import { AssessmentShell, AssessmentUnavailable } from "@/components/assessment/assessment-shell";
import { CandidateTestSession } from "@/components/assessment/candidate-test-session";
import { FeedbackMessage } from "@/components/feedback-message";
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

        <CandidateTestSession
          answers={data.answers}
          initialDeadlineAt={data.session.deadlineAt}
          section={section ?? null}
          sectionCount={data.sections.length}
          sectionIndex={sectionIndex}
          sessionId={sessionId}
          token={token}
        />
      </div>
    </AssessmentShell>
  );
}
