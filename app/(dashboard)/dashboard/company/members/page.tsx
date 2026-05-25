import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

type CompanyMember = {
  created_at: string;
  email: string | null;
  full_name: string | null;
  role: string;
  status: string;
  user_id: string;
};

export default async function CompanyMembersPage() {
  const context = await requireCompanyContext();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_company_members", {
    target_company_id: context.activeCompany.id,
  });

  if (error) {
    throw new Error("Unable to load company members.");
  }

  const members = (data ?? []) as CompanyMember[];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
        <h1 className="text-3xl font-semibold tracking-tight">Участники компании</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Команда</CardTitle>
          <CardDescription>
            Сейчас отображаются участники workspace. Приглашение коллег будет добавлено позже.
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
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr className="border-t" key={member.user_id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{member.full_name ?? "Без имени"}</p>
                        <p className="text-muted-foreground">{member.email}</p>
                      </td>
                      <td className="px-4 py-3">{member.role}</td>
                      <td className="px-4 py-3">{member.status}</td>
                      <td className="px-4 py-3">
                        {new Intl.DateTimeFormat("ru-RU").format(new Date(member.created_at))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
