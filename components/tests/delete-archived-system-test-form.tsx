"use client";

import type { FormEvent } from "react";

import { PendingSubmitButton } from "@/components/pending-submit-button";
import { deleteUnusedArchivedSystemTestAction } from "@/lib/admin/test-actions";
import type { SystemTestVersionUsage } from "@/lib/admin/tests-data";

export function DeleteArchivedSystemTestForm({
  templateId,
  templateTitle,
  usage,
}: {
  templateId: string;
  templateTitle: string;
  usage: SystemTestVersionUsage;
}) {
  const attemptCount =
    usage.candidateSessionCount +
    usage.candidateResultCount +
    usage.employeeSessionCount +
    usage.employeeResultCount;
  const isBlocked = attemptCount > 0 || usage.assessmentPackageCount > 0;

  function confirmDelete(event: FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm(
      `Безвозвратно удалить системный тест «${templateTitle}» со всеми версиями и содержимым?`,
    );

    if (!confirmed) {
      event.preventDefault();
    }
  }

  return (
    <div className="space-y-3">
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-md border px-3 py-2">
          <dt className="text-muted-foreground">Пакеты оценки</dt>
          <dd className="font-medium">{usage.assessmentPackageCount}</dd>
        </div>
        <div className="rounded-md border px-3 py-2">
          <dt className="text-muted-foreground">Кандидаты: сессии / результаты</dt>
          <dd className="font-medium">
            {usage.candidateSessionCount} / {usage.candidateResultCount}
          </dd>
        </div>
        <div className="rounded-md border px-3 py-2">
          <dt className="text-muted-foreground">Сотрудники: сессии / результаты</dt>
          <dd className="font-medium">
            {usage.employeeSessionCount} / {usage.employeeResultCount}
          </dd>
        </div>
      </dl>

      {attemptCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          Удаление недоступно: по одной из версий уже создана сессия кандидата или сотрудника.
          Незавершенные сессии тоже сохраняются как история прохождения.
        </p>
      ) : usage.assessmentPackageCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          Удаление недоступно: сначала исключите версии теста из всех пакетов оценки.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Прохождений и назначений в пакеты нет. Все версии, вопросы и ответы будут удалены
          безвозвратно.
        </p>
      )}

      {usage.grantedCompanyCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          Вместе с тестом будут удалены выданные компаниям доступы: {usage.grantedCompanyCount}.
        </p>
      ) : null}

      <form action={deleteUnusedArchivedSystemTestAction} onSubmit={confirmDelete}>
        <input name="templateId" type="hidden" value={templateId} />
        <PendingSubmitButton
          className="border-destructive/40 text-destructive hover:bg-destructive/10"
          disabled={isBlocked}
          pendingText="Удаляем тест..."
          type="submit"
          variant="outline"
        >
          Удалить тест навсегда
        </PendingSubmitButton>
      </form>
    </div>
  );
}
