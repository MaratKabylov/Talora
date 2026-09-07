"use client";

import { useState } from "react";
import { AssessmentTestSession } from "./candidate-test-session";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { FeedbackMessage } from "@/components/feedback-message";
import type { AssessmentSectionSnapshot } from "@/lib/assessment/section-contract";
import type { TestPresentationSettings } from "@/lib/tests/presentation-settings";

// Mounted once per test session. Section transitions never refetch the server page/overview.
export function AssessmentTestFlow({ snapshot, assessmentType, token, sessionId, initialDeadlineAt,
  contextTitle, testTitle, description, instructions, presentationSettings, completedSessionCount, sessionCount, error, sectionPrefetchEnabled = false,
}: {
  snapshot: AssessmentSectionSnapshot; assessmentType: "candidate" | "employee"; token: string; sessionId: string;
  initialDeadlineAt: string | null; contextTitle: string; testTitle: string; description: string | null;
  instructions: string | null; presentationSettings: TestPresentationSettings; completedSessionCount: number;
  sessionCount: number; error?: string; sectionPrefetchEnabled?: boolean;
}) {
  const [current, setCurrent] = useState(snapshot);
  const sectionCount = current.sections.length;
  return <div className="space-y-6">
    <div>
      <p className="text-sm text-muted-foreground">{contextTitle}</p>
      <h1 className="mt-2 text-xl font-semibold sm:text-2xl">{testTitle}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Тест {completedSessionCount + 1} из {sessionCount}
        {current.section ? ` / секция ${current.sectionIndex + 1} из ${sectionCount}` : ""}
      </p>
      {current.sectionIndex === 0 && description ? <RichTextContent className="mt-3 text-sm text-muted-foreground" value={description} /> : null}
      {current.section ? <div role="progressbar" aria-label={`Секция ${current.sectionIndex + 1} из ${sectionCount}`}
        aria-valuemax={sectionCount} aria-valuemin={1} aria-valuenow={current.sectionIndex + 1}
        className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary transition-all" style={{ width: `${(current.sectionIndex + 1) / sectionCount * 100}%` }} />
      </div> : null}
    </div>
    <FeedbackMessage error={error} />
    {current.sectionIndex === 0 && presentationSettings.presentationMode === "section" && instructions
      ? <RichTextContent className="rounded-lg border bg-muted/40 p-4 text-sm" value={instructions} /> : null}
    <AssessmentTestSession assessmentType={assessmentType} answers={snapshot.answers}
      initialDeadlineAt={initialDeadlineAt} otherVisibleQuestionCount={snapshot.otherVisibleQuestionCount}
      presentationSettings={presentationSettings} questionOffset={snapshot.questionOffset} reviewMode={snapshot.reviewMode}
      section={snapshot.section} sectionCount={snapshot.sections.length} sectionIndex={snapshot.sectionIndex}
      sessionId={sessionId} testInstructions={instructions} token={token} onSectionChange={setCurrent} sectionPrefetchEnabled={sectionPrefetchEnabled} />
  </div>;
}
