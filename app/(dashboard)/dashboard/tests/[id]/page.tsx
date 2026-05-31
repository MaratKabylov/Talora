import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { FeedbackMessage } from "@/components/feedback-message";
import { TestTemplateFields } from "@/components/tests/test-template-fields";
import { TestVersionFields } from "@/components/tests/test-version-fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import { createDraftFromPublishedVersionAction } from "@/lib/tests/builder-actions";
import {
  archiveTestDraftVersionAction,
  createTestVersionAction,
  deleteArchivedTestTemplateAction,
  publishTestVersionAction,
  setTestTemplateStatusAction,
  updateTestTemplateAction,
  updateTestVersionAction,
} from "@/lib/tests/actions";
import {
  canManageTests,
  SCORING_TYPE_LABELS,
  TEST_TEMPLATE_STATUS_LABELS,
  TEST_VERSION_STATUS_LABELS,
} from "@/lib/tests/constants";
import { getTestTemplatePageData } from "@/lib/tests/data";

type TestPageParams = Promise<{ id: string }>;
type TestSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

export default async function TestPage({
  params,
  searchParams,
}: {
  params: TestPageParams;
  searchParams: TestSearchParams;
}) {
  const context = await requireCompanyContext();
  const { id } = await params;
  const feedback = await searchParams;
  const template = await getTestTemplatePageData(context.activeCompany.id, id);

  if (!template) {
    notFound();
  }

  const mayManage = canManageTests(context.activeCompany.role);
  const isEditable = mayManage && !template.isSystem && template.status === "active";
  const draftVersion = template.versions.find((version) => version.status === "draft");
  const hasPublishedVersion = template.versions.some((version) => version.status === "published");
  const nextVersionNumber = (template.latestVersion?.versionNumber ?? 0) + 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">{template.title}</h1>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {template.isSystem ? "Системный тест" : TEST_TEMPLATE_STATUS_LABELS[template.status]}
            </span>
          </div>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/tests">
          К библиотеке
        </Link>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <Card>
        <CardHeader>
          <CardTitle>Карточка теста</CardTitle>
          <CardDescription>
            {template.isSystem
              ? "Системный тест защищен от редактирования."
              : "Метаданные шаблона не изменяют уже опубликованные версии."}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form action={updateTestTemplateAction} className="space-y-5">
            <input name="templateId" type="hidden" value={template.id} />
            <TestTemplateFields disabled={!isEditable} template={template} />
            {isEditable ? <Button type="submit">Сохранить карточку</Button> : null}
          </form>
          {!template.isSystem && mayManage ? (
            <form action={setTestTemplateStatusAction} className="mt-5 border-t pt-5">
              <input name="templateId" type="hidden" value={template.id} />
              <input
                name="status"
                type="hidden"
                value={template.status === "active" ? "archived" : "active"}
              />
              <Button type="submit" variant="outline">
                {template.status === "active" ? "Архивировать тест" : "Восстановить тест"}
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Версии теста</CardTitle>
          <CardDescription>
            Кандидат всегда проходит конкретную опубликованную версию теста.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {template.versions.length === 0 ? (
            <EmptyState
              description="Создайте черновую версию, чтобы добавить содержание и затем опубликовать тест."
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
                      <td className="px-4 py-3">
                        {TEST_VERSION_STATUS_LABELS[version.status]}
                      </td>
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
                            href={`/dashboard/tests/${template.id}/builder?version=${version.id}`}
                          >
                            {isEditable && version.status === "draft" ? "Конструктор" : "Preview"}
                          </Link>
                          {isEditable && version.status === "published" && !draftVersion ? (
                            <form action={createDraftFromPublishedVersionAction}>
                              <input name="templateId" type="hidden" value={template.id} />
                              <input name="versionId" type="hidden" value={version.id} />
                              <Button size="sm" type="submit">
                                Редактировать
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

      {template.isSystem ? (
        <Card>
          <CardHeader>
            <CardTitle>Опубликованная системная версия</CardTitle>
            <CardDescription>
              Системные версии публикуются централизованно и не могут быть изменены компанией.
            </CardDescription>
          </CardHeader>
          {template.latestVersion ? (
            <CardContent className="pt-6">
              <TestVersionFields disabled template={template} version={template.latestVersion} />
            </CardContent>
          ) : null}
        </Card>
      ) : isEditable && draftVersion ? (
        <Card>
          <CardHeader>
            <CardTitle>Черновик v{draftVersion.versionNumber}</CardTitle>
            <CardDescription>
              Изменения разрешены до публикации. После публикации версия блокируется.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <form action={updateTestVersionAction} className="space-y-5">
              <input name="templateId" type="hidden" value={template.id} />
              <input name="versionId" type="hidden" value={draftVersion.id} />
              <TestVersionFields template={template} version={draftVersion} />
              <Button type="submit">Сохранить черновик</Button>
            </form>
            <form action={publishTestVersionAction} className="border-t pt-5">
              <input name="templateId" type="hidden" value={template.id} />
              <input name="versionId" type="hidden" value={draftVersion.id} />
              <Button type="submit">Опубликовать версию</Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Публикация необратима: метаданные и содержимое этой версии больше не редактируются.
              </p>
            </form>
            <form action={archiveTestDraftVersionAction}>
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
              Создайте новый черновик, чтобы развивать тест без изменения опубликованных версий.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form action={createTestVersionAction} className="space-y-5">
              <input name="templateId" type="hidden" value={template.id} />
              <TestVersionFields template={template} versionNumber={nextVersionNumber} />
              <Button type="submit">Создать черновую версию</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Редактирование недоступно</CardTitle>
            <CardDescription>
              {template.status === "archived"
                ? "Восстановите тест из архива, чтобы создавать и изменять черновые версии."
                : "Ваша роль позволяет только просматривать данные теста."}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {!template.isSystem ? (
        <Card>
          <CardHeader>
            <CardTitle>Конструктор содержания</CardTitle>
            <CardDescription>
              Добавляйте секции, вопросы, варианты ответа и карту компетенций в черновой версии.
              Опубликованное содержание остается доступным только для preview.
            </CardDescription>
          </CardHeader>
          {template.latestVersion ? (
            <CardContent className="pt-6">
              <Link
                className={buttonVariants()}
                href={`/dashboard/tests/${template.id}/builder?version=${draftVersion?.id ?? template.latestVersion.id}`}
              >
                {draftVersion && isEditable ? "Открыть конструктор" : "Открыть preview"}
              </Link>
            </CardContent>
          ) : null}
        </Card>
      ) : null}

      {!template.isSystem && template.status === "archived" && mayManage ? (
        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle>Удаление из архива</CardTitle>
            <CardDescription>
              {hasPublishedVersion
                ? "Этот тест содержит опубликованную версию и сохраняется для истории оценок кандидатов."
                : "Удаление необратимо: черновые и архивные версии вместе с содержимым будут удалены."}
            </CardDescription>
          </CardHeader>
          {!hasPublishedVersion ? (
            <CardContent className="pt-6">
              <form action={deleteArchivedTestTemplateAction}>
                <input name="templateId" type="hidden" value={template.id} />
                <Button className="border-destructive/40 text-destructive hover:bg-destructive/10" type="submit" variant="outline">
                  Удалить тест навсегда
                </Button>
              </form>
            </CardContent>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
