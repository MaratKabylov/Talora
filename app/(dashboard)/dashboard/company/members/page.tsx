import { EmptyState } from "@/components/empty-state";
import { FeedbackMessage } from "@/components/feedback-message";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { requireCompanyContext } from "@/lib/auth/context";
import {
  disableCompanyMemberAction,
  inviteCompanyMemberAction,
  updateCompanyMemberRoleAction,
} from "@/lib/company/member-actions";
import {
  COMPANY_AUDIT_ACTION_LABELS,
  COMPANY_MEMBER_STATUS_LABELS,
  COMPANY_ROLE_LABELS,
  INVITABLE_COMPANY_ROLE_VALUES,
} from "@/lib/company/members-constants";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<{
  error?: string;
  message?: string;
  organizationId?: string;
}>;

type CompanyMember = {
  created_at: string;
  email: string | null;
  full_name: string | null;
  role: string;
  status: string;
  user_id: string;
};

type CompanyAuditEvent = {
  action: string;
  actor_user_id: string;
  created_at: string;
  id: string;
  metadata_json: Record<string, unknown> | null;
  target_user_id: string | null;
};

function auditDetail(event: CompanyAuditEvent, members: CompanyMember[]) {
  const target = members.find((member) => member.user_id === event.target_user_id);
  const email = target?.email ?? event.metadata_json?.email;
  const role = event.metadata_json?.role ?? event.metadata_json?.toRole;
  const details = [
    typeof email === "string" ? email : null,
    typeof role === "string" ? COMPANY_ROLE_LABELS[role as keyof typeof COMPANY_ROLE_LABELS] ?? role : null,
  ].filter(Boolean);

  return details.join(" - ");
}

export default async function CompanyMembersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [context, params] = await Promise.all([requireCompanyContext(), searchParams]);
  const requestedCompany = context.companies.find(
    (company) => company.id === params.organizationId,
  );
  const selectedCompany = requestedCompany ?? context.activeCompany;
  const ownerCompanies = context.companies.filter((company) => company.role === "owner");
  const mayManage = selectedCompany.role === "owner";
  const inviteCompanyId = mayManage ? selectedCompany.id : ownerCompanies[0]?.id;
  const supabase = await createClient();

  const [membersResult, auditResult] = await Promise.all([
    supabase.rpc("list_company_members", {
      target_company_id: selectedCompany.id,
    }),
    mayManage
      ? supabase
          .from("company_audit_logs")
          .select("id, actor_user_id, action, target_user_id, metadata_json, created_at")
          .eq("company_id", selectedCompany.id)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (membersResult.error) {
    throw new Error("Unable to load company members.");
  }
  if (auditResult.error) {
    throw new Error("Unable to load company audit history.");
  }

  const members = (membersResult.data ?? []) as CompanyMember[];
  const auditEvents = (auditResult.data ?? []) as CompanyAuditEvent[];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">{selectedCompany.name}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Участники компании</h1>
      </div>

      <FeedbackMessage error={params.error} message={params.message} />

      {ownerCompanies.length > 0 && inviteCompanyId ? (
        <Card>
          <CardHeader>
            <CardTitle>Пригласить пользователя</CardTitle>
            <CardDescription>
              Если аккаунт с email уже существует, доступ будет предоставлен сразу. Новому
              пользователю отправится письмо для активации доступа.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              action={inviteCompanyMemberAction}
              className="grid gap-4 lg:grid-cols-[1fr_1fr_210px_auto] lg:items-end"
            >
              <div className="space-y-2">
                <Label htmlFor="companyId">Организация</Label>
                <Select defaultValue={inviteCompanyId} id="companyId" name="companyId">
                  {ownerCompanies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email пользователя</Label>
                <Input autoComplete="email" id="email" name="email" required type="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Роль</Label>
                <Select defaultValue="recruiter" id="role" name="role">
                  {INVITABLE_COMPANY_ROLE_VALUES.map((role) => (
                    <option key={role} value={role}>
                      {COMPANY_ROLE_LABELS[role]}
                    </option>
                  ))}
                </Select>
              </div>
              <PendingSubmitButton pendingText="Отправляем..." type="submit">
                Пригласить
              </PendingSubmitButton>
            </form>
            <p className="mt-4 text-sm text-muted-foreground">
              Владелец организации назначается один раз. Передача владения не выполняется через
              приглашение.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Команда</CardTitle>
          <CardDescription>
            Участники workspace и состояние их доступа к выбранной организации.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {members.length === 0 ? (
            <EmptyState
              description="Участники появятся после завершения настройки компании."
              title="Команда пока пуста"
            />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Участник</th>
                    <th className="px-4 py-3 font-medium">Роль</th>
                    <th className="px-4 py-3 font-medium">Статус</th>
                    <th className="px-4 py-3 font-medium">Добавлен</th>
                    {mayManage ? <th className="px-4 py-3 text-right font-medium">Действия</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr className="border-t align-top" key={member.user_id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{member.full_name ?? "Без имени"}</p>
                        <p className="text-muted-foreground">{member.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        {mayManage && member.role !== "owner" && member.role !== "super_admin" ? (
                          <form action={updateCompanyMemberRoleAction} className="flex items-center gap-2">
                            <input name="companyId" type="hidden" value={selectedCompany.id} />
                            <input name="userId" type="hidden" value={member.user_id} />
                            <Select
                              className="h-9 min-w-36"
                              defaultValue={member.role}
                              name="role"
                            >
                              {INVITABLE_COMPANY_ROLE_VALUES.map((role) => (
                                <option key={role} value={role}>
                                  {COMPANY_ROLE_LABELS[role]}
                                </option>
                              ))}
                            </Select>
                            <Button size="sm" type="submit" variant="outline">
                              Сохранить
                            </Button>
                          </form>
                        ) : (
                          COMPANY_ROLE_LABELS[member.role as keyof typeof COMPANY_ROLE_LABELS] ??
                          member.role
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {COMPANY_MEMBER_STATUS_LABELS[member.status] ?? member.status}
                      </td>
                      <td className="px-4 py-3">
                        {new Intl.DateTimeFormat("ru-RU").format(new Date(member.created_at))}
                      </td>
                      {mayManage ? (
                        <td className="px-4 py-3 text-right">
                          {member.role !== "owner" && member.status !== "disabled" ? (
                            <form action={disableCompanyMemberAction}>
                              <input name="companyId" type="hidden" value={selectedCompany.id} />
                              <input name="userId" type="hidden" value={member.user_id} />
                              <Button size="sm" type="submit" variant="outline">
                                {member.status === "invited" ? "Отозвать" : "Отключить"}
                              </Button>
                            </form>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {mayManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Аудит доступа</CardTitle>
            <CardDescription>
              Последние приглашения и изменения ролей в организации.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-6">
            {auditEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Событий доступа пока нет.</p>
            ) : (
              auditEvents.map((event) => (
                <div className="flex flex-wrap justify-between gap-3 border-b pb-3 text-sm last:border-0" key={event.id}>
                  <div>
                    <p className="font-medium">
                      {COMPANY_AUDIT_ACTION_LABELS[event.action] ?? event.action}
                    </p>
                    {auditDetail(event, members) ? (
                      <p className="text-muted-foreground">{auditDetail(event, members)}</p>
                    ) : null}
                  </div>
                  <p className="text-muted-foreground">
                    {new Intl.DateTimeFormat("ru-RU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(event.created_at))}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
