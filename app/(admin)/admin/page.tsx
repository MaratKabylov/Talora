import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { COMPANY_STATUS_LABELS } from "@/lib/admin/constants";
import { getAdminDashboardData } from "@/lib/admin/data";

function percent(part: number, total: number) {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "-";
}

export default async function AdminDashboardPage() {
  const data = await getAdminDashboardData();
  const cards = [
    { label: "Компании", value: data.companies, detail: `${data.activeCompanies} активных` },
    { label: "Пользователи HR", value: data.users, detail: "активные memberships" },
    { label: "Активные вакансии", value: data.activeJobs, detail: "сейчас открыты" },
    { label: "Оценки завершены", value: data.completed, detail: `${data.reviewRequired} требуют проверки` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Внутренний backoffice</p>
          <h1 className="text-3xl font-semibold tracking-tight">Обзор платформы</h1>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/admin/applications?review=true">
          Нужна проверка: {data.reviewRequired}
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader>
              <CardDescription>{card.label}</CardDescription>
              <CardTitle className="text-3xl">{card.value}</CardTitle>
              <p className="text-sm text-muted-foreground">{card.detail}</p>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Воронка приглашений</CardTitle>
            <CardDescription>Операционный срез по приглашениям за весь период.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="flex justify-between text-sm">
              <span>Отправлено / открыто</span>
              <span className="font-medium">{data.funnel.invited}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Начали прохождение</span>
              <span className="font-medium">
                {data.funnel.started} / {percent(data.funnel.started, data.funnel.invited)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span>Завершили</span>
              <span className="font-medium">
                {data.funnel.completed} / {percent(data.funnel.completed, data.funnel.invited)}
              </span>
            </div>
            {data.suspendedCompanies > 0 ? (
              <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm">
                Приостановленных компаний: {data.suspendedCompanies}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Новые компании</CardTitle>
            <CardDescription>Последние зарегистрированные tenants.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-6">
            {data.recentCompanies.map((company) => (
              <div className="flex items-center justify-between gap-3 text-sm" key={company.id}>
                <div>
                  <Link className="font-medium hover:underline" href={`/admin/companies/${company.id}`}>
                    {company.name}
                  </Link>
                  <p className="text-muted-foreground">
                    {new Intl.DateTimeFormat("ru-RU").format(new Date(company.created_at))}
                  </p>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs">
                  {COMPANY_STATUS_LABELS[company.status]}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
