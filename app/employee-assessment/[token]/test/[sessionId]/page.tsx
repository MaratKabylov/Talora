import { redirect } from "next/navigation";

import { AssessmentShell, AssessmentUnavailable } from "@/components/assessment/assessment-shell";
import { AssessmentTestSession } from "@/components/assessment/candidate-test-session";
import { TestTakingGuard } from "@/components/assessment/test-taking-guard";
import { FeedbackMessage } from "@/components/feedback-message";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { getAssessmentSectionSnapshot } from "@/lib/assessment/section-data";
import { getAssessmentTestOverview } from "@/lib/assessment/test-overview";
import { AssessmentTestFlow } from "@/components/assessment/assessment-test-flow";
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
  let legacyOverview: ReturnType<typeof getEmployeeAssessmentByToken> | undefined;
  const readLegacyOverview = () => legacyOverview ??= getEmployeeAssessmentByToken(token);
  const overview = await getAssessmentTestOverview({ assessmentType: "employee", token, sessionId }, readLegacyOverview);

  if (overview.availability === "needs_consent") {
    redirect(`/employee-assessment/${token}`);
  }

  if (overview.availability !== "active") {
    if (overview.availability === "completed") {
      redirect(`/employee-assessment/${token}/complete`);
    }

    return <AssessmentUnavailable state={overview.availability} />;
  }

  const session = overview.session;

  if (session.status === "completed") {
    redirect(
      overview.nextSessionId
        ? `/employee-assessment/${token}/test/${overview.nextSessionId}`
        : `/employee-assessment/${token}/complete`,
    );
  }

  if (session.status !== "in_progress") {
    redirect(`/employee-assessment/${token}/profile`);
  }

  const presentationSettings = session.test.presentationSettings;
  const snapshot = await getAssessmentSectionSnapshot({ assessmentType: "employee", token, sessionId,
    requestedIndex: feedback.section, review: feedback.review, presentationSettings },
    async () => {
      const legacy = await readLegacyOverview();
      return legacy.availability === "active" && legacy.consentGivenAt
        ? getEmployeeAssessmentQuestionPageData(token, sessionId, legacy) : null;
    });
  if (!snapshot) return <AssessmentUnavailable state="invalid" />;
  if (process.env.ASSESSMENT_SOFT_NAVIGATION_V2 === "true" && process.env.ASSESSMENT_SECTION_READ_V2 === "true"
    && (presentationSettings.presentationMode === "one_question"
      || (process.env.ASSESSMENT_SECTION_SAVE_V2 === "true" && process.env.SESSION_CONTROL_V2 === "true"))) {
    return <TestTakingGuard><AssessmentShell companyName={overview.companyName}>
      {/* Server revisits restore fresh state; client-only section transitions keep this key. */}
      <AssessmentTestFlow key={`${sessionId}:${crypto.randomUUID()}`} snapshot={snapshot} assessmentType="employee" token={token} sessionId={sessionId}
        initialDeadlineAt={session.deadlineAt} contextTitle={overview.contextTitle} testTitle={session.test.title}
        description={session.test.description} instructions={session.test.instructions} presentationSettings={presentationSettings}
        completedSessionCount={overview.completedSessionCount} sessionCount={overview.sessionCount} error={feedback.error} />
    </AssessmentShell></TestTakingGuard>;
  }
  const data = { ...snapshot, assessment: overview, session };
  const { section, sectionIndex, questionOffset, otherVisibleQuestionCount, reviewMode } = snapshot;
  const completedSessions = overview.completedSessionCount;
  const progress = section ? ((sectionIndex + 1) / data.sections.length) * 100 : 0;

  return (
    <TestTakingGuard>
      <AssessmentShell companyName={data.assessment.companyName}>
        <div className="space-y-6">
          <div>
            <p className="text-sm text-muted-foreground">{overview.contextTitle}</p>
            <h1 className="mt-2 text-xl font-semibold sm:text-2xl">{data.session.test.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Тест {completedSessions + 1} из {overview.sessionCount}
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
