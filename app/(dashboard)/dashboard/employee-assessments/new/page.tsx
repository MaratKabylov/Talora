import Link from "next/link";

import { EmployeeAssessmentFields } from "@/components/employee-assessments/employee-assessment-fields";
import { FeedbackMessage } from "@/components/feedback-message";
import { CompetencyWeightsFields } from "@/components/jobs/competency-weights-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import { createEmployeeAssessmentAction } from "@/lib/employee-assessments/actions";
import { canManageEmployeeAssessments } from "@/lib/employee-assessments/constants";
import { listEmployeeAssessmentPackages } from "@/lib/employee-assessments/data";

type NewEmployeeAssessmentSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

export default async function NewEmployeeAssessmentPage({
  searchParams,
}: {
  searchParams: NewEmployeeAssessmentSearchParams;
}) {
  const context = await requireCompanyContext();
  const feedback = await searchParams;
  const packages = await listEmployeeAssessmentPackages(context.activeCompany.id);
  const mayManage = canManageEmployeeAssessments(context.activeCompany.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Новая оценка сотрудников</h1>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/employee-assessments">
          К списку
        </Link>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <Card>
        <CardHeader>
          <CardTitle>Параметры оценки</CardTitle>
          <CardDescription>
            Выберите те же пакеты тестов, которые используются в библиотеке оценок.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form action={createEmployeeAssessmentAction} className="space-y-8">
            <EmployeeAssessmentFields disabled={!mayManage} packages={packages} />
            <div className="space-y-3">
              <div>
                <h2 className="text-sm font-medium">Веса компетенций</h2>
                <p className="text-sm text-muted-foreground">
                  Эти веса используются для fit score внутри оценки сотрудников.
                </p>
              </div>
              <CompetencyWeightsFields disabled={!mayManage} />
            </div>
            {mayManage ? <Button type="submit">Создать оценку</Button> : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
