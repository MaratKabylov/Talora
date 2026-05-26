import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  COMPANY_STATUS_LABELS,
  COMPANY_STATUS_VALUES,
  type CompanyStatus,
} from "@/lib/admin/constants";
import { listAdminCompanies } from "@/lib/admin/data";

type SearchParams = Promise<{ q?: string; status?: string }>;

function validStatus(value: string | undefined): CompanyStatus | "" {
  return COMPANY_STATUS_VALUES.includes(value as CompanyStatus) ? (value as CompanyStatus) : "";
}

function relationCount(value: Array<{ count: number }>) {
  return value[0]?.count ?? 0;
}

export default async function AdminCompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const status = validStatus(params.status);
  const companies = await listAdminCompanies(params.q, status);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Tenants</p>
        <h1 className="text-3xl font-semibold tracking-tight">Компании</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Поиск и фильтры</CardTitle>
          <CardDescription>Найдите компанию для поддержки или проверки доступа.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form className="flex flex-wrap gap-3">
            <Input className="max-w-sm" defaultValue={params.q ?? ""} name="q" placeholder="Название компании" />
            <Select className="max-w-56" defaultValue={status} name="status">
              <option value="">Все статусы</option>
              {COMPANY_STATUS_VALUES.map((value) => (
                <option key={value} value={value}>
                  {COMPANY_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
            <button className={buttonVariants()} type="submit">
              Применить
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Организации</CardTitle>
          <CardDescription>Найдено: {companies.length}</CardDescription>
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
