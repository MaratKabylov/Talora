import Link from "next/link";

import { platformSignOutAction } from "@/lib/auth/actions";
import { PLATFORM_ROLE_LABELS } from "@/lib/admin/constants";
import type { PlatformContext } from "@/lib/admin/context";
import { buttonVariants, Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/admin", label: "Обзор" },
  { href: "/admin/companies", label: "Компании" },
  { href: "/admin/cities", label: "Города" },
  { href: "/admin/applications", label: "Кандидаты" },
  { href: "/admin/tests", label: "Системные тесты" },
  { href: "/admin/assessments", label: "Прохождения" },
  { href: "/admin/users", label: "Пользователи" },
  { href: "/admin/team", label: "Команда" },
  { href: "/admin/audit", label: "Аудит" },
];

export function AdminShell({
  children,
  context,
}: {
  children: React.ReactNode;
  context: PlatformContext;
}) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <div className="flex items-center gap-4">
            <Link className="text-xl font-semibold tracking-tight" href="/admin">
              Talvia Admin
            </Link>
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              {PLATFORM_ROLE_LABELS[context.role]}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link className={buttonVariants({ size: "sm", variant: "outline" })} href="/dashboard">
              HR workspace
            </Link>
            <form action={platformSignOutAction}>
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
            {navigation.map((item) => (
              <Link
                className={cn(buttonVariants({ variant: "ghost" }), "w-full justify-start")}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
