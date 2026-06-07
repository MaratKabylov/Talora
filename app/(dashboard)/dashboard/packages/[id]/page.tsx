import Link from "next/link";
import { notFound } from "next/navigation";

import { AssessmentPackageFields } from "@/components/packages/assessment-package-fields";
import {
  AssessmentPackageTestsFields,
  AssessmentPackageTestsSummary,
} from "@/components/packages/assessment-package-tests-fields";
import { FeedbackMessage } from "@/components/feedback-message";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import {
  deleteAssessmentPackageAction,
  updateAssessmentPackageAction,
  updateAssessmentPackageTestsAction,
} from "@/lib/packages/actions";
import { canManageAssessmentPackages } from "@/lib/packages/constants";
import { getAssessmentPackagePageData } from "@/lib/packages/data";

type PackageParams = Promise<{ id: string }>;
type PackageSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

export default async function PackagePage({
  params,
  searchParams,
}: {
  params: PackageParams;
  searchParams: PackageSearchParams;
}) {
  const context = await requireCompanyContext();
  const { id } = await params;
  const feedback = await searchParams;
  const data = await getAssessmentPackagePageData(context.activeCompany.id, id);

  if (!data) {
    notFound();
  }

  const mayManage = canManageAssessmentPackages(context.activeCompany.role);
  const isEditable = mayManage && !data.assessmentPackage.isSystem;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{data.assessmentPackage.title}</h1>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {data.assessmentPackage.isSystem ? "Системный" : "Компании"}
            </span>
          </div>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/packages">
          К списку
        </Link>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <Card>
        <CardHeader>
          <CardTitle>Карточка пакета</CardTitle>
          <CardDescription>
            Создан {new Intl.DateTimeFormat("ru-RU").format(new Date(data.assessmentPackage.createdAt))}.
            {data.assessmentPackage.isSystem ? " Системные пакеты доступны только для чтения." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form action={updateAssessmentPackageAction} className="space-y-5">
            <input name="packageId" type="hidden" value={data.assessmentPackage.id} />
            <AssessmentPackageFields
              assessmentPackage={data.assessmentPackage}
              disabled={!isEditable}
            />
            {isEditable ? <Button type="submit">Сохранить карточку</Button> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Тесты в пакете</CardTitle>
          <CardDescription>
            Вес тестов используется для расчета overall score. Сумма весов должна быть 100%.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {isEditable ? (
            <form action={updateAssessmentPackageTestsAction} className="space-y-5">
              <input name="packageId" type="hidden" value={data.assessmentPackage.id} />
              <AssessmentPackageTestsFields
                availableVersions={data.availableVersions}
                selectedTests={data.assessmentPackage.tests}
              />
              <Button type="submit">Сохранить состав пакета</Button>
            </form>
          ) : (
            <AssessmentPackageTestsSummary tests={data.assessmentPackage.tests} />
          )}
        </CardContent>
      </Card>

      {isEditable ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Удаление пакета</CardTitle>
            <CardDescription>
              Удалить можно только пакет компании, который не назначен вакансиям или оценкам сотрудников.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form action={deleteAssessmentPackageAction}>
              <input name="packageId" type="hidden" value={data.assessmentPackage.id} />
              <Button className="border-destructive text-destructive" type="submit" variant="outline">
                Удалить пакет
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
