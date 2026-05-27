import { FeedbackMessage } from "@/components/feedback-message";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  PLATFORM_ROLE_LABELS,
  PLATFORM_ROLE_VALUES,
  PLATFORM_STATUS_LABELS,
  canManagePlatformTeam,
  type PlatformRole,
} from "@/lib/admin/constants";
import { invitePlatformUserAction, updatePlatformUserStatusAction } from "@/lib/admin/actions";
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

      {mayManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Пригласить сотрудника</CardTitle>
            <CardDescription>
              Роль сохраняется при отправке приглашения. Доступ откроется после принятия email-ссылки.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={invitePlatformUserAction} className="grid gap-4 md:grid-cols-[1fr_240px_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="email">Рабочий email</Label>
                <Input autoComplete="email" id="email" name="email" required type="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Роль</Label>
                <Select defaultValue="platform_support" id="role" name="role">
                  {PLATFORM_ROLE_VALUES.map((role) => (
                    <option key={role} value={role}>
                      {PLATFORM_ROLE_LABELS[role]}
                    </option>
                  ))}
                </Select>
              </div>
              <PendingSubmitButton pendingText="Отправляем..." type="submit">
                Пригласить
              </PendingSubmitButton>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Platform users</CardTitle>
          <CardDescription>
            Внутренние роли команды платформы и состояние доступа к backoffice.
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
                              value={user.status === "active" || user.status === "invited" ? "disabled" : "active"}
                            />
                            <Button size="sm" type="submit" variant="outline">
                              {user.status === "active"
                                ? "Отключить"
                                : user.status === "invited"
                                  ? "Отозвать"
                                  : "Восстановить"}
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
