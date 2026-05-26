import { AdminShell } from "@/components/layout/admin-shell";
import { requirePlatformContext } from "@/lib/admin/context";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const context = await requirePlatformContext();

  return <AdminShell context={context}>{children}</AdminShell>;
}
