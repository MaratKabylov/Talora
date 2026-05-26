import { FeedbackMessage } from "@/components/feedback-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PLATFORM_ROLE_LABELS,
  PLATFORM_STATUS_LABELS,
  canManagePlatformTeam,
  type PlatformRole,
} from "@/lib/admin/constants";
import { updatePlatformUserStatusAction } from "@/lib/admin/actions";
import { listPlatformTeam } from "@/lib/admin/data";

type SearchParams = Promise<{ error?: string; message?: string }>;
type Profile = { email: string | null; full_name: string | null };

function one<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function AdminTeamPage({ searchParams }: { searchParams: SearchParams }) {
  const [{ context, users }, feedback] = await Promise.all([listPlatformTeam(), searchParams]);
  const mayManage = canManagePlatformTeam(context.role);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Backoffice access</p>
        <h1 className="text-3xl font-semibold tracking-tight">Команда платформы</h1>
      </div>

      <FeedbackMessage error={feedback.error} message={feedback.message} />

      <Card>
        <CardHeader>
          <CardTitle>Platform users</CardTitle>
          <CardDescription>
            Добавление новых сотрудников в первом релизе выполняется вручную через защищенную миграцию.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Сотрудник</th>
                  <th className="px-4 py-3 font-medium">Роль</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  {mayManage ? <th className="px-4 py-3 text-right font-medium">Доступ</th> : null}
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const profile = one(user.profiles as Profile | Profile[] | null);
                  return (
                    <tr className="border-t" key={user.user_id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{profile?.full_name ?? "Без имени"}</p>
                        <p className="text-muted-foreground">{profile?.email ?? "-"}</p>
                      </td>
                      <td className="px-4 py-3">
                        {PLATFORM_ROLE_LABELS[user.role as PlatformRole]}
                      </td>
                      <td className="px-4 py-3">
                        {PLATFORM_STATUS_LABELS[user.status as keyof typeof PLATFORM_STATUS_LABELS]}
                      </td>
                      {mayManage ? (
                        <td className="px-4 py-3 text-right">
                          <form action={updatePlatformUserStatusAction}>
                            <input name="userId" type="hidden" value={user.user_id} />
                            <input
                              name="status"
                              type="hidden"
                              value={user.status === "active" ? "disabled" : "active"}
                            />
                            <Button size="sm" type="submit" variant="outline">
                              {user.status === "active" ? "Отключить" : "Восстановить"}
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
