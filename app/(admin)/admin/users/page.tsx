import { FeedbackMessage } from "@/components/feedback-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateTenantMembershipAction } from "@/lib/admin/actions";
import { canOperateCompanies } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";
import { listAdminUsers } from "@/lib/admin/data";

type SearchParams = Promise<{ error?: string; message?: string }>;
type Company = { id: string; name: string };
type Profile = { email: string | null; full_name: string | null; id: string };

function one<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const [context, users, feedback] = await Promise.all([
    requirePlatformContext(),
    listAdminUsers(),
    searchParams,
  ]);
  const mayManage = canOperateCompanies(context.role);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Tenant access</p>
        <h1 className="text-3xl font-semibold tracking-tight">Пользователи клиентов</h1>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <Card>
        <CardHeader>
          <CardTitle>Memberships</CardTitle>
          <CardDescription>Отключение прекращает доступ пользователя к конкретному workspace.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Пользователь</th>
                  <th className="px-4 py-3 font-medium">Компания</th>
                  <th className="px-4 py-3 font-medium">Роль</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  {mayManage ? <th className="px-4 py-3 text-right font-medium">Действие</th> : null}
                </tr>
              </thead>
              <tbody>
                {users.map((membership) => {
                  const profile = one(membership.profiles as Profile | Profile[] | null);
                  const company = one(membership.companies as Company | Company[] | null);
                  return (
                    <tr className="border-t" key={membership.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{profile?.full_name ?? "Без имени"}</p>
                        <p className="text-muted-foreground">{profile?.email ?? "-"}</p>
                      </td>
                      <td className="px-4 py-3">{company?.name ?? "-"}</td>
                      <td className="px-4 py-3">{membership.role}</td>
                      <td className="px-4 py-3">{membership.status}</td>
                      {mayManage ? (
                        <td className="px-4 py-3 text-right">
                          <form action={updateTenantMembershipAction}>
                            <input name="companyId" type="hidden" value={membership.company_id} />
                            <input name="membershipId" type="hidden" value={membership.id} />
                            <input
                              name="status"
                              type="hidden"
                              value={membership.status === "active" ? "disabled" : "active"}
                            />
                            <Button size="sm" type="submit" variant="outline">
                              {membership.status === "active" ? "Отключить" : "Восстановить"}
                            </Button>
                          </form>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
