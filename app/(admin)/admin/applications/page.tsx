import { ListControls } from "@/components/lists/list-controls";
import type { ListParams } from "@/lib/lists/pagination";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  APPLICATION_STATUS_LABELS,
  RECOMMENDATION_LABELS,
  RISK_LEVEL_LABELS,
} from "@/lib/candidates/constants";
import { listAdminApplications } from "@/lib/admin/data";
import { canViewCandidatePii } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";

type SearchParams = Promise<ListParams & { company?: string; review?: string; status?: string }>;
type RecordRelation = { id?: string; name?: string; title?: string; full_name?: string | null } | null;

function relation<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function AdminApplicationsPage({ searchParams }: { searchParams: SearchParams }) {
  const [params, context] = await Promise.all([searchParams, requirePlatformContext()]);
  const page = await listAdminApplications(params);
  const applications = page.items;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Поддержка и quality review</p>
        <h1 className="text-3xl font-semibold tracking-tight">Кандидаты и оценки</h1>
      </div>

      <ListControls path="/admin/applications" params={params} {...page} count={applications.length} company statuses={APPLICATION_STATUS_LABELS} review />

      <Card>
        <CardHeader>
          <CardTitle>Applications</CardTitle>
          <CardDescription>На странице: {applications.length}</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {applications.length === 0 ? (
            <EmptyState description="По выбранным фильтрам applications не найдены." title="Нет результатов" />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Кандидат</th>
                    <th className="px-4 py-3 font-medium">Компания / вакансия</th>
                    <th className="px-4 py-3 font-medium">Статус</th>
                    <th className="px-4 py-3 font-medium">Результат</th>
                    <th className="px-4 py-3 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {applications.map((application) => {
                    const candidate = relation(application.candidates as RecordRelation);
                    const company = relation(application.companies as RecordRelation);
                    const job = relation(application.jobs as RecordRelation);
                    return (
                      <tr className="border-t align-top" key={application.id}>
                        <td className="px-4 py-3">
                          <p className="font-medium">
                            {canViewCandidatePii(context.role) ? candidate?.full_name ?? "Без имени" : "PII скрыты"}
                          </p>
                          <p className="text-muted-foreground">{application.id}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p>{company?.name ?? "Компания"}</p>
                          <p className="text-muted-foreground">{job?.title ?? "Вакансия"}</p>
                        </td>
                        <td className="px-4 py-3">
                          {APPLICATION_STATUS_LABELS[application.status as keyof typeof APPLICATION_STATUS_LABELS] ?? application.status}
                          {application.requires_review ? (
                            <p className="text-primary">Нужна проверка</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <p>Overall: {application.overall_score ?? "-"} / Fit: {application.fit_score ?? "-"}</p>
                          <p className="text-muted-foreground">
                            {application.recommendation
                              ? RECOMMENDATION_LABELS[application.recommendation] ?? application.recommendation
                              : "Без рекомендации"}
                            {application.risk_level
                              ? ` / ${RISK_LEVEL_LABELS[application.risk_level] ?? application.risk_level}`
                              : ""}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            className={buttonVariants({ size: "sm", variant: "outline" })}
                            href={`/admin/applications/${application.id}`}
                          >
                            Проверить
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
