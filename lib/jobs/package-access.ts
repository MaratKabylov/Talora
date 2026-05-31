import "server-only";

import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type PackageRecord = {
  id: string;
  is_system: boolean;
  title: string;
};

type SystemPackageIdRecord = {
  package_id: string;
};

export type AssessmentPackageOption = {
  id: string;
  isSystem: boolean;
  title: string;
};

export async function listAccessibleSystemPackageIds(
  supabase: SupabaseServerClient,
  companyId: string,
) {
  const { data, error } = await supabase.rpc("get_accessible_system_package_ids", {
    target_company_id: companyId,
  });

  if (error) {
    throw new Error("Unable to load accessible system assessment packages.");
  }

  return ((data ?? []) as SystemPackageIdRecord[]).map((row) => row.package_id);
}

export async function listAccessibleAssessmentPackages(
  supabase: SupabaseServerClient,
  companyId: string,
): Promise<AssessmentPackageOption[]> {
  const systemPackageIds = await listAccessibleSystemPackageIds(supabase, companyId);
  const [companyPackagesResult, systemPackagesResult] = await Promise.all([
    supabase
      .from("assessment_packages")
      .select("id, title, is_system")
      .eq("company_id", companyId)
      .eq("is_system", false)
      .order("title"),
    systemPackageIds.length > 0
      ? supabase
          .from("assessment_packages")
          .select("id, title, is_system")
          .in("id", systemPackageIds)
          .eq("is_system", true)
          .order("title")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (companyPackagesResult.error || systemPackagesResult.error) {
    throw new Error("Unable to load assessment packages.");
  }

  const systemPackages = (systemPackagesResult.data ?? []) as PackageRecord[];
  const companyPackages = (companyPackagesResult.data ?? []) as PackageRecord[];

  return [...systemPackages, ...companyPackages].map((assessmentPackage) => ({
    id: assessmentPackage.id,
    isSystem: assessmentPackage.is_system,
    title: assessmentPackage.title,
  }));
}

export async function isAssessmentPackageAvailable(
  supabase: SupabaseServerClient,
  companyId: string,
  packageId: string | null,
) {
  if (!packageId) {
    return true;
  }

  const { data: companyPackage, error: companyPackageError } = await supabase
    .from("assessment_packages")
    .select("id")
    .eq("id", packageId)
    .eq("company_id", companyId)
    .eq("is_system", false)
    .maybeSingle();

  if (companyPackageError) {
    return false;
  }

  if (companyPackage) {
    return true;
  }

  const systemPackageIds = await listAccessibleSystemPackageIds(supabase, companyId);
  return systemPackageIds.includes(packageId);
}
