"use client";

import { PendingSubmitButton } from "@/components/pending-submit-button";
import { cancelEmployeeAssessmentAction } from "@/lib/employee-assessments/actions";

export function CancelEmployeeAssessmentForm({
  participantId,
  returnTo,
}: {
  participantId: string;
  returnTo: string;
}) {
  return (
    <form
      action={cancelEmployeeAssessmentAction}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          "Отменить прохождение? Ссылка сотрудника перестанет работать, а незавершенные тесты будут закрыты.",
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
    >
      <input name="participantId" type="hidden" value={participantId} />
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
