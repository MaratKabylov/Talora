import Link from "next/link";

import { FeedbackMessage } from "@/components/feedback-message";
import { AssessmentPackageFields } from "@/components/packages/assessment-package-fields";
import { AssessmentPackageTestsFields } from "@/components/packages/assessment-package-tests-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSystemAssessmentPackageAction } from "@/lib/admin/package-actions";
import { canManageSystemAssessmentPackages } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";
import { listAdminPublishedSystemTestVersionOptions } from "@/lib/admin/packages-data";

type SearchParams = Promise<{ error?: string; message?: string }>;

export default async function NewAdminPackagePage({ searchParams }: { searchParams: SearchParams }) {
  const [feedback, context, availableVersions] = await Promise.all([
    searchParams,
    requirePlatformContext(),
    listAdminPublishedSystemTestVersionOptions(),
  ]);
  const mayManage = canManageSystemAssessmentPackages(context.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Библиотека платформы</p>
          <h1 className="text-3xl font-semibold tracking-tight">Новый системный пакет</h1>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/admin/packages">
          К системным пакетам
        </Link>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      {!mayManage ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Только просмотр</CardTitle>
            <CardDescription>
              Ваша роль не позволяет создавать системные пакеты оценки.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <form action={createSystemAssessmentPackageAction} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Карточка пакета</CardTitle>
              <CardDescription>
                Название и описание увидят HR-пользователи в библиотеке пакетов.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <AssessmentPackageFields />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Состав пакета</CardTitle>
              <CardDescription>
                Выберите опубликованные версии системных тестов. Сумма весов тестов, участвующих в
                overall, должна быть 100%.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pt-6">
              <AssessmentPackageTestsFields
                availableVersions={availableVersions}
                emptyText="Нет опубликованных активных системных тестов. Сначала опубликуйте версию системного теста."
              />
              <Button type="submit">Создать системный пакет</Button>
            </CardContent>
          </Card>
        </form>
      )}
    </div>
  );
}
