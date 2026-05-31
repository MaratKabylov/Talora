import "server-only";

import { createClient } from "@/lib/supabase/server";

export type CompanyTestPermissions = {
  canCreateCustomTests: boolean;
};

type PermissionRecord = {
  can_create_custom_tests: boolean;
};

export async function getCompanyTestPermissions(
  companyId: string,
): Promise<CompanyTestPermissions> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("company_test_permissions")
    .select("can_create_custom_tests")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to load company test permissions.");
  }

  const permissions = data as PermissionRecord | null;
  return {
    canCreateCustomTests: permissions?.can_create_custom_tests ?? false,
  };
}

export async function canCreateCompanyTests(companyId: string) {
  return (await getCompanyTestPermissions(companyId)).canCreateCustomTests;
}
