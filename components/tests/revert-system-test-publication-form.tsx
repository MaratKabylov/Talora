"use client";

import type { FormEvent } from "react";

import { PendingSubmitButton } from "@/components/pending-submit-button";
import { revertUnusedSystemTestPublicationAction } from "@/lib/admin/test-actions";

type UsageSummary = {
  assessmentPackageCount: number;
  candidateResultCount: number;
  candidateSessionCount: number;
  employeeResultCount: number;
  employeeSessionCount: number;
  grantedCompanyCount: number;
};

export function RevertSystemTestPublicationForm({
  templateId,
  usage,
  versionId,
  versionNumber,
  willHideFromGrantedCompanies,
}: {
  templateId: string;
  usage: UsageSummary;
  versionId: string;
  versionNumber: number;
  willHideFromGrantedCompanies: boolean;
}) {
  const blockingReferenceCount =
    usage.assessmentPackageCount +
    usage.candidateSessionCount +
    usage.candidateResultCount +
    usage.employeeSessionCount +
    usage.employeeResultCount;
  const isBlocked = blockingReferenceCount > 0;

  function confirmRevert(event: FormEvent<HTMLFormElement>) {
    const companyWarning = willHideFromGrantedCompanies
      ? `\n\nПосле отмены тест станет недоступен ${usage.grantedCompanyCount} компаниям до повторной публикации.`
      : "";
    const confirmed = window.confirm(
      `Отменить публикацию v${versionNumber}? Версия станет редактируемым черновиком.${companyWarning}`,
    );

    if (!confirmed) {
      event.preventDefault();
    }
  }

  return (
    <div className="space-y-3">
      <dl className="grid gap-2 text-sm sm:grid-cols-3">
        <div className="rounded-md border px-3 py-2">
          <dt className="text-muted-foreground">Пакеты</dt>
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

      {isBlocked ? (
        <p className="text-sm text-muted-foreground">
          Отмена заблокирована: версия уже используется. Для изменений создайте новую версию.
          Ссылки из пакетов и исторические прохождения автоматически не удаляются.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Зависимостей нет. После отмены версия станет черновиком, а дата публикации сохранится в
          журнале аудита.
        </p>
      )}

      {willHideFromGrantedCompanies ? (
        <p className="text-sm text-muted-foreground">
          Это единственная опубликованная версия. Тест временно исчезнет у компаний с назначенным
          доступом: {usage.grantedCompanyCount}.
        </p>
      ) : null}

      <form action={revertUnusedSystemTestPublicationAction} onSubmit={confirmRevert}>
        <input name="templateId" type="hidden" value={templateId} />
        <input name="versionId" type="hidden" value={versionId} />
        <PendingSubmitButton
          disabled={isBlocked}
          pendingText="Отменяем публикацию..."
          type="submit"
          variant="outline"
        >
          Отменить публикацию v{versionNumber}
        </PendingSubmitButton>
      </form>
    </div>
  );
}

