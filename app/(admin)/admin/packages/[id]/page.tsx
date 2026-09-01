import Link from "next/link";
import { notFound } from "next/navigation";

import { FeedbackMessage } from "@/components/feedback-message";
import { AssessmentPackageFields } from "@/components/packages/assessment-package-fields";
import {
  AssessmentPackageTestsFields,
  AssessmentPackageTestsSummary,
} from "@/components/packages/assessment-package-tests-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  updateSystemAssessmentPackageAction,
  updateSystemAssessmentPackageTestsAction,
} from "@/lib/admin/package-actions";
import { canManageSystemAssessmentPackages } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";
import { getAdminSystemAssessmentPackage } from "@/lib/admin/packages-data";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; message?: string }>;

export default async function AdminPackagePage({
  params,
  searchParams,
}: {
  params: PageParams;
  searchParams: SearchParams;
}) {
  const [{ id }, feedback, context] = await Promise.all([
    params,
    searchParams,
    requirePlatformContext(),
  ]);
  const data = await getAdminSystemAssessmentPackage(id);
  if (!data) {
    notFound();
  }

  const mayManage = canManageSystemAssessmentPackages(context.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Системный пакет оценки</p>
          <h1 className="text-3xl font-semibold tracking-tight">{data.assessmentPackage.title}</h1>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/admin/packages">
          К системным пакетам
        </Link>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <Card>
        <CardHeader>
          <CardTitle>Карточка пакета</CardTitle>
          <CardDescription>
            Создан {new Intl.DateTimeFormat("ru-RU").format(new Date(data.assessmentPackage.createdAt))}.
            Изменения сразу отражаются в библиотеке доступных компаниям пакетов.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form action={updateSystemAssessmentPackageAction} className="space-y-5">
            <input name="packageId" type="hidden" value={data.assessmentPackage.id} />
            <AssessmentPackageFields
              assessmentPackage={data.assessmentPackage}
              disabled={!mayManage}
            />
            {mayManage ? <Button type="submit">Сохранить карточку</Button> : null}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Тесты в пакете</CardTitle>
          <CardDescription>
            Пакет закрепляет конкретные опубликованные версии. Веса тестов, отмеченных для overall,
            должны в сумме составлять 100%.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {mayManage ? (
            <form action={updateSystemAssessmentPackageTestsAction} className="space-y-5">
              <input name="packageId" type="hidden" value={data.assessmentPackage.id} />
              <AssessmentPackageTestsFields
                availableVersions={data.availableVersions}
                emptyText="Нет опубликованных активных системных тестов. Сначала опубликуйте версию системного теста."
                selectedTests={data.assessmentPackage.tests}
              />
              <Button type="submit">Сохранить состав пакета</Button>
            </form>
          ) : (
            <AssessmentPackageTestsSummary tests={data.assessmentPackage.tests} />
          )}
        </CardContent>
      </Card>

      {!mayManage ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Только просмотр</CardTitle>
            <CardDescription>
              Изменять системные пакеты могут владелец платформы и администратор.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
