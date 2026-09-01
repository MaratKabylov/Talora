import "server-only";

import type {
  AssessmentPackage,
  AssessmentPackageTest,
  PublishedTestVersionOption,
} from "@/lib/packages/data";
import { createAdminClient } from "@/lib/supabase/admin";

import { requirePlatformContext } from "./context";

type Relation<T> = T | T[] | null;

type PackageTestRecord = {
  contributes_to_overall: boolean;
  id: string;
  is_required: boolean;
  order_index: number;
  passing_score: number | null;
  test_version_id: string;
  test_versions: Relation<{
    duration_minutes: number | null;
    id: string;
    test_templates: Relation<{
      id: string;
      is_system: boolean;
      title: string;
    }>;
    title: string;
    version_number: number;
  }>;
  weight: number;
};

type PackageRecord = {
  assessment_package_tests?: PackageTestRecord[] | null;
  company_id: string | null;
  created_at: string;
  description: string | null;
  id: string;
  is_system: boolean;
  title: string;
  updated_at: string;
};

type TemplateRecord = {
  id: string;
  is_system: boolean;
  test_versions?: Array<{
    assessment_domain: string | null;
    duration_minutes: number | null;
    id: string;
    result_shape: string | null;
    scoring_type: string;
    status: string;
    title: string;
    version_number: number;
  }> | null;
  title: string;
};

function related<T>(value: Relation<T>) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function normalizePackageTest(record: PackageTestRecord): AssessmentPackageTest | null {
  const version = related(record.test_versions);
  const template = related(version?.test_templates ?? null);

  if (!version || !template) {
    return null;
  }

  return {
    contributesToOverall: record.contributes_to_overall,
    durationMinutes: version.duration_minutes,
    id: record.id,
    isRequired: record.is_required,
    orderIndex: record.order_index,
    passingScore: record.passing_score,
    templateTitle: template.title,
    testVersionId: record.test_version_id,
    versionNumber: version.version_number,
    versionTitle: version.title,
    weightPercent: Number(record.weight) * 100,
  };
}

function normalizePackage(record: PackageRecord): AssessmentPackage {
  return {
    createdAt: record.created_at,
    description: record.description,
    id: record.id,
    isSystem: record.is_system,
    tests: (record.assessment_package_tests ?? [])
      .map(normalizePackageTest)
      .filter((test): test is AssessmentPackageTest => test !== null)
      .sort((left, right) => left.orderIndex - right.orderIndex),
    title: record.title,
    updatedAt: record.updated_at,
  };
}

function systemPackageQuery() {
  return createAdminClient()
    .from("assessment_packages")
    .select(
      "id, company_id, title, description, is_system, created_at, updated_at, assessment_package_tests(id, test_version_id, order_index, weight, is_required, passing_score, contributes_to_overall, test_versions(id, title, version_number, duration_minutes, scoring_type, assessment_domain, result_shape, test_templates(id, title, is_system)))",
    )
    .eq("is_system", true)
    .is("company_id", null);
}

export async function listAdminSystemAssessmentPackages() {
  await requirePlatformContext();
  const { data, error } = await systemPackageQuery().order("updated_at", { ascending: false });

  if (error) {
    throw new Error("Unable to load system assessment packages.");
  }

  return ((data ?? []) as unknown as PackageRecord[]).map(normalizePackage);
}

export async function listAdminPublishedSystemTestVersionOptions(): Promise<
  PublishedTestVersionOption[]
> {
  await requirePlatformContext();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("test_templates")
    .select(
      "id, title, is_system, test_versions(id, version_number, title, duration_minutes, status, scoring_type, assessment_domain, result_shape)",
    )
    .eq("is_system", true)
    .is("company_id", null)
    .eq("status", "active")
    .order("title");

  if (error) {
    throw new Error("Unable to load published system test versions.");
  }

  return ((data ?? []) as unknown as TemplateRecord[])
    .flatMap((template) =>
      (template.test_versions ?? [])
        .filter((version) => version.status === "published")
        .map((version) => ({
          assessmentDomain: version.assessment_domain,
          durationMinutes: version.duration_minutes,
          isSystem: true,
          resultShape: version.result_shape,
          scoringType: version.scoring_type,
          templateId: template.id,
          templateTitle: template.title,
          versionId: version.id,
          versionNumber: version.version_number,
          versionTitle: version.title,
        })),
    )
    .sort((left, right) => {
      const titleOrder = left.templateTitle.localeCompare(right.templateTitle, "ru");
      return titleOrder === 0 ? right.versionNumber - left.versionNumber : titleOrder;
    });
}

export async function getAdminSystemAssessmentPackage(packageId: string) {
  await requirePlatformContext();
  const [{ data, error }, availableVersions] = await Promise.all([
    systemPackageQuery().eq("id", packageId).maybeSingle(),
    listAdminPublishedSystemTestVersionOptions(),
  ]);

  if (error) {
    throw new Error("Unable to load system assessment package.");
  }

  return data
    ? {
        assessmentPackage: normalizePackage(data as unknown as PackageRecord),
        availableVersions,
      }
    : null;
}
