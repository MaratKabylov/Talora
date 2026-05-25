import Link from "next/link";

import { FeedbackMessage } from "@/components/feedback-message";
import { TestTemplateFields } from "@/components/tests/test-template-fields";
import { TestVersionFields } from "@/components/tests/test-version-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import { createTestTemplateAction } from "@/lib/tests/actions";
import { canManageTests } from "@/lib/tests/constants";

type NewTestSearchParams = Promise<{
  error?: string;
}>;

export default async function NewTestPage({
  searchParams,
}: {
  searchParams: NewTestSearchParams;
}) {
  const context = await requireCompanyContext();
  const params = await searchParams;
  const mayManage = canManageTests(context.activeCompany.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Новый тест</h1>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/tests">
          К библиотеке
        </Link>
      </div>

      <FeedbackMessage error={params.error} />

      {!mayManage ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Только просмотр</CardTitle>
            <CardDescription>Ваша роль не позволяет создавать тесты компании.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <form action={createTestTemplateAction} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Карточка теста</CardTitle>
              <CardDescription>
                Шаблон описывает тест как продукт компании; его содержание развивается версиями.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <TestTemplateFields />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Версия 1</CardTitle>
              <CardDescription>
                Первая версия создается как черновик. После публикации изменить ее нельзя.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <TestVersionFields />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit">Создать тест</Button>
          </div>
        </form>
      )}
    </div>
  );
}
