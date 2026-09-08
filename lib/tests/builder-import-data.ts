import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePlatformContext } from "@/lib/admin/context";
import { canManageSystemTests } from "@/lib/admin/constants";
import { measureServerOperation } from "@/lib/observability/server-performance";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  BUILDER_SECTION_SELECT,
  normalizeBuilderSections,
  type BuilderImportSource,
  type SectionRecord,
} from "./builder-data";
import type { BuilderImportRequest, BuilderImportResult } from "./builder-import-contract";

export type BuilderImportScope = { kind: "company"; companyId: string } | { kind: "system" };

// Legacy PostgREST embedded count works without enabling general aggregate queries.
// Only counts cross the DB boundary; no section/question/option content or IDs.
const METADATA_SELECT = "id, version_number, test_templates!inner(id, title), test_sections(questions(count))";

type MetadataRecord = {
  id: string;
  version_number: number;
  test_templates: { id: string; title: string };
  test_sections: Array<{ questions: Array<{ count: number }> }>;
};

function scopeSourceQuery(client: SupabaseClient, select: string, scope: BuilderImportScope, system: boolean) {
  // A grant must belong to the ACTIVE company, even when the JWT belongs to several tenants.
  const query = client.from("test_versions").select(select).eq("status", "published")
    .eq("test_templates.is_system", system);
  if (!system && scope.kind === "company") {
    return query.eq("test_templates.company_id", scope.companyId);
  }
  const systemQuery = query.is("test_templates.company_id", null);
  return scope.kind === "company"
    ? systemQuery.eq("test_templates.status", "active")
        .eq("test_templates.company_system_test_access.company_id", scope.companyId)
    : systemQuery;
}

function withGrant(select: string) {
  return select.replace("test_templates!inner(", "test_templates!inner(company_system_test_access!inner(company_id), ");
}

async function listSources(client: SupabaseClient, scope: BuilderImportScope, currentVersionId: string) {
  const branches = scope.kind === "company" ? [false, true] : [true];
  const results = await Promise.all(branches.map(async system => {
    const records: MetadataRecord[] = [];
    const pageSize = 500;
    for (let offset = 0; ; offset += pageSize) {
      const select = system && scope.kind === "company" ? withGrant(METADATA_SELECT) : METADATA_SELECT;
      const { data, error } = await scopeSourceQuery(client, select, scope, system)
        .neq("id", currentVersionId).order("id").range(offset, offset + pageSize - 1);
      if (error) throw new Error("Unable to load builder import sources.");
      const page = (data ?? []) as unknown as MetadataRecord[];
      records.push(...page);
      if (page.length < pageSize) break;
    }
    return records;
  }));
  return results.flat()
    // Keep the previous eligibility rule: a content-only section is importable too.
    .filter(record => record.test_sections.length > 0)
    .map((record): BuilderImportSource => ({
      templateId: record.test_templates.id,
      versionId: record.id,
      templateTitle: record.test_templates.title,
      versionNumber: record.version_number,
      questionCount: record.test_sections.reduce((sum, section) => sum + (section.questions[0]?.count ?? 0), 0),
    }))
    .sort((left, right) => left.templateTitle.localeCompare(right.templateTitle, "ru")
      || right.versionNumber - left.versionNumber || left.versionId.localeCompare(right.versionId));
}

export function getBuilderImportSources(companyId: string, currentVersionId: string) {
  return measureServerOperation("builder.import_sources", async () =>
    listSources(await createClient(), { kind: "company", companyId }, currentVersionId));
}

export function getAdminSystemBuilderImportSources(currentVersionId: string) {
  return measureServerOperation("builder.import_sources", async () => {
    const context = await requirePlatformContext();
    if (!canManageSystemTests(context.role)) return [];
    return listSources(createAdminClient(), { kind: "system" }, currentVersionId);
  });
}

const unavailable = (): BuilderImportResult => ({ ok: false, error: "Источник недоступен или черновик больше нельзя редактировать. Обновите страницу." });

// Auth and role are checked by the server action; every content read also constrains
// target ownership/status, source publication and (for company system tests) the grant.
export async function loadBuilderImportSource(
  client: SupabaseClient, scope: BuilderImportScope, input: BuilderImportRequest,
): Promise<BuilderImportResult> {
  if (input.versionId === input.sourceVersionId) return unavailable();
  let targetQuery = client.from("test_versions")
    .select("id, test_templates!inner(id)")
    .eq("id", input.versionId).eq("test_template_id", input.templateId).eq("status", "draft")
    .eq("test_templates.status", "active").eq("test_templates.is_system", scope.kind === "system");
  targetQuery = scope.kind === "company"
    ? targetQuery.eq("test_templates.company_id", scope.companyId)
    : targetQuery.is("test_templates.company_id", null);
  const target = await targetQuery.maybeSingle();
  if (target.error) throw new Error("Unable to validate builder import target.");
  if (!target.data) return unavailable();

  // Read only metadata to choose the scope; the content query repeats the constraints.
  const source = await client.from("test_templates").select("is_system")
    .eq("id", input.sourceTemplateId).maybeSingle();
  if (source.error) throw new Error("Unable to validate builder import source.");
  if (!source.data || (scope.kind === "system" && !source.data.is_system)) return unavailable();
  const system = source.data.is_system === true;
  const select = `id, test_templates!inner(id), test_sections(${BUILDER_SECTION_SELECT})`;
  const { data, error } = await scopeSourceQuery(client,
    system && scope.kind === "company" ? withGrant(select) : select, scope, system)
    .eq("id", input.sourceVersionId).eq("test_template_id", input.sourceTemplateId).maybeSingle();
  if (error) throw new Error("Unable to load builder import content.");
  if (!data) return unavailable();
  const record = data as unknown as { id: string; test_sections: SectionRecord[] };
  return { ok: true, versionId: record.id, sections: normalizeBuilderSections(record.test_sections) };
}
