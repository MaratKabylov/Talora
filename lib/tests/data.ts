import { createClient } from "@/lib/supabase/server";
import { sanitizeRichTextValue } from "@/lib/rich-text.server";

import type { ScoringType, TestTemplateStatus, TestVersionStatus } from "./constants";

type VersionRecord = {
  created_at: string;
  description: string | null;
  duration_minutes: number | null;
  id: string;
  instructions: string | null;
  published_at: string | null;
  scoring_type: ScoringType;
  status: TestVersionStatus;
  title: string;
  version_number: number;
};

type TemplateRecord = {
  category: string | null;
  created_at: string;
  description: string | null;
  id: string;
  is_system: boolean;
  status: TestTemplateStatus;
  test_versions?: VersionRecord[] | null;
  title: string;
  updated_at: string;
};

type SystemTestAccessRecord = {
  test_template_id: string;
};

export type TestVersion = {
  createdAt: string;
  description: string | null;
  durationMinutes: number | null;
  id: string;
  instructions: string | null;
  publishedAt: string | null;
  scoringType: ScoringType;
  status: TestVersionStatus;
  title: string;
  versionNumber: number;
};

export type TestTemplate = {
  category: string | null;
  createdAt: string;
  description: string | null;
  id: string;
  isSystem: boolean;
  latestVersion: TestVersion | null;
  status: TestTemplateStatus;
  title: string;
  updatedAt: string;
  versions: TestVersion[];
};

function normalizeVersion(record: VersionRecord): TestVersion {
  return {
    createdAt: record.created_at,
    description: sanitizeRichTextValue(record.description),
    durationMinutes: record.duration_minutes,
    id: record.id,
    instructions: sanitizeRichTextValue(record.instructions),
    publishedAt: record.published_at,
    scoringType: record.scoring_type,
    status: record.status,
    title: record.title,
    versionNumber: record.version_number,
  };
}

function normalizeTemplate(record: TemplateRecord): TestTemplate {
  const versions = (record.test_versions ?? [])
    .map(normalizeVersion)
    .sort((left, right) => right.versionNumber - left.versionNumber);

  return {
    category: record.category,
    createdAt: record.created_at,
    description: record.description,
    id: record.id,
    isSystem: record.is_system,
    latestVersion: versions[0] ?? null,
    status: record.status,
    title: record.title,
    updatedAt: record.updated_at,
    versions,
  };
}

function sortTemplates(left: TestTemplate, right: TestTemplate) {
  if (left.isSystem !== right.isSystem) {
    return left.isSystem ? -1 : 1;
  }

  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
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

  return ((data ?? []) as SystemTestAccessRecord[]).map((row) => row.test_template_id);
}

function testTemplateSelect() {
  return "id, title, description, category, is_system, status, created_at, updated_at, test_versions(id, version_number, title, description, instructions, duration_minutes, scoring_type, status, published_at, created_at)";
}

export async function listTestTemplates(companyId: string) {
  const supabase = await createClient();
  const systemTemplateIds = await listGrantedSystemTemplateIds(supabase, companyId);
  const [companyTemplatesResult, systemTemplatesResult] = await Promise.all([
    supabase
      .from("test_templates")
      .select(testTemplateSelect())
      .eq("company_id", companyId)
      .eq("is_system", false),
    systemTemplateIds.length > 0
      ? supabase
          .from("test_templates")
          .select(testTemplateSelect())
          .in("id", systemTemplateIds)
          .eq("is_system", true)
          .is("company_id", null)
          .eq("status", "active")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (companyTemplatesResult.error || systemTemplatesResult.error) {
    throw new Error("Unable to load test templates.");
  }

  return [
    ...((systemTemplatesResult.data ?? []) as unknown as TemplateRecord[]),
    ...((companyTemplatesResult.data ?? []) as unknown as TemplateRecord[]),
  ]
    .map(normalizeTemplate)
    .sort(sortTemplates);
}

export async function getTestTemplatePageData(companyId: string, templateId: string) {
  const supabase = await createClient();
  const { data: companyTemplate, error: companyTemplateError } = await supabase
    .from("test_templates")
    .select(testTemplateSelect())
    .eq("id", templateId)
    .eq("company_id", companyId)
    .eq("is_system", false)
    .maybeSingle();

  if (companyTemplateError) {
    throw new Error("Unable to load test template.");
  }

  if (companyTemplate) {
    return normalizeTemplate(companyTemplate as unknown as TemplateRecord);
  }

  const { data: access, error: accessError } = await supabase
    .from("company_system_test_access")
    .select("test_template_id")
    .eq("company_id", companyId)
    .eq("test_template_id", templateId)
    .maybeSingle();

  if (accessError) {
    throw new Error("Unable to load system test access.");
  }

  if (!access) {
    return null;
  }

  const { data: systemTemplate, error: systemTemplateError } = await supabase
    .from("test_templates")
    .select(testTemplateSelect())
    .eq("id", templateId)
    .eq("is_system", true)
    .is("company_id", null)
    .eq("status", "active")
    .maybeSingle();

  if (systemTemplateError) {
    throw new Error("Unable to load test template.");
  }

  return systemTemplate ? normalizeTemplate(systemTemplate as unknown as TemplateRecord) : null;
}
