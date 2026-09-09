import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const id = (n: number) => `fa900000-0000-4000-8000-${String(n).padStart(12, "0")}`;
class Redirect extends Error {
  readonly url: string;
  constructor(url: string) { super("redirect"); this.url = url; }
}

function harness() {
  const calls: { name: string; args: unknown }[] = [], paths: string[] = [], operations: string[] = [];
  let response: { data: unknown; error: unknown } = { data: { versionId: id(40), created: true }, error: null };
  let transportError = false, companyRole = "recruiter", platformRole = "platform_admin";
  const admin = { rpc: async (name: string, args: unknown) => {
    calls.push({ name, args }); if (transportError) throw Error("private transport detail"); return response;
  }, from: () => { throw Error("Clone must not read or write tables through PostgREST"); } };
  const stubs: Record<string, unknown> = {
    "server-only": {},
    "next/cache": { revalidatePath: (path: string) => paths.push(path) },
    "next/navigation": { redirect: (url: string) => { throw new Redirect(url); } },
    "lib/supabase/admin.ts": { createAdminClient: () => admin },
    "lib/supabase/server.ts": { createClient: () => { throw Error("Unexpected session DB call"); } },
    "lib/auth/context.ts": { requireCompanyContext: async () => ({ user: { id: id(3) }, activeCompany: { id: id(1), role: companyRole } }) },
    "lib/admin/context.ts": { requirePlatformContext: async () => ({ user: { id: id(6) }, role: platformRole }) },
    "lib/admin/data.ts": { recordPlatformAudit: () => { throw Error("Audit belongs to the clone transaction"); } },
    "lib/rich-text.server.ts": { sanitizeRichTextValue: (value: unknown) => value },
    "lib/observability/server-performance.ts": { measureServerOperation: async (name: string, task: () => Promise<unknown>) => {
      operations.push(name); return task();
    } },
  };
  const cache = new Map<string, unknown>();
  function load(path: string): unknown {
    const key = relative(root, path).replaceAll("\\", "/");
    if (Object.hasOwn(stubs, key)) return stubs[key];
    if (cache.has(path)) return cache.get(path);
    const loadedModule = { exports: {} }; cache.set(path, loadedModule.exports);
    const { outputText } = transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
    compileFunction(outputText, ["exports", "module", "require", "process"])(loadedModule.exports, loadedModule, (name: string) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name.startsWith(".") || name.startsWith("@/")) {
        const target = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(path), name);
        return load(target.endsWith(".ts") ? target : `${target}.ts`);
      }
      return require(name);
    }, process);
    return loadedModule.exports;
  }
  const company = load(resolve(root, "lib/tests/builder-actions.ts")) as typeof import("../lib/tests/builder-actions.ts");
  const system = load(resolve(root, "lib/admin/test-actions.ts")) as typeof import("../lib/admin/test-actions.ts");
  return { calls, paths, operations,
    company: company.createDraftFromPublishedVersionAction, system: system.createSystemDraftFromPublishedVersionAction,
    response: (data: unknown, error: unknown = null) => { response = { data, error }; },
    disconnect: () => { transportError = true; },
    roles: (company: string, platform: string) => { companyRole = company; platformRole = platform; },
  };
}
const form = () => {
  const value = new FormData(); value.set("templateId", id(10)); value.set("versionId", id(13));
  value.set("companyId", id(999)); value.set("actingUserId", id(999)); return value;
};
async function location(run: () => Promise<unknown>) {
  try { await run(); assert.fail("Action must redirect"); } catch (error) {
    if (!(error instanceof Redirect)) throw error;
    return new URL(error.url, "https://example.test");
  }
}

test("company and system clone actions use one RPC with server actor and open the returned draft", async () => {
  const h = harness();
  for (const scope of ["company", "system"] as const) {
    h.calls.length = 0;
    const url = await location(() => h[scope](form()));
    assert.equal(url.searchParams.get("version"), id(40));
    assert.match(url.searchParams.get("message") ?? "", /Создан новый черновик/);
    assert.deepEqual(h.calls, [{ name: "clone_published_test_version", args: {
      target_template_id: id(10), source_version_id: id(13),
      acting_user_id: id(scope === "company" ? 3 : 6), target_company_id: scope === "company" ? id(1) : null,
    } }]);
  }
  assert.deepEqual(h.operations, ["builder.clone", "builder.clone"]);
  assert.ok(h.paths.includes("/dashboard/tests")); assert.ok(h.paths.includes("/admin/tests"));
});

test("clone retry opens existing draft; missing RPC, invalid receipt and transport errors never fall back", async () => {
  const h = harness();
  h.response({ versionId: id(41), created: false });
  const url = await location(() => h.company(form()));
  assert.equal(url.searchParams.get("version"), id(41));
  assert.equal(url.searchParams.get("message"), "Открыт уже существующий черновик.");
  for (const [data, error] of [[null, { code: "PGRST202", message: "private schema detail" }],
    [null, { message: "TEST_CLONE_INVALID_REFERENCE" }], [null, { message: "TEST_CLONE_SOURCE_NOT_PUBLISHED" }],
    [null, { message: "TEST_CLONE_FORBIDDEN" }], [{ versionId: "bad", created: true }, null]]) {
    h.response(data, error); h.calls.length = 0; h.paths.length = 0;
    const failure = await location(() => h.system(form()));
    assert.ok(failure.searchParams.has("error")); assert.equal(failure.searchParams.get("version"), id(13));
    assert.doesNotMatch(failure.search, /private|TEST_CLONE/); assert.equal(h.calls.length, 1); assert.equal(h.paths.length, 0);
  }
  h.disconnect(); const failure = await location(() => h.company(form()));
  assert.ok(failure.searchParams.has("error")); assert.doesNotMatch(failure.search, /private/);
});

test("clone actions reject disallowed roles and invalid IDs before privileged RPC", async () => {
  const h = harness(); h.roles("viewer", "platform_support");
  for (const scope of ["company", "system"] as const) {
    assert.ok((await location(() => h[scope](form()))).searchParams.has("error"));
    const invalid = form(); invalid.set("versionId", "bad");
    assert.match((await location(() => h[scope](invalid))).pathname, /\/(dashboard|admin)\/tests$/);
  }
  assert.equal(h.calls.length, 0);
});
