import { DashboardShell } from "@/components/layout/dashboard-shell";
import { requireCompanyContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const context = await requireCompanyContext();

  return <DashboardShell context={context}>{children}</DashboardShell>;
}
