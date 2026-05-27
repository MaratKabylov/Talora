import Link from "next/link";

import { FeedbackMessage } from "@/components/feedback-message";
import { TestTemplateFields } from "@/components/tests/test-template-fields";
import { TestVersionFields } from "@/components/tests/test-version-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSystemTestTemplateAction } from "@/lib/admin/test-actions";
import { canManageSystemTests } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";

type SearchParams = Promise<{ error?: string }>;

export default async function NewAdminTestPage({ searchParams }: { searchParams: SearchParams }) {
  const [feedback, context] = await Promise.all([searchParams, requirePlatformContext()]);
  const mayManage = canManageSystemTests(context.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Библиотека платформы</p>
          <h1 className="text-3xl font-semibold tracking-tight">Новый системный тест</h1>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/admin/tests">
          К системным тестам
        </Link>
      </div>

      <FeedbackMessage error={feedback.error} />

      {!mayManage ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Только просмотр</CardTitle>
            <CardDescription>Ваша роль не позволяет создавать системные тесты.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <form action={createSystemTestTemplateAction} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Карточка теста</CardTitle>
              <CardDescription>
                Системный тест станет доступен компаниям после публикации версии.
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
                Первая версия создается черновиком для заполнения вопросов в конструкторе.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <TestVersionFields />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit">Создать системный тест</Button>
          </div>
        </form>
      )}
    </div>
  );
}
