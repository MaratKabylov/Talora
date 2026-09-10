import { ListControls } from "@/components/lists/list-controls";
import type { ListParams } from "@/lib/lists/pagination";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCESS_REASON_LABELS, PLATFORM_ROLE_LABELS, type AccessReason, type PlatformRole } from "@/lib/admin/constants";
import { listPlatformAudit } from "@/lib/admin/data";

type Profile = { email: string | null; full_name: string | null };
type Company = { name: string };

function one<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<ListParams> }) {
  const params = await searchParams;
  const page = await listPlatformAudit(params);
  const events = page.items;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Security trail</p>
        <h1 className="text-3xl font-semibold tracking-tight">Журнал аудита</h1>
      </div>

      <ListControls path="/admin/audit" params={params} {...page} count={events.length} search="Действие" company />
      <Card>
        <CardHeader>
          <CardTitle>События platform access</CardTitle>
          <CardDescription>Действия внутренней команды на текущей странице.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Дата</th>
                  <th className="px-4 py-3 font-medium">Сотрудник</th>
                  <th className="px-4 py-3 font-medium">Действие</th>
                  <th className="px-4 py-3 font-medium">Компания</th>
                  <th className="px-4 py-3 font-medium">Причина</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => {
                  const profile = one(event.profiles as Profile | Profile[] | null);
                  const company = one(event.companies as Company | Company[] | null);
                  return (
                    <tr className="border-t align-top" key={event.id}>
                      <td className="px-4 py-3">
                        {new Intl.DateTimeFormat("ru-RU", {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(new Date(event.created_at))}
                      </td>
                      <td className="px-4 py-3">
                        <p>{profile?.full_name ?? profile?.email ?? "Сотрудник"}</p>
                        <p className="text-muted-foreground">
                          {PLATFORM_ROLE_LABELS[event.actor_role as PlatformRole] ?? event.actor_role}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{event.action}</p>
                        <p className="text-muted-foreground">{event.target_type}</p>
                      </td>
                      <td className="px-4 py-3">{company?.name ?? "-"}</td>
                      <td className="px-4 py-3">
                        {event.reason
                          ? ACCESS_REASON_LABELS[event.reason as AccessReason] ?? event.reason
                          : "-"}
                      </td>
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
