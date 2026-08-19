import Link from "next/link";

import { TestImportWizard } from "@/components/tests/test-import-wizard";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { canManageSystemTests } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";

export default async function SystemTestImportPage() {
  const context = await requirePlatformContext();
  const mayImport = canManageSystemTests(context.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Библиотека платформы</p>
          <h1 className="text-3xl font-semibold tracking-tight">Импорт системного теста</h1>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/admin/tests">
          К системным тестам
        </Link>
      </div>

      {mayImport ? <TestImportWizard mode="system" /> : null}
      {!mayImport ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Импорт системных тестов недоступен</CardTitle>
            <CardDescription>
              Требуется платформенная роль владельца или администратора.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
