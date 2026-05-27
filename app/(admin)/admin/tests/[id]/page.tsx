import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { FeedbackMessage } from "@/components/feedback-message";
import { TestTemplateFields } from "@/components/tests/test-template-fields";
import { TestVersionFields } from "@/components/tests/test-version-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  archiveSystemTestDraftVersionAction,
  createSystemDraftFromPublishedVersionAction,
  createSystemTestVersionAction,
  publishSystemTestVersionAction,
  setSystemTestTemplateStatusAction,
  updateSystemTestTemplateAction,
  updateSystemTestVersionAction,
} from "@/lib/admin/test-actions";
import { canManageSystemTests } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";
import { getAdminSystemTest } from "@/lib/admin/tests-data";
import {
  SCORING_TYPE_LABELS,
  TEST_TEMPLATE_STATUS_LABELS,
  TEST_VERSION_STATUS_LABELS,
} from "@/lib/tests/constants";

type PageParams = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; message?: string }>;

export default async function AdminSystemTestPage({
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
  const template = await getAdminSystemTest(id);
  if (!template) {
    notFound();
  }

  const mayManage = canManageSystemTests(context.role);
  const isEditable = mayManage && template.status === "active";
  const draftVersion = template.versions.find((version) => version.status === "draft");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Системный тест</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{template.title}</h1>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {TEST_TEMPLATE_STATUS_LABELS[template.status]}
            </span>
          </div>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/admin/tests">
          К системным тестам
        </Link>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <Card>
        <CardHeader>
          <CardTitle>Карточка теста</CardTitle>
          <CardDescription>
            Метаданные описывают системный тест в библиотеке. Результаты кандидатов сохраняют
            ссылку на конкретную опубликованную версию.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form action={updateSystemTestTemplateAction} className="space-y-5">
            <input name="templateId" type="hidden" value={template.id} />
            <TestTemplateFields disabled={!isEditable} template={template} />
            {isEditable ? <Button type="submit">Сохранить карточку</Button> : null}
          </form>
          {mayManage ? (
            <form action={setSystemTestTemplateStatusAction} className="mt-5 border-t pt-5">
              <input name="templateId" type="hidden" value={template.id} />
              <input
                name="status"
                type="hidden"
                value={template.status === "active" ? "archived" : "active"}
              />
              <Button type="submit" variant="outline">
                {template.status === "active" ? "Архивировать тест" : "Активировать тест"}
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Версии теста</CardTitle>
          <CardDescription>
            Опубликованное содержание неизменяемо. Для правок создавайте новый черновик.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {template.versions.length === 0 ? (
            <EmptyState
              description="Создайте черновую версию, наполните ее в конструкторе и опубликуйте."
              title="Версии пока не созданы"
            />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Версия</th>
                    <th className="px-4 py-3 font-medium">Статус</th>
                    <th className="px-4 py-3 font-medium">Оценка</th>
                    <th className="px-4 py-3 font-medium">Время</th>
                    <th className="px-4 py-3 font-medium">Опубликована</th>
                    <th className="px-4 py-3 text-right font-medium">Содержание</th>
                  </tr>
                </thead>
                <tbody>
                  {template.versions.map((version) => (
                    <tr className="border-t" key={version.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">v{version.versionNumber}</p>
                        <p className="text-muted-foreground">{version.title}</p>
                      </td>
                      <td className="px-4 py-3">{TEST_VERSION_STATUS_LABELS[version.status]}</td>
                      <td className="px-4 py-3">{SCORING_TYPE_LABELS[version.scoringType]}</td>
                      <td className="px-4 py-3">
                        {version.durationMinutes ? `${version.durationMinutes} мин.` : "Не указано"}
                      </td>
                      <td className="px-4 py-3">
                        {version.publishedAt
                          ? new Intl.DateTimeFormat("ru-RU").format(new Date(version.publishedAt))
                          : "Нет"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Link
                            className={buttonVariants({ size: "sm", variant: "outline" })}
                            href={`/admin/tests/${template.id}/builder?version=${version.id}`}
                          >
                            {isEditable && version.status === "draft" ? "Конструктор" : "Preview"}
                          </Link>
                          {isEditable && version.status === "published" && !draftVersion ? (
                            <form action={createSystemDraftFromPublishedVersionAction}>
                              <input name="templateId" type="hidden" value={template.id} />
                              <input name="versionId" type="hidden" value={version.id} />
                              <Button size="sm" type="submit">
                                Новая версия
                              </Button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {isEditable && draftVersion ? (
        <Card>
          <CardHeader>
            <CardTitle>Черновик v{draftVersion.versionNumber}</CardTitle>
            <CardDescription>
              Настройки и вопросы доступны для изменений до публикации.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <form action={updateSystemTestVersionAction} className="space-y-5">
              <input name="templateId" type="hidden" value={template.id} />
              <input name="versionId" type="hidden" value={draftVersion.id} />
              <TestVersionFields template={template} version={draftVersion} />
              <Button type="submit">Сохранить черновик</Button>
            </form>
            <form action={publishSystemTestVersionAction} className="border-t pt-5">
              <input name="templateId" type="hidden" value={template.id} />
              <input name="versionId" type="hidden" value={draftVersion.id} />
              <Button type="submit">Опубликовать версию</Button>
              <p className="mt-2 text-xs text-muted-foreground">
                После публикации метаданные и содержание этой версии нельзя изменить.
              </p>
            </form>
            <form action={archiveSystemTestDraftVersionAction}>
              <input name="templateId" type="hidden" value={template.id} />
              <input name="versionId" type="hidden" value={draftVersion.id} />
              <Button type="submit" variant="outline">
                Архивировать черновик
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : isEditable ? (
        <Card>
          <CardHeader>
            <CardTitle>Новая версия</CardTitle>
            <CardDescription>
              Создайте пустой черновик или используйте действие у опубликованной версии,
              чтобы скопировать ее содержание.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form action={createSystemTestVersionAction} className="space-y-5">
              <input name="templateId" type="hidden" value={template.id} />
              <TestVersionFields template={template} />
              <Button type="submit">Создать пустой черновик</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Редактирование недоступно</CardTitle>
            <CardDescription>
              {template.status === "archived"
                ? "Активируйте системный тест, чтобы развивать его версии."
                : "Ваша роль позволяет просматривать системные тесты без изменений."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {template.latestVersion ? (
        <Card>
          <CardHeader>
            <CardTitle>Конструктор содержания</CardTitle>
            <CardDescription>
              Добавляйте секции, вопросы, ответы и эффекты компетенций в черновой версии.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <Link
              className={buttonVariants()}
              href={`/admin/tests/${template.id}/builder?version=${draftVersion?.id ?? template.latestVersion.id}`}
            >
              {draftVersion && isEditable ? "Открыть конструктор" : "Открыть preview"}
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
