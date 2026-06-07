import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  INVITATION_STATUS_LABELS,
  RECOMMENDATION_LABELS,
  RISK_LEVEL_LABELS,
} from "@/lib/candidates/constants";
import { cancelEmployeeAssessmentInvitationAction } from "@/lib/employee-assessments/actions";
import {
  EMPLOYEE_PARTICIPANT_STATUS_LABELS,
} from "@/lib/employee-assessments/constants";
import type { EmployeeAssessmentParticipant } from "@/lib/employee-assessments/data";

import { CopyEmployeeInvitationLinkButton } from "./copy-employee-invitation-link-button";

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : null;
}

function isExpired(participant: EmployeeAssessmentParticipant) {
  const invitation = participant.latestInvitation;

  return Boolean(
    invitation &&
      invitation.expiresAt &&
      (invitation.status === "created" ||
        invitation.status === "sent" ||
        invitation.status === "opened") &&
      new Date(invitation.expiresAt).getTime() < Date.now(),
  );
}

function canCancelInvitation(participant: EmployeeAssessmentParticipant) {
  return (
    !isExpired(participant) &&
    (participant.latestInvitation?.status === "created" ||
      participant.latestInvitation?.status === "sent" ||
      participant.latestInvitation?.status === "opened")
  );
}

function hasReport(participant: EmployeeAssessmentParticipant) {
  return (
    participant.status === "completed" ||
    participant.overallScore !== null ||
    participant.fitScore !== null ||
    participant.requiresReview
  );
}

export function EmployeeAssessmentParticipantsTable({
  mayManage,
  participants,
  returnTo,
}: {
  mayManage: boolean;
  participants: EmployeeAssessmentParticipant[];
  returnTo: string;
}) {
  if (participants.length === 0) {
    return (
      <EmptyState
        description="Добавьте сотрудников в оценку, чтобы отправить им персональные ссылки на тестирование."
        title="Сотрудников пока нет"
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Сотрудник</th>
            <th className="px-4 py-3 font-medium">Отдел / должность</th>
            <th className="px-4 py-3 font-medium">Статус</th>
            <th className="px-4 py-3 font-medium">Результат</th>
            <th className="px-4 py-3 font-medium">Приглашение</th>
            <th className="px-4 py-3 text-right font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {participants.map((participant) => {
            const invitation = participant.latestInvitation;

            return (
              <tr className="border-t align-top" key={participant.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{participant.employee.fullName}</p>
                  <p className="text-muted-foreground">{participant.employee.email}</p>
                  {participant.employee.phone ? (
                    <p className="text-muted-foreground">{participant.employee.phone}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <p>{participant.employee.department ?? "Отдел не указан"}</p>
                  <p className="text-muted-foreground">{participant.employee.roleTitle ?? "Должность не указана"}</p>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                    {EMPLOYEE_PARTICIPANT_STATUS_LABELS[participant.status]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {participant.overallScore !== null ||
                  participant.fitScore !== null ||
                  participant.requiresReview ||
                  participant.recommendation ? (
                    <>
                      <p>
                        Overall: {participant.overallScore !== null ? `${participant.overallScore}%` : "-"}
                        {" / "}
                        Fit: {participant.fitScore !== null ? `${participant.fitScore}%` : "-"}
                      </p>
                      <p className="text-muted-foreground">
                        {participant.requiresReview
                          ? "Нужна ручная проверка"
                          : participant.recommendation
                            ? RECOMMENDATION_LABELS[participant.recommendation] ?? participant.recommendation
                            : "Без рекомендации"}
                        {participant.riskLevel
                          ? ` / ${RISK_LEVEL_LABELS[participant.riskLevel] ?? participant.riskLevel}`
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
                      <p>{isExpired(participant) ? "Истекла" : INVITATION_STATUS_LABELS[invitation.status]}</p>
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
                    {hasReport(participant) ? (
                      <Link
                        className={buttonVariants({ size: "sm", variant: "outline" })}
                        href={`/dashboard/employee-assessments/participants/${participant.id}/report`}
                      >
                        Отчет
                      </Link>
                    ) : null}
                    {mayManage && invitation && canCancelInvitation(participant) ? (
                      <>
                        <CopyEmployeeInvitationLinkButton token={invitation.token} />
                        <form action={cancelEmployeeAssessmentInvitationAction}>
                          <input name="invitationId" type="hidden" value={invitation.id} />
                          <input name="returnTo" type="hidden" value={returnTo} />
                          <Button size="sm" type="submit" variant="ghost">
                            Отменить
                          </Button>
                        </form>
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
