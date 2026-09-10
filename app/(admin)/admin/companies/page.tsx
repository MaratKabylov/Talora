import { ListControls } from "@/components/lists/list-controls";
import type { ListParams } from "@/lib/lists/pagination";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  COMPANY_STATUS_LABELS,
  COMPANY_STATUS_VALUES,
  type CompanyStatus,
} from "@/lib/admin/constants";
import { listAdminCompanies } from "@/lib/admin/data";

type SearchParams = Promise<ListParams & { q?: string; status?: string }>;

function validStatus(value: string | undefined): CompanyStatus | "" {
  return COMPANY_STATUS_VALUES.includes(value as CompanyStatus) ? (value as CompanyStatus) : "";
}

function relationCount(value: Array<{ count: number }>) {
  return value[0]?.count ?? 0;
}

export default async function AdminCompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const status = validStatus(params.status);
  const page = await listAdminCompanies({ ...params, status });
  const companies = page.items;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Tenants</p>
        <h1 className="text-3xl font-semibold tracking-tight">Компании</h1>
      </div>

      <ListControls path="/admin/companies" params={params} {...page} count={companies.length} search="Название компании" statuses={COMPANY_STATUS_LABELS} />

      <Card>
        <CardHeader>
          <CardTitle>Организации</CardTitle>
          <CardDescription>На странице: {companies.length}</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          {companies.length === 0 ? (
            <EmptyState description="Компании с такими параметрами не найдены." title="Нет результатов" />
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Компания</th>
                    <th className="px-4 py-3 font-medium">Статус</th>
                    <th className="px-4 py-3 font-medium">Пользователи</th>
                    <th className="px-4 py-3 font-medium">Вакансии</th>
                    <th className="px-4 py-3 font-medium">Отклики</th>
                    <th className="px-4 py-3 font-medium">Создана</th>
                    <th className="px-4 py-3 text-right font-medium">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((company) => (
                    <tr className="border-t" key={company.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{company.name}</p>
                        <p className="text-muted-foreground">
                          {[company.industry, company.city].filter(Boolean).join(" / ") || "Профиль не указан"}
                        </p>
                      </td>
                      <td className="px-4 py-3">{COMPANY_STATUS_LABELS[company.status]}</td>
                      <td className="px-4 py-3">{relationCount(company.company_users)}</td>
                      <td className="px-4 py-3">{relationCount(company.jobs)}</td>
                      <td className="px-4 py-3">{relationCount(company.candidate_applications)}</td>
                      <td className="px-4 py-3">
                        {new Intl.DateTimeFormat("ru-RU").format(new Date(company.created_at))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          className={buttonVariants({ size: "sm", variant: "outline" })}
                          href={`/admin/companies/${company.id}`}
                        >
                          Открыть
                        </Link>
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
