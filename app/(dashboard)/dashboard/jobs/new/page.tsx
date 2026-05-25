import Link from "next/link";

import { FeedbackMessage } from "@/components/feedback-message";
import { CompetencyWeightsFields } from "@/components/jobs/competency-weights-fields";
import { JobDetailsFields } from "@/components/jobs/job-details-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import { createJobAction } from "@/lib/jobs/actions";
import { canManageJobs } from "@/lib/jobs/constants";
import { listAssessmentPackages } from "@/lib/jobs/data";

type NewJobSearchParams = Promise<{
  error?: string;
}>;

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: NewJobSearchParams;
}) {
  const context = await requireCompanyContext();
  const params = await searchParams;
  const packages = await listAssessmentPackages(context.activeCompany.id);
  const mayManage = canManageJobs(context.activeCompany.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Новая вакансия</h1>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/jobs">
          К списку
        </Link>
      </div>

      <FeedbackMessage error={params.error} />

      {!mayManage ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Только просмотр</CardTitle>
            <CardDescription>Ваша роль не позволяет создавать вакансии.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <form action={createJobAction} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Параметры позиции</CardTitle>
              <CardDescription>
                Пакет задает набор тестов, а проходной балл будет применяться при оценке.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <JobDetailsFields packages={packages} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Веса компетенций</CardTitle>
              <CardDescription>
                Вес определяет вклад компетенции в fit score. Сумма весов должна составлять 100%.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <CompetencyWeightsFields />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit">Создать вакансию</Button>
          </div>
        </form>
      )}
    </div>
  );
}
