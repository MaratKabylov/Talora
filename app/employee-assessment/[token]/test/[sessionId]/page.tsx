import { redirect } from "next/navigation";

import { AssessmentShell, AssessmentUnavailable } from "@/components/assessment/assessment-shell";
import { AssessmentTestSession } from "@/components/assessment/candidate-test-session";
import { TestTakingGuard } from "@/components/assessment/test-taking-guard";
import { FeedbackMessage } from "@/components/feedback-message";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { getAssessmentSectionSnapshot } from "@/lib/assessment/section-data";
import {
  getEmployeeAssessmentByToken,
  getEmployeeAssessmentQuestionPageData,
} from "@/lib/employee-assessments/public-data";

type TestParams = Promise<{ sessionId: string; token: string }>;
type TestSearchParams = Promise<{ error?: string; review?: string; section?: string }>;

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

  const session = overview.sessions.find(entry => entry.id === sessionId);
  if (!session) {
    return <AssessmentUnavailable state="invalid" />;
  }

  if (session.status === "completed") {
    const nextSession = overview.sessions.find((session) => session.status === "in_progress");
    redirect(
      nextSession
        ? `/employee-assessment/${token}/test/${nextSession.id}`
        : `/employee-assessment/${token}/complete`,
    );
  }

  if (session.status !== "in_progress") {
    redirect(`/employee-assessment/${token}/profile`);
  }

  const presentationSettings = session.test.presentationSettings;
  const snapshot = await getAssessmentSectionSnapshot({ assessmentType: "employee", token, sessionId,
    requestedIndex: feedback.section, review: feedback.review, presentationSettings },
    () => getEmployeeAssessmentQuestionPageData(token, sessionId, overview));
  if (!snapshot) return <AssessmentUnavailable state="invalid" />;
  const data = { ...snapshot, assessment: overview, session };
  const { section, sectionIndex, questionOffset, otherVisibleQuestionCount, reviewMode } = snapshot;
  const completedSessions = data.assessment.sessions.filter(
    (session) => session.status === "completed",
  ).length;
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

          {sectionIndex === 0 &&
          presentationSettings.presentationMode === "section" &&
          data.session.test.instructions ? (
            <RichTextContent
              className="rounded-lg border bg-muted/40 p-4 text-sm"
              value={data.session.test.instructions}
            />
          ) : null}

          <AssessmentTestSession
            key={`${sessionId}:${sectionIndex}:${reviewMode}`}
            answers={data.answers}
            assessmentType="employee"
            initialDeadlineAt={data.session.deadlineAt}
            otherVisibleQuestionCount={otherVisibleQuestionCount}
            presentationSettings={presentationSettings}
            questionOffset={questionOffset}
            reviewMode={reviewMode}
            section={section ?? null}
            sectionCount={data.sections.length}
            sectionIndex={sectionIndex}
            sessionId={sessionId}
            testInstructions={data.session.test.instructions}
            token={token}
          />
        </div>
      </AssessmentShell>
    </TestTakingGuard>
  );
}
