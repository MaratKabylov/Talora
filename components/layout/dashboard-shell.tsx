import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { type AuthContext, type CompanyMembership } from "@/lib/auth/context";
import { signOutAction } from "@/lib/auth/actions";
import { selectActiveCompanyAction } from "@/lib/company/actions";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/dashboard", label: "Обзор", ready: true },
  { href: "/dashboard/profile", label: "Профиль", ready: true },
  { href: "/dashboard/company/members", label: "Участники", ready: true },
  { href: "/dashboard/jobs", label: "Вакансии", ready: true },
  { href: "#", label: "Кандидаты", ready: false },
  { href: "#", label: "Тесты", ready: false },
];

type DashboardContext = Omit<AuthContext, "activeCompany"> & {
  activeCompany: CompanyMembership;
};

export function DashboardShell({
  children,
  context,
}: {
  children: React.ReactNode;
  context: DashboardContext;
}) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <Link className="text-xl font-semibold tracking-tight" href="/">
            Talora
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            {context.companies.length > 1 ? (
              <form action={selectActiveCompanyAction} className="flex items-center gap-2">
                <input name="returnTo" type="hidden" value="/dashboard" />
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  defaultValue={context.activeCompany.id}
                  name="companyId"
                >
                  {context.companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
                <Button size="sm" type="submit" variant="outline">
                  Выбрать
                </Button>
              </form>
            ) : (
              <p className="text-sm font-medium">{context.activeCompany.name}</p>
            )}
            <form action={signOutAction}>
              <Button size="sm" type="submit" variant="ghost">
                Выйти
              </Button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-8 px-6 py-8">
        <aside className="hidden w-52 shrink-0 md:block">
          <nav className="space-y-1">
            {navigation.map((item) =>
              item.ready ? (
                <Link
                  className={cn(buttonVariants({ variant: "ghost" }), "w-full justify-start")}
                  href={item.href}
                  key={item.label}
                >
                  {item.label}
                </Link>
              ) : (
                <p className="px-4 py-2 text-sm text-muted-foreground" key={item.label}>
                  {item.label}
                </p>
              ),
            )}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
