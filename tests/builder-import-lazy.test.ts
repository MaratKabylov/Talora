import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { createClient } from "@supabase/supabase-js";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import * as richText from "../lib/rich-text.ts";
import * as structured from "../lib/structured-questions.ts";
import * as blocks from "../lib/tests/content-blocks.ts";
import * as roles from "../lib/tests/constants.ts";
import * as adminRoles from "../lib/admin/constants.ts";
import type { BuilderImportRequest } from "../lib/tests/builder-import-contract.ts";
import type { SectionRecord } from "../lib/tests/builder-data.ts";

const id = (n: number) => `fc000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const { outputText } = transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  compileFunction(outputText, ["exports", "require"])(exports, (name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name];
  });
  return exports as T;
}
const performanceStub = { measureServerOperation: (_name: string, fn: () => unknown) => fn() };
const sanitizer = load<typeof import("../lib/rich-text.server.ts")>("../lib/rich-text.server.ts", {
  "server-only": {}, "sanitize-html": sanitizeHtml, "@/lib/rich-text": richText,
});
const builder = load<typeof import("../lib/tests/builder-data.ts")>("../lib/tests/builder-data.ts", {
  "@/lib/supabase/server": {}, "@/lib/observability/server-performance": performanceStub,
  "@/lib/rich-text.server": sanitizer, "./data": {}, "./content-blocks": blocks,
  "../structured-questions": structured,
});

function sections() {
  return [{ id: id(51), title: "Empty section", description: null, order_index: 2,
    settings_json: {}, time_limit_minutes: null, questions: [] },
  { id: id(50), title: "Source section", description: `${richText.RICH_TEXT_PREFIX}<p>Safe</p><script>bad()</script>`,
    order_index: 1, time_limit_minutes: 3, settings_json: { contentBlocks: [{ id: id(60), title: "Instructions",
      orderIndex: 1, positionIndex: 0, description: `${richText.RICH_TEXT_PREFIX}<p>Block</p><img src=x onerror=bad()>` }] },
    questions: [2, 1].map(index => ({ id: id(70 + index), text: `Question ${index}`, question_type: index === 1 ? "single_choice" : "matching",
      description: null, difficulty: "hard", order_index: index, points: "2.5", competency_key: "learning_ability",
      settings_json: index === 1 ? { required: false, incorrectFeedback: "Try again", remediationQuestionId: id(72), shuffleOptions: true }
        : { structuredResponseVersion: 1, matchingScoringMode: "exact" },
      answer_options: [2, 1].map(option => ({ id: id(100 + index * 10 + option), text: `Option ${option}`, match_text: `Target ${option}`,
        order_index: option, points: "1.25", is_correct: option === 1, competency_effect_json: { learning_ability: 2 }, explanation: "Because" })),
    })),
  }];
}
type Template = { id: string; title: string; is_system: boolean; company_id: string | null; status: string; grants: string[] };
type Version = { id: string; test_template_id: string; version_number: number; status: string; test_sections: ReturnType<typeof sections> };

// Uses the real Supabase query builder over synthetic HTTP, not a live RLS/PostgREST run.
// All tenants are visible here deliberately, so explicit active-company filters are required.
function harness() {
  const templates: Template[] = [
    { id: id(10), title: "Own", is_system: false, company_id: id(1), status: "active", grants: [] },
    { id: id(11), title: "Foreign", is_system: false, company_id: id(2), status: "active", grants: [] },
    { id: id(12), title: "Granted", is_system: true, company_id: null, status: "active", grants: [id(1)] },
    { id: id(13), title: "Other company grant", is_system: true, company_id: null, status: "active", grants: [id(2)] },
    { id: id(14), title: "Archived system", is_system: true, company_id: null, status: "archived", grants: [id(1)] },
  ];
  const versions: Version[] = templates.flatMap((template, index) => [{ id: id(20 + index), test_template_id: template.id,
    version_number: 1, status: "published", test_sections: sections() }]);
  versions.push({ id: id(30), test_template_id: id(10), version_number: 2, status: "draft", test_sections: [] },
    { id: id(31), test_template_id: id(12), version_number: 2, status: "draft", test_sections: [] });
  const calls: URL[] = [];
  let fail = false;
  const client = createClient("https://synthetic.supabase.test", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input) => {
      const url = new URL(String(input)); calls.push(url);
      if (fail) return Response.json({ message: "private database error" }, { status: 500 });
      const params = url.searchParams;
      const match = (key: string, value: unknown) => {
        const filter = params.get(key);
        return !filter || (filter.startsWith("neq.") ? String(value) !== filter.slice(4) : String(value) === filter.slice(3));
      };
      if (url.pathname.endsWith("/test_templates")) {
        return Response.json(templates.filter(t => match("id", t.id)).map(t => ({ is_system: t.is_system })));
      }
      assert.ok(url.pathname.endsWith("/test_versions"), url.href);
      const select = params.get("select")!;
      const rows = versions.filter(v => {
        const template = templates.find(t => t.id === v.test_template_id)!;
        return match("id", v.id) && match("test_template_id", v.test_template_id) && match("status", v.status)
          && match("test_templates.is_system", template.is_system) && match("test_templates.company_id", template.company_id)
          && match("test_templates.status", template.status)
          && (!select.includes("company_system_test_access!inner") || template.grants.some(company => match("test_templates.company_system_test_access.company_id", company)));
      }).sort((a, b) => a.id.localeCompare(b.id));
      const offset = Number(params.get("offset") ?? 0);
      return Response.json(rows.slice(offset, offset + Number(params.get("limit") ?? rows.length)).map(v => {
        const template = templates.find(t => t.id === v.test_template_id)!;
        return { id: v.id, version_number: v.version_number, test_templates: { id: template.id, title: template.title },
          test_sections: select.includes("questions(count)") ? v.test_sections.map(s => ({ questions: [{ count: s.questions.length }] })) : v.test_sections };
      }));
    } },
  });
  const data = load<typeof import("../lib/tests/builder-import-data.ts")>("../lib/tests/builder-import-data.ts", {
    "server-only": {}, "@/lib/admin/context": { requirePlatformContext: async () => ({ role: "platform_admin" }) },
    "@/lib/admin/constants": adminRoles, "@/lib/observability/server-performance": performanceStub,
    "@/lib/supabase/admin": { createAdminClient: () => client }, "@/lib/supabase/server": { createClient: async () => client },
    "./builder-data": builder,
  });
  const input: BuilderImportRequest = { templateId: id(10), versionId: id(30), sourceTemplateId: id(12), sourceVersionId: id(22) };
  return { client, data, templates, versions, calls, input, setFailure: () => { fail = true; } };
}

test("builder import metadata is five fields only, counts questions and excludes foreign/unpublished sources", async () => {
  const h = harness();
  h.versions.push({ ...h.versions[0], id: id(40), status: "archived" },
    { ...h.versions[0], id: id(41), test_sections: [] },
    { ...h.versions[0], id: id(42), test_sections: [sections()[0]] });
  const result = await h.data.getBuilderImportSources(id(1), id(30));
  assert.deepEqual(result.map(s => s.versionId).sort(), [id(20), id(22), id(42)].sort());
  for (const source of result) {
    assert.deepEqual(Object.keys(source).sort(), ["templateId", "versionId", "templateTitle", "versionNumber", "questionCount"].sort());
    assert.equal(source.questionCount, source.versionId === id(42) ? 0 : 2);
  }
  assert.equal(h.calls.length, 2);
  for (const call of h.calls) {
    const select = call.searchParams.get("select")!;
    assert.ok(select.includes("questions(count)"));
    assert.doesNotMatch(select, /answer_options|description|settings_json|questions\(id/);
    assert.equal(call.searchParams.get("status"), "eq.published");
  }
});

test("builder metadata pages version rows instead of silently truncating large libraries", async () => {
  const h = harness();
  for (let n = 0; n < 510; n++) h.versions.push({ ...h.versions[0], id: id(1000 + n), version_number: n + 3 });
  assert.equal((await h.data.getBuilderImportSources(id(1), id(30))).length, 512);
  assert.equal(h.calls.length, 3);
  assert.ok(h.calls.some(call => call.searchParams.get("offset") === "500"));
});

test("admin metadata includes only system published versions and excludes the current version", async () => {
  const h = harness();
  assert.deepEqual((await h.data.getAdminSystemBuilderImportSources(id(22))).map(s => s.versionId).sort(), [id(23), id(24)]);
  assert.equal(h.calls.length, 1);
});

test("lazy content reads one selected version and preserves the existing normalized sections", async () => {
  for (const source of [{ template: 10, version: 20 }, { template: 12, version: 22 }]) {
    const h = harness();
    const result = await h.data.loadBuilderImportSource(h.client, { kind: "company", companyId: id(1) },
      { ...h.input, sourceTemplateId: id(source.template), sourceVersionId: id(source.version) });
    assert.ok(result.ok);
    assert.equal(result.versionId, id(source.version));
    assert.deepEqual(result.sections, builder.normalizeBuilderSections(sections() as unknown as SectionRecord[]));
    assert.equal(result.sections[0].questions[0].remediationQuestionId, id(72));
    assert.equal(result.sections[0].questions[0].options[0].points, 1.25);
    assert.equal(result.sections[0].questions[1].isStructured, true);
    assert.equal(result.sections[0].questions[1].matchingScoringMode, "exact");
    assert.equal(result.sections[0].questions[1].options[0].matchText, "Target 1");
    assert.equal(result.sections[0].contentBlocks.length, 1);
    assert.doesNotMatch(result.sections[0].description!, /script|bad/);
    const contentCalls = h.calls.filter(c => c.searchParams.get("select")?.includes("answer_options"));
    assert.equal(contentCalls.length, 1);
    assert.equal(contentCalls[0].searchParams.get("id"), `eq.${id(source.version)}`);
    assert.equal(contentCalls[0].searchParams.get("test_template_id"), `eq.${id(source.template)}`);
    assert.equal(contentCalls[0].searchParams.get("status"), "eq.published");
  }
});

test("content request rejects foreign tenants, other-company grants, archived/draft and mismatched versions", async () => {
  for (const patch of [
    { sourceTemplateId: id(11), sourceVersionId: id(21) },
    { sourceTemplateId: id(13), sourceVersionId: id(23) },
    { sourceTemplateId: id(14), sourceVersionId: id(24) },
    { sourceTemplateId: id(12), sourceVersionId: id(31) },
    { sourceTemplateId: id(10), sourceVersionId: id(22) },
    { sourceVersionId: id(30) }, { templateId: id(11) }, { versionId: id(20) },
  ]) {
    const h = harness();
    assert.equal((await h.data.loadBuilderImportSource(h.client, { kind: "company", companyId: id(1) }, { ...h.input, ...patch })).ok, false);
  }
  for (const mutate of [
    (h: ReturnType<typeof harness>) => { h.templates[0].status = "archived"; },
    (h: ReturnType<typeof harness>) => { h.templates[2].grants = [id(2)]; },
    (h: ReturnType<typeof harness>) => { h.versions[2].status = "archived"; },
  ]) {
    const h = harness(); await h.data.getBuilderImportSources(id(1), id(30)); mutate(h);
    assert.equal((await h.data.loadBuilderImportSource(h.client, { kind: "company", companyId: id(1) }, h.input)).ok, false);
  }
});

test("admin content remains constrained to system sources and a system draft target", async () => {
  const h = harness();
  const input = { ...h.input, templateId: id(12), versionId: id(31) };
  assert.equal((await h.data.loadBuilderImportSource(h.client, { kind: "system" }, input)).ok, true);
  assert.equal((await h.data.loadBuilderImportSource(h.client, { kind: "system" }, h.input)).ok, false);
  assert.equal((await h.data.loadBuilderImportSource(h.client, { kind: "system" }, { ...input, sourceTemplateId: id(10), sourceVersionId: id(20) })).ok, false);
});

test("metadata/content DB failures are explicit, never a successful empty import", async () => {
  const h = harness(); h.setFailure();
  await assert.rejects(h.data.getBuilderImportSources(id(1), id(30)), /Unable to load/);
  await assert.rejects(h.data.loadBuilderImportSource(h.client, { kind: "company", companyId: id(1) }, h.input), /Unable to validate/);
});

test("server actions validate UUIDs, authenticate roles, derive active tenant and sanitize errors", async () => {
  const input = harness().input;
  for (const system of [false, true]) {
    for (const role of system ? [null, "platform_support", "platform_analyst", "platform_owner", "platform_admin"]
      : [null, "viewer", "owner", "admin", "recruiter", "super_admin"]) {
      const calls: unknown[][] = []; let fail = false;
      const client = {};
      const actions = load<typeof import("../lib/tests/builder-import-actions.ts")>("../lib/tests/builder-import-actions.ts", {
        zod: { z }, "@/lib/auth/context": { getAuthContext: async () => role ? { activeCompany: { id: id(1), role } } : null },
        "@/lib/admin/context": { getPlatformContext: async () => role ? { role } : null },
        "@/lib/admin/constants": adminRoles, "./constants": roles,
        "@/lib/observability/server-performance": performanceStub,
        "@/lib/supabase/admin": { createAdminClient: () => client }, "@/lib/supabase/server": { createClient: async () => client },
        "./builder-import-data": { loadBuilderImportSource: async (...args: unknown[]) => {
          calls.push(args); if (fail) throw Error("private database error"); return { ok: true, versionId: input.sourceVersionId, sections: [] };
        } },
      });
      const action = system ? actions.loadSystemBuilderImportSourceAction : actions.loadCompanyBuilderImportSourceAction;
      assert.equal((await action({ ...input, sourceVersionId: "invalid" })).ok, false);
      assert.equal(calls.length, 0);
      const allowed = role !== null && !["viewer", "platform_support", "platform_analyst"].includes(role);
      assert.equal((await action({ ...input, companyId: id(2), system: !system })).ok, allowed);
      if (allowed) {
        assert.deepEqual(calls, [[client, system ? { kind: "system" } : { kind: "company", companyId: id(1) }, input]]);
        fail = true; const result = await action(input); assert.equal(result.ok, false);
        assert.doesNotMatch(JSON.stringify(result), /private database/);
      } else assert.equal(calls.length, 0);
    }
  }
});
