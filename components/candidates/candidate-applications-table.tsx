import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { cancelInvitationAction, resendInvitationAction } from "@/lib/candidates/actions";
import {
  APPLICATION_STATUS_LABELS,
  INVITATION_STATUS_LABELS,
  RECOMMENDATION_LABELS,
  RISK_LEVEL_LABELS,
} from "@/lib/candidates/constants";
import type { CandidateApplication } from "@/lib/candidates/data";

import { CopyInvitationLinkButton } from "./copy-invitation-link-button";
import { Button, buttonVariants } from "@/components/ui/button";

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : null;
}

function isExpired(application: CandidateApplication) {
  const invitation = application.latestInvitation;

  return Boolean(
    invitation &&
      invitation.expiresAt &&
      (invitation.status === "created" ||
        invitation.status === "sent" ||
        invitation.status === "opened") &&
      new Date(invitation.expiresAt).getTime() < Date.now(),
  );
}

function canCancelInvitation(application: CandidateApplication) {
  return (
    !isExpired(application) &&
    (application.latestInvitation?.status === "created" ||
      application.latestInvitation?.status === "sent" ||
      application.latestInvitation?.status === "opened")
  );
}

function canResendInvitation(application: CandidateApplication) {
  const invitation = application.latestInvitation;

  return Boolean(
    invitation &&
      application.job &&
      application.candidate.email &&
      application.status === "invited" &&
      invitation.status !== "started" &&
      invitation.status !== "completed",
  );
}

function hasReport(application: CandidateApplication) {
  return (
    application.status === "completed" ||
    application.overallScore !== null ||
    application.fitScore !== null ||
    application.compositeScore !== null ||
    application.requiresReview
  );
}

export function CandidateApplicationsTable({
  applications,
  mayManage,
  returnTo,
  showJob = false,
}: {
  applications: CandidateApplication[];
  mayManage: boolean;
  returnTo: string;
  showJob?: boolean;
}) {
  if (applications.length === 0) {
    return (
      <EmptyState
        description="Добавьте кандидата, чтобы отправить приглашение на оценку."
        title="Кандидатов пока нет"
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Кандидат</th>
            {showJob ? <th className="px-4 py-3 font-medium">Вакансия</th> : null}
            <th className="px-4 py-3 font-medium">Статус</th>
            <th className="px-4 py-3 font-medium">Результат</th>
            <th className="px-4 py-3 font-medium">Приглашение</th>
            <th className="px-4 py-3 text-right font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {applications.map((application) => {
            const invitation = application.latestInvitation;

            return (
              <tr className="border-t align-top" key={application.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{application.candidate.fullName}</p>
                  <p className="text-muted-foreground">{application.candidate.email ?? "Email не указан"}</p>
                  {application.candidate.phone ? (
                    <p className="text-muted-foreground">{application.candidate.phone}</p>
                  ) : null}
                </td>
                {showJob ? (
                  <td className="px-4 py-3">
                    {application.job ? (
                      <Link className="font-medium hover:underline" href={`/dashboard/jobs/${application.job.id}`}>
                        {application.job.title}
                      </Link>
                    ) : (
                      "Вакансия недоступна"
                    )}
                  </td>
                ) : null}
                <td className="px-4 py-3">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                    {APPLICATION_STATUS_LABELS[application.status]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {application.overallScore !== null ||
                  application.fitScore !== null ||
                  application.compositeScore !== null ||
                  application.requiresReview ||
                  application.recommendation ? (
                    <>
                      <p>
                        Overall: {application.overallScore !== null ? `${application.overallScore}%` : "-"}
                        {" / "}
                        Fit: {application.fitScore !== null ? `${application.fitScore}%` : "-"}
                        {application.compositeScore !== null
                          ? ` / Composite: ${application.compositeScore}%`
                          : ""}
                      </p>
                      <p className="text-muted-foreground">
                        {application.requiresReview
                          ? "Нужна ручная проверка"
                          : application.recommendation
                            ? RECOMMENDATION_LABELS[application.recommendation] ?? application.recommendation
                            : "Без рекомендации"}
                        {application.riskLevel
                          ? ` / ${RISK_LEVEL_LABELS[application.riskLevel] ?? application.riskLevel}`
                          : ""}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Ожидает завершения</p>
                  )}
                </td>
                <td className="px-4 py-3">
                  {invitation ? (
                    <>
                      <p>
                        {isExpired(application) ? "Истекла" : INVITATION_STATUS_LABELS[invitation.status]}
                      </p>
                      <p className="text-muted-foreground">
                        до {formatDate(invitation.expiresAt) ?? "без срока"}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      {mayManage ? "Не создано" : "Доступно рекрутеру"}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap justify-end gap-2">
                    {hasReport(application) ? (
                      <Link
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                        href={`/dashboard/applications/${application.id}/report`}
                      >
                        Отчет
                      </Link>
                    ) : null}
                    {mayManage ? (
                      <>
                        {invitation && canCancelInvitation(application) ? (
                          <CopyInvitationLinkButton token={invitation.token} />
                        ) : null}
                        {canResendInvitation(application) ? (
                          <form action={resendInvitationAction}>
                            <input name="applicationId" type="hidden" value={application.id} />
                            <input name="returnTo" type="hidden" value={returnTo} />
                            <PendingSubmitButton
                              pendingText="Создаем..."
                              size="sm"
                              type="submit"
                              variant="outline"
                            >
                              Отправить повторно
                            </PendingSubmitButton>
                          </form>
                        ) : null}
                        {invitation && canCancelInvitation(application) ? (
                          <form action={cancelInvitationAction}>
                            <input name="invitationId" type="hidden" value={invitation.id} />
                            <input name="returnTo" type="hidden" value={returnTo} />
                            <Button size="sm" type="submit" variant="ghost">
                              Отменить
                            </Button>
                          </form>
                        ) : null}
                        {!canResendInvitation(application) &&
                        !canCancelInvitation(application) &&
                        application.job &&
                        !hasReport(application) ? (
                          <Link
                            className={buttonVariants({ size: "sm", variant: "outline" })}
                            href={`/dashboard/jobs/${application.job.id}/candidates`}
                          >
                            Открыть вакансию
                          </Link>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
