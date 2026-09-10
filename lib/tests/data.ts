import { listPage, type ListParams, type ListReadQuery } from "@/lib/lists/pagination";
import { TEST_TEMPLATE_LIST_SELECT, normalizeTestTemplateList, type TestTemplateListRecord } from "@/lib/lists/read-models";
import { createClient } from "@/lib/supabase/server";
import { measureServerOperation } from "@/lib/observability/server-performance";
import { sanitizeRichTextValue } from "@/lib/rich-text.server";

import type { ScoringType, TestTemplateStatus, TestVersionStatus } from "./constants";
import {
  normalizePresentationSettings,
  type TestPresentationSettings,
} from "./presentation-settings";

export type VersionRecord = {
  created_at: string;
  description: string | null;
  duration_minutes: number | null;
  id: string;
  instructions: string | null;
  published_at: string | null;
  scoring_type: ScoringType;
  settings_json: unknown;
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

export type TestVersion = {
  createdAt: string;
  description: string | null;
  durationMinutes: number | null;
  id: string;
  instructions: string | null;
  publishedAt: string | null;
  presentationSettings: TestPresentationSettings;
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

export function normalizeVersion(record: VersionRecord): TestVersion {
  return {
    createdAt: record.created_at,
    description: sanitizeRichTextValue(record.description),
    durationMinutes: record.duration_minutes,
    id: record.id,
    instructions: sanitizeRichTextValue(record.instructions),
    publishedAt: record.published_at,
    presentationSettings: normalizePresentationSettings(record.settings_json),
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

function testTemplateSelect() {
  return "id, title, description, category, is_system, status, created_at, updated_at, test_versions(id, version_number, title, description, instructions, duration_minutes, scoring_type, settings_json, status, published_at, created_at)";
}

async function listTestTemplatesUninstrumented(companyId: string, params: ListParams) {
  const supabase = await createClient();
  const page = listPage(["list_company_test_templates", companyId], "updated_at", params);
  const { data, error } = await page.apply((supabase.rpc("list_company_test_templates", { target_company_id: companyId }) as unknown as ListReadQuery)
    .select(TEST_TEMPLATE_LIST_SELECT), { search: "title", kind: "is_system", status: "status" });
  if (error) throw new Error("Unable to load test templates.");
  return page.finish((data ?? []) as unknown as TestTemplateListRecord[], normalizeTestTemplateList);
}

export function listTestTemplates(companyId: string, params: ListParams = {}) {
  return measureServerOperation("tests.list", () => listTestTemplatesUninstrumented(companyId, params));
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
