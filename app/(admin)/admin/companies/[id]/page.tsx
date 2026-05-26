import Link from "next/link";
import { notFound } from "next/navigation";

import { FeedbackMessage } from "@/components/feedback-message";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { addCompanyNoteAction, updateCompanyStatusAction } from "@/lib/admin/actions";
import { COMPANY_STATUS_LABELS, canOperateCompanies } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";
import { getAdminCompanyDetail } from "@/lib/admin/data";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<{ error?: string; message?: string }>;
type Named = { full_name?: string | null; email?: string | null; title?: string; name?: string };

function first<T>(relation: T | T[] | null | undefined) {
  return Array.isArray(relation) ? relation[0] ?? null : relation ?? null;
}

export default async function AdminCompanyPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ id }, feedback, context] = await Promise.all([
    params,
    searchParams,
    requirePlatformContext(),
  ]);
  const data = await getAdminCompanyDetail(id);
  if (!data) {
    notFound();
  }
  const mayOperate = canOperateCompanies(context.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Компания / platform access журналируется</p>
          <h1 className="text-3xl font-semibold tracking-tight">{data.company.name}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {COMPANY_STATUS_LABELS[data.company.status]} / создана{" "}
            {new Intl.DateTimeFormat("ru-RU").format(new Date(data.company.created_at))}
          </p>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/admin/companies">
          К компаниям
        </Link>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      {data.company.status === "suspended" ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
          Доступ к изменениям tenant приостановлен
          {data.company.suspension_reason ? `: ${data.company.suspension_reason}` : "."}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Профиль компании</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-6 text-sm">
            <p><span className="text-muted-foreground">BIN/IIN:</span> {data.company.bin_or_iin ?? "-"}</p>
            <p><span className="text-muted-foreground">Отрасль:</span> {data.company.industry ?? "-"}</p>
            <p><span className="text-muted-foreground">Город:</span> {data.company.city ?? "-"}</p>
          </CardContent>
        </Card>

        {mayOperate ? (
          <Card>
            <CardHeader>
              <CardTitle>Управление доступом</CardTitle>
              <CardDescription>Приостановка блокирует tenant-операции, не удаляя данные.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {data.company.status === "active" ? (
                <form action={updateCompanyStatusAction} className="space-y-3">
                  <input name="companyId" type="hidden" value={data.company.id} />
                  <input name="status" type="hidden" value="suspended" />
                  <Textarea name="reason" placeholder="Причина приостановки" required />
                  <Button variant="outline" type="submit">Приостановить компанию</Button>
                </form>
              ) : (
                <form action={updateCompanyStatusAction}>
                  <input name="companyId" type="hidden" value={data.company.id} />
                  <input name="status" type="hidden" value="active" />
                  <Button type="submit">Восстановить доступ</Button>
                </form>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Участники</CardTitle>
          <CardDescription>Пользователи workspace и роли в tenant.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Пользователь</th>
                  <th className="px-4 py-3 font-medium">Роль</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((member) => {
                  const profile = first(member.profiles as Named | Named[] | null);
                  return (
                    <tr className="border-t" key={member.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">
                          {context.role === "platform_analyst" ? "Скрыто для аналитика" : profile?.full_name ?? "Без имени"}
                        </p>
                        {context.role !== "platform_analyst" ? (
                          <p className="text-muted-foreground">{profile?.email ?? "-"}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">{member.role}</td>
                      <td className="px-4 py-3">{member.status}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Последние вакансии</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-6 text-sm">
            {data.jobs.map((job) => (
              <div className="flex justify-between gap-3 rounded-md border p-3" key={job.id}>
                <span className="font-medium">{job.title}</span>
                <span className="text-muted-foreground">{job.status}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Последние кандидаты</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-6 text-sm">
            {data.applications.map((application) => {
              const candidate = first(application.candidates as Named | Named[] | null);
              return (
                <div className="flex items-center justify-between gap-3 rounded-md border p-3" key={application.id}>
                  <div>
                    <p className="font-medium">
                      {context.role === "platform_analyst" ? "PII скрыты" : candidate?.full_name ?? "Кандидат"}
                    </p>
                    <p className="text-muted-foreground">{application.status}</p>
                  </div>
                  <Link
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                    href={`/admin/applications/${application.id}`}
                  >
                    Открыть
                  </Link>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {context.role !== "platform_analyst" ? (
        <Card>
          <CardHeader>
            <CardTitle>Внутренние заметки</CardTitle>
            <CardDescription>Доступны только платформенной команде.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <form action={addCompanyNoteAction} className="space-y-3">
              <input name="companyId" type="hidden" value={data.company.id} />
              <Textarea name="note" placeholder="Контекст обращения или служебная заметка" required />
              <Button type="submit">Добавить заметку</Button>
            </form>
            <div className="space-y-3">
              {data.notes.map((note) => {
                const author = first(note.profiles as Named | Named[] | null);
                return (
                  <div className="rounded-md border p-4 text-sm" key={note.id}>
                    <p>{note.note}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {author?.full_name ?? author?.email ?? "Сотрудник"} /{" "}
                      {new Intl.DateTimeFormat("ru-RU").format(new Date(note.created_at))}
                    </p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
