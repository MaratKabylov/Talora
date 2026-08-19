import Link from "next/link";

import { TestImportWizard } from "@/components/tests/test-import-wizard";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import { canManageTests } from "@/lib/tests/constants";
import { getCompanyTestPermissions } from "@/lib/tests/permissions";

export default async function TestImportPage() {
  const context = await requireCompanyContext();
  const permissions = await getCompanyTestPermissions(context.activeCompany.id);
  const mayImport =
    canManageTests(context.activeCompany.role) && permissions.canCreateCustomTests;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Импорт теста</h1>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/tests">
          К библиотеке
        </Link>
      </div>

      {mayImport ? <TestImportWizard /> : null}
      {!mayImport ? (
        <Card className="border-dashed">
          <CardHeader>
            <CardTitle>Импорт тестов недоступен</CardTitle>
            <CardDescription>
              Требуется роль с управлением тестами и включенное для компании создание
              пользовательских тестов.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </div>
  );
}
