import { createClient } from "@/lib/supabase/server";

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
    description: record.description,
    durationMinutes: record.duration_minutes,
    id: record.id,
    instructions: record.instructions,
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

export async function listTestTemplates(companyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("test_templates")
    .select(
      "id, title, description, category, is_system, status, created_at, updated_at, test_versions(id, version_number, title, description, instructions, duration_minutes, scoring_type, status, published_at, created_at)",
    )
    .or(`company_id.eq.${companyId},is_system.eq.true`)
    .order("is_system", { ascending: false })
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error("Unable to load test templates.");
  }

  return ((data ?? []) as unknown as TemplateRecord[]).map(normalizeTemplate);
}

export async function getTestTemplatePageData(companyId: string, templateId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("test_templates")
    .select(
      "id, title, description, category, is_system, status, created_at, updated_at, test_versions(id, version_number, title, description, instructions, duration_minutes, scoring_type, status, published_at, created_at)",
    )
    .eq("id", templateId)
    .or(`company_id.eq.${companyId},is_system.eq.true`)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to load test template.");
  }

  return data ? normalizeTemplate(data as unknown as TemplateRecord) : null;
}
