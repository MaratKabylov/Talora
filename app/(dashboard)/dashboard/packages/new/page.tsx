import Link from "next/link";

import { AssessmentPackageFields } from "@/components/packages/assessment-package-fields";
import { AssessmentPackageTestsFields } from "@/components/packages/assessment-package-tests-fields";
import { FeedbackMessage } from "@/components/feedback-message";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import { createAssessmentPackageAction } from "@/lib/packages/actions";
import { canManageAssessmentPackages } from "@/lib/packages/constants";
import { listPublishedTestVersionOptions } from "@/lib/packages/data";

type NewPackageSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

export default async function NewPackagePage({
  searchParams,
}: {
  searchParams: NewPackageSearchParams;
}) {
  const context = await requireCompanyContext();
  const feedback = await searchParams;
  const availableVersions = await listPublishedTestVersionOptions(context.activeCompany.id);
  const mayManage = canManageAssessmentPackages(context.activeCompany.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Новый пакет оценки</h1>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/packages">
          К списку
        </Link>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <form action={createAssessmentPackageAction} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Карточка пакета</CardTitle>
            <CardDescription>
              Пакет будет доступен в вакансиях и оценках сотрудников этой компании.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <AssessmentPackageFields disabled={!mayManage} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Тесты в пакете</CardTitle>
            <CardDescription>
              Отметьте опубликованные версии тестов. Сумма весов включенных тестов должна быть 100%.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <AssessmentPackageTestsFields
              availableVersions={availableVersions}
              disabled={!mayManage}
            />
            {mayManage ? <Button type="submit">Создать пакет</Button> : null}
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
