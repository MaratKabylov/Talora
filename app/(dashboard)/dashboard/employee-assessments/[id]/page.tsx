import Link from "next/link";
import { notFound } from "next/navigation";

import { EmployeeAssessmentFields } from "@/components/employee-assessments/employee-assessment-fields";
import { EmployeeAssessmentParticipantsTable } from "@/components/employee-assessments/employee-assessment-participants-table";
import { InviteEmployeeForm } from "@/components/employee-assessments/invite-employee-form";
import { FeedbackMessage } from "@/components/feedback-message";
import { CompetencyWeightsFields } from "@/components/jobs/competency-weights-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import {
  updateEmployeeAssessmentAction,
  updateEmployeeAssessmentWeightsAction,
} from "@/lib/employee-assessments/actions";
import {
  canManageEmployeeAssessments,
  EMPLOYEE_ASSESSMENT_STATUS_LABELS,
} from "@/lib/employee-assessments/constants";
import { getEmployeeAssessmentPageData } from "@/lib/employee-assessments/data";

type EmployeeAssessmentParams = Promise<{ id: string }>;
type EmployeeAssessmentSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

export default async function EmployeeAssessmentPage({
  params,
  searchParams,
}: {
  params: EmployeeAssessmentParams;
  searchParams: EmployeeAssessmentSearchParams;
}) {
  const context = await requireCompanyContext();
  const { id } = await params;
  const feedback = await searchParams;
  const data = await getEmployeeAssessmentPageData(context.activeCompany.id, id);

  if (!data) {
    notFound();
  }

  const mayManage = canManageEmployeeAssessments(context.activeCompany.role);
  const mayInvite = mayManage && data.assessment.status === "active";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{data.assessment.title}</h1>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {EMPLOYEE_ASSESSMENT_STATUS_LABELS[data.assessment.status]}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className={buttonVariants()} href={`/dashboard/employee-assessments/${data.assessment.id}/compare`}>
            Сравнить сотрудников
          </Link>
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/employee-assessments">
            К списку
          </Link>
        </div>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <Card>
        <CardHeader>
          <CardTitle>Карточка оценки</CardTitle>
          <CardDescription>
            Создана {new Intl.DateTimeFormat("ru-RU").format(new Date(data.assessment.createdAt))}.
            Пакет оценки: {data.assessment.assessmentPackageTitle ?? "не назначен"}.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form action={updateEmployeeAssessmentAction} className="space-y-5">
            <input name="employeeAssessmentId" type="hidden" value={data.assessment.id} />
            <EmployeeAssessmentFields
              assessment={data.assessment}
              disabled={!mayManage}
              packages={data.packages}
            />
            {mayManage ? <Button type="submit">Сохранить параметры</Button> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Веса компетенций</CardTitle>
          <CardDescription>
            Настройка используется для fit score внутри этой оценки сотрудников. Сумма весов должна быть 100%.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form action={updateEmployeeAssessmentWeightsAction} className="space-y-5">
            <input name="employeeAssessmentId" type="hidden" value={data.assessment.id} />
            <CompetencyWeightsFields disabled={!mayManage} weights={data.weights} />
            {mayManage ? <Button type="submit">Сохранить веса</Button> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Сотрудники</CardTitle>
          <CardDescription>
            Добавьте сотрудников и отправьте персональную ссылку на пакет оценки без создания вакансии.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8 pt-6">
          {mayInvite ? <InviteEmployeeForm employeeAssessmentId={data.assessment.id} /> : null}
          {mayManage && data.assessment.status !== "active" ? (
            <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Чтобы приглашать сотрудников, переведите оценку в статус «Активна».
            </p>
          ) : null}
          <div className="space-y-3">
            <h2 className="text-sm font-medium">Участники оценки</h2>
            <EmployeeAssessmentParticipantsTable
              mayManage={mayManage}
              participants={data.participants}
              returnTo={`/dashboard/employee-assessments/${data.assessment.id}`}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
