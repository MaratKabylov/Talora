"use client";

import { PendingSubmitButton } from "@/components/pending-submit-button";
import { cancelCandidateAssessmentAction } from "@/lib/candidates/actions";

export function CancelCandidateAssessmentForm({
  applicationId,
  returnTo,
}: {
  applicationId: string;
  returnTo: string;
}) {
  return (
    <form
      action={cancelCandidateAssessmentAction}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          "Отменить прохождение? Ссылка кандидата перестанет работать, а незавершенные тесты будут закрыты.",
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input name="applicationId" type="hidden" value={applicationId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <PendingSubmitButton
        className="text-destructive hover:text-destructive"
        pendingText="Отменяем..."
        type="submit"
        variant="outline"
      >
        Отменить прохождение
      </PendingSubmitButton>
    </form>
  );
}
