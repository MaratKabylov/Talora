import { listAccessibleSystemPackageIds } from "@/lib/jobs/package-access";
import { createClient } from "@/lib/supabase/server";

type Relation<T> = T | T[] | null;

type PackageTestRecord = {
  contributes_to_overall: boolean;
  id: string;
  is_required: boolean;
  order_index: number;
  passing_score: number | null;
  test_version_id: string;
  test_versions: Relation<{
    assessment_domain: string | null;
    duration_minutes: number | null;
    id: string;
    status: string;
    result_shape: string | null;
    scoring_type: string;
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
    published_at: string | null;
    result_shape: string | null;
    scoring_type: string;
    status: string;
    title: string;
    version_number: number;
  }> | null;
  title: string;
};

type SystemAccessRecord = {
  test_template_id: string;
};

export type AssessmentPackageTest = {
  contributesToOverall: boolean;
  durationMinutes: number | null;
  id: string;
  isRequired: boolean;
  orderIndex: number;
  passingScore: number | null;
  templateTitle: string;
  testVersionId: string;
  versionNumber: number;
  versionTitle: string;
  weightPercent: number;
};

export type AssessmentPackage = {
  createdAt: string;
  description: string | null;
  id: string;
  isSystem: boolean;
  tests: AssessmentPackageTest[];
  title: string;
  updatedAt: string;
};

export type PublishedTestVersionOption = {
  assessmentDomain: string | null;
  durationMinutes: number | null;
  isSystem: boolean;
  resultShape: string | null;
  scoringType: string;
  templateId: string;
  templateTitle: string;
  versionId: string;
  versionNumber: number;
  versionTitle: string;
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
  const tests = (record.assessment_package_tests ?? [])
    .map(normalizePackageTest)
    .filter((test): test is AssessmentPackageTest => test !== null)
    .sort((left, right) => left.orderIndex - right.orderIndex);

  return {
    createdAt: record.created_at,
    description: record.description,
    id: record.id,
    isSystem: record.is_system,
    tests,
    title: record.title,
    updatedAt: record.updated_at,
  };
}

function packageSelect() {
  return "id, company_id, title, description, is_system, created_at, updated_at, assessment_package_tests(id, test_version_id, order_index, weight, is_required, passing_score, contributes_to_overall, test_versions(id, title, version_number, duration_minutes, status, scoring_type, assessment_domain, result_shape, test_templates(id, title, is_system)))";
}

async function listGrantedSystemTemplateIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
) {
  const { data, error } = await supabase
    .from("company_system_test_access")
    .select("test_template_id")
    .eq("company_id", companyId);

  if (error) {
    throw new Error("Unable to load system test access.");
  }

  return ((data ?? []) as SystemAccessRecord[]).map((row) => row.test_template_id);
}

export async function listAssessmentPackages(companyId: string) {
  const supabase = await createClient();
  const systemPackageIds = await listAccessibleSystemPackageIds(supabase, companyId);
  const [companyPackagesResult, systemPackagesResult] = await Promise.all([
    supabase
      .from("assessment_packages")
      .select(packageSelect())
      .eq("company_id", companyId)
      .eq("is_system", false)
      .order("updated_at", { ascending: false }),
    systemPackageIds.length > 0
      ? supabase
          .from("assessment_packages")
          .select(packageSelect())
          .in("id", systemPackageIds)
          .eq("is_system", true)
          .order("title")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (companyPackagesResult.error || systemPackagesResult.error) {
    throw new Error("Unable to load assessment packages.");
  }

  return [
    ...((systemPackagesResult.data ?? []) as unknown as PackageRecord[]),
    ...((companyPackagesResult.data ?? []) as unknown as PackageRecord[]),
  ].map(normalizePackage);
}

export async function getAssessmentPackagePageData(companyId: string, packageId: string) {
  const supabase = await createClient();
  const { data: companyPackage, error: companyPackageError } = await supabase
    .from("assessment_packages")
    .select(packageSelect())
    .eq("id", packageId)
    .eq("company_id", companyId)
    .eq("is_system", false)
    .maybeSingle();

  if (companyPackageError) {
    throw new Error("Unable to load assessment package.");
  }

  const availableVersions = await listPublishedTestVersionOptions(companyId);

  if (companyPackage) {
    return {
      availableVersions,
      assessmentPackage: normalizePackage(companyPackage as unknown as PackageRecord),
    };
  }

  const systemPackageIds = await listAccessibleSystemPackageIds(supabase, companyId);
  if (!systemPackageIds.includes(packageId)) {
    return null;
  }

  const { data: systemPackage, error: systemPackageError } = await supabase
    .from("assessment_packages")
    .select(packageSelect())
    .eq("id", packageId)
    .eq("is_system", true)
    .maybeSingle();

  if (systemPackageError) {
    throw new Error("Unable to load assessment package.");
  }

  return systemPackage
    ? {
        availableVersions,
        assessmentPackage: normalizePackage(systemPackage as unknown as PackageRecord),
      }
    : null;
}

export async function listPublishedTestVersionOptions(companyId: string) {
  const supabase = await createClient();
  const systemTemplateIds = await listGrantedSystemTemplateIds(supabase, companyId);
  const [companyTemplatesResult, systemTemplatesResult] = await Promise.all([
    supabase
      .from("test_templates")
      .select("id, title, is_system, test_versions(id, version_number, title, duration_minutes, status, published_at, scoring_type, assessment_domain, result_shape)")
      .eq("company_id", companyId)
      .eq("is_system", false)
      .eq("status", "active")
      .order("title"),
    systemTemplateIds.length > 0
      ? supabase
          .from("test_templates")
          .select("id, title, is_system, test_versions(id, version_number, title, duration_minutes, status, published_at, scoring_type, assessment_domain, result_shape)")
          .in("id", systemTemplateIds)
          .eq("is_system", true)
          .is("company_id", null)
          .eq("status", "active")
          .order("title")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (companyTemplatesResult.error || systemTemplatesResult.error) {
    throw new Error("Unable to load published test versions.");
  }

  return [
    ...((systemTemplatesResult.data ?? []) as unknown as TemplateRecord[]),
    ...((companyTemplatesResult.data ?? []) as unknown as TemplateRecord[]),
  ]
    .flatMap((template) =>
      (template.test_versions ?? [])
        .filter((version) => version.status === "published")
        .map((version) => ({
          assessmentDomain: version.assessment_domain,
          durationMinutes: version.duration_minutes,
          isSystem: template.is_system,
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
      if (left.isSystem !== right.isSystem) {
        return left.isSystem ? -1 : 1;
      }

      const templateOrder = left.templateTitle.localeCompare(right.templateTitle, "ru");
      return templateOrder === 0 ? right.versionNumber - left.versionNumber : templateOrder;
    });
}
