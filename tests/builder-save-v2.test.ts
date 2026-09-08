import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileFunction } from "node:vm";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { section } from "../components/tests/builder/builder-document.ts";
import type { BuilderDocumentInput } from "../lib/tests/builder-document-schema.ts";
import type { BuilderSaveRequest, BuilderV2Result } from "../lib/tests/builder-delta.ts";
import type { BuilderSaveState } from "../lib/tests/builder-save-controller.ts";

const root = fileURLToPath(new URL("../", import.meta.url)), require = createRequire(import.meta.url);
function loader(stubs: Record<string, unknown> = {}) {
  const cache = new Map<string, unknown>();
  function load(path: string): unknown {
    if (cache.has(path)) return cache.get(path);
    const loadedModule = { exports: {} }; cache.set(path, loadedModule.exports);
    const { outputText } = transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } });
    compileFunction(outputText, ["exports", "module", "require", "process", "Buffer"])(loadedModule.exports, loadedModule, (name: string) => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      if (name === "server-only") return {};
      if (name.startsWith(".") || name.startsWith("@/")) {
        const target = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(path), name);
        if (existsSync(`${target}.ts`)) return load(`${target}.ts`);
        return require(target);
      }
      return require(name);
    }, process, Buffer);
    return loadedModule.exports;
  }
  return <T>(name: string) => load(resolve(root, name)) as T;
}
const load = loader();
const delta = load<typeof import("../lib/tests/builder-delta.ts")>("lib/tests/builder-delta.ts");
const storage = load<typeof import("../lib/tests/builder-storage-delta.ts")>("lib/tests/builder-storage-delta.ts");
const { createBuilderSaveController } = load<typeof import("../lib/tests/builder-save-controller.ts")>("lib/tests/builder-save-controller.ts");
const id = (n: number) => `fb800000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture(): BuilderDocumentInput {
  const serialize = load<typeof import("../lib/tests/builder-serialize.ts")>("lib/tests/builder-serialize.ts");
  return serialize.serializeBuilderDocument([section("Section A"), section("Section B")], {
    description: "", instructions: "", durationMinutes: "20", scoringType: "points",
    presentationSettings: { allowBack: true, captureQuestionTime: false, presentationMode: "section" },
  }, id(1), id(2), "Version 1");
}
function edit(doc: BuilderDocumentInput, text: string) {
  const next = structuredClone(doc); next.sections[0].questions[0].options[0].text = text; return next;
}
const ack = (revision: string): BuilderV2Result => ({ ok: true, revision, savedAt: "2026-09-08T00:00:00Z" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test("browser delta and storage delta send one option and no unchanged questions", () => {
  const before = fixture(), after = edit(before, "Changed");
  const patch = delta.diffBuilderDocument(before, after), sql = storage.buildStorageDelta(before, after);
  assert.equal(patch.options.length, 1); assert.equal(sql.options.length, 1);
  for (const diff of [patch, sql]) { assert.equal(diff.questions.length, 0); assert.equal(diff.sections.length, 0); assert.equal(diff.version, null); }
  assert.deepEqual(delta.applyBuilderDelta(before, patch), after);
  assert.equal(delta.builderDeltaIsEmpty(delta.diffBuilderDocument(before, structuredClone(before))), true);
});
test("delta roundtrip preserves create/copy/move/delete order and explicit child deletion", () => {
  const before = fixture(), after = structuredClone(before);
  const moved = after.sections[0].questions.pop()!; after.sections[1].questions.unshift(moved); after.sections.shift();
  after.sections[0].contentBlocks.push({ id: id(80), title: "Block", description: null, orderIndex: 1, positionIndex: 0 });
  const patch = delta.diffBuilderDocument(before, after);
  assert.deepEqual(delta.applyBuilderDelta(before, patch), after);
  assert.equal(patch.deletedSections.length, 1); assert.equal(patch.deletedQuestions.length, 0);
  patch.questions[0].sectionId = id(999); assert.throws(() => delta.applyBuilderDelta(before, patch), /Родитель/);
});
test("question type changes rewrite dependent options but never unrelated questions", () => {
  const before = fixture(), after = structuredClone(before);
  after.sections[0].questions[0].questionType = "ordering"; after.sections[0].questions[0].isStructured = true;
  const sql = storage.buildStorageDelta(before, after);
  assert.equal(sql.questions.length, 1); assert.equal(sql.options.length, after.sections[0].questions[0].options.length);
  assert.ok(sql.options.every(o => o.is_correct === null && o.points === 0));
});
test("one in-flight save coalesces later edits against the ACK and retains dirty until final confirmation", async () => {
  const initial = fixture(); let latest = edit(initial, "First"); const first = deferred<BuilderV2Result>();
  const calls: BuilderSaveRequest[] = [], states: BuilderSaveState[] = [];
  const controller = createBuilderSaveController({ initial, revision: "7", onState: s => states.push(s),
    save: async input => { calls.push(input); return calls.length === 1 ? first.promise : ack("9"); } });
  controller.changed(); const saving = controller.flush(() => latest);
  assert.equal(controller.flush(() => latest), saving); assert.equal(calls.length, 1);
  latest = edit(initial, "Latest"); controller.changed(); assert.equal(controller.hasUnsaved(), true);
  first.resolve(ack("8")); assert.equal(await saving, true);
  assert.equal(calls.length, 2); assert.equal(calls[1].expectedRevision, "8");
  assert.equal(calls[1].delta.options[0].text, "Latest"); assert.notEqual(calls[0].requestId, calls[1].requestId);
  assert.equal(controller.hasUnsaved(), false); assert.equal(states.at(-1)?.status, "saved");
});
test("bounded retry and manual retry preserve exact request after unknown commit, then send queued edits", async () => {
  const initial = fixture(); let latest = edit(initial, "First"), online = false;
  const calls: BuilderSaveRequest[] = [], waits: number[] = [];
  const controller = createBuilderSaveController({ initial, revision: "7", onState: () => {}, wait: async ms => { waits.push(ms); },
    save: async input => { calls.push(structuredClone(input)); if (!online) throw Error("lost ACK"); return ack(input.expectedRevision === "7" ? "8" : "9"); } });
  controller.changed(); assert.equal(await controller.flush(() => latest), false);
  assert.equal(calls.length, 3); assert.deepEqual(waits, [500, 1000]); assert.equal(controller.hasUnsaved(), true);
  latest = edit(initial, "Queued"); controller.changed(); online = true;
  assert.equal(await controller.flush(() => latest), true);
  assert.deepEqual(calls.slice(0, 4), Array(4).fill(calls[0])); assert.equal(calls[4].delta.options[0].text, "Queued");
});
test("conflict never retries or rebases; invalid input can be fixed; disposal suppresses ACK effects", async () => {
  const initial = fixture(), latest = edit(initial, "Local"); let calls = 0;
  const controller = createBuilderSaveController({ initial, revision: "7", onState: () => {},
    save: async () => { calls++; return { ok: false, code: "conflict", error: "Conflict" }; } });
  controller.changed(); assert.equal(await controller.flush(() => latest), false);
  controller.changed(); assert.equal(await controller.flush(() => latest), false); assert.equal(calls, 1);
  const response = deferred<BuilderV2Result>(), states: BuilderSaveState[] = [];
  const disposable = createBuilderSaveController({ initial, revision: "7", onState: s => states.push(s), save: () => response.promise });
  disposable.changed(); const saving = disposable.flush(() => latest); disposable.dispose(); const count = states.length;
  response.resolve(ack("8")); assert.equal(await saving, false); assert.equal(states.length, count);
  let valid = false;
  const editable = createBuilderSaveController({ initial, revision: "7", onState: () => {},
    save: async () => valid ? ack("8") : { ok: false, code: "invalid", error: "Invalid" } });
  editable.changed(); assert.equal(await editable.flush(() => latest), false); valid = true; editable.changed();
  assert.equal(await editable.flush(() => latest), true);
});
test("oversized batch fails before transport, stays dirty and can be reduced without a stuck retry", async () => {
  const initial = fixture(); let latest = edit(initial, "x".repeat(900000)), calls = 0;
  const controller = createBuilderSaveController({ initial, revision: "7", onState: () => {},
    save: async () => { calls++; return ack("8"); } });
  controller.changed(); assert.equal(await controller.flush(() => latest), false);
  assert.equal(calls, 0); assert.equal(controller.hasUnsaved(), true);
  latest = edit(initial, "Smaller"); controller.changed();
  assert.equal(await controller.flush(() => latest), true); assert.equal(calls, 1);
});

test("server orchestrator validates assembled document, preserves sparse writes and safely resolves retries", async (t) => {
  const previous = process.env.BUILDER_SAVE_V2; process.env.BUILDER_SAVE_V2 = "true";
  try {
    const base = fixture(); base.sections.forEach(s => s.questions.forEach(q => { q.options[0].isCorrect = true; }));
    const raw = storage.builderStorageRows(base);
    const snapshot = { revision: "7", version: { ...raw.version, id: id(2), version_number: 1, status: "draft", created_at: "2026-09-08", published_at: null },
      sections: raw.sections.map(s => ({ ...s, questions: raw.questions.filter(q => q.section_id === s.id)
        .map(q => ({ ...q, answer_options: raw.options.filter(o => o.question_id === q.id) })) })), receipt: null as Record<string, unknown> | null };
    let current = structuredClone(snapshot), error: unknown = null; const calls: { name: string; args: Record<string, unknown> }[] = [];
    const serviceLoad = loader({ "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "read_builder_snapshot_v2") return { data: structuredClone(current), error: null };
      if (error) return { data: null, error };
      return { data: { revision: "8", savedAt: "2026-09-08", published: true }, error: null };
    } }) }, "@/lib/supabase/server": {} });
    const service = serviceLoad<typeof import("../lib/tests/builder-v2-service.ts")>("lib/tests/builder-v2-service.ts");
    const actor = { userId: id(3), companyId: id(4) };
    const request = (): BuilderSaveRequest => ({ templateId: id(1), versionId: id(2), requestId: id(5), expectedRevision: "7",
      delta: delta.diffBuilderDocument(base, edit(base, "Changed")) });
    const reset = () => { current = structuredClone(snapshot); calls.length = 0; error = null; };
    await t.test("one read + one atomic write, with derived scope and only dirty option", async () => {
      reset(); const result = await service.saveBuilderV2(actor, request()); assert.equal(result.ok, true);
      assert.deepEqual(calls.map(c => c.name), ["read_builder_snapshot_v2", "commit_builder_delta_v2"]);
      const write = calls[1].args; assert.equal(write.acting_user_id, actor.userId); assert.equal(write.target_company_id, actor.companyId);
      const changes = write.delta as ReturnType<typeof storage.buildStorageDelta>;
      assert.equal(changes.options.length, 1); assert.equal(changes.questions.length, 0);
      assert.equal(changes.sections.length, 0); assert.match(String(write.client_payload_hash), /^[a-f0-9]{64}$/);
    });
    await t.test("lost ACK returns receipt without trying delta on new base or writing again", async () => {
      reset(); await service.saveBuilderV2(actor, request()); const hash = calls[1].args.client_payload_hash;
      current.revision = "8"; current.receipt = { last_request_id: id(5), last_actor_id: actor.userId,
        last_expected_revision: "7", last_revision: "8", client_payload_hash: hash, saved_at: "2026-09-08" };
      calls.length = 0; assert.equal((await service.saveBuilderV2(actor, request())).ok, true); assert.equal(calls.length, 1);
      current.revision = "9"; const result = await service.saveBuilderV2(actor, request()); assert.equal(!result.ok && result.code, "conflict");
    });
    await t.test("invalid/foreign DTO, domain error, conflict and RPC failure do not fall back", async () => {
      reset(); assert.equal((await service.saveBuilderV2(actor, { ...request(), companyId: id(99) })).ok, false); assert.equal(calls.length, 0);
      for (const expectedRevision of ["invalid", "1.2", "-1", "01", "9223372036854775808"]) {
        assert.equal((await service.saveBuilderV2(actor, { ...request(), expectedRevision })).ok, false);
      }
      assert.equal(calls.length, 0);
      const invalid = request(); invalid.delta.options[0].text = "";
      assert.equal((await service.saveBuilderV2(actor, invalid)).ok, false); assert.equal(calls.length, 0);
      current.revision = "8"; const conflict = await service.saveBuilderV2(actor, request()); assert.equal(!conflict.ok && conflict.code, "conflict");
      reset(); error = { code: "40001", message: "private database detail" };
      const race = await service.saveBuilderV2(actor, request()); assert.equal(!race.ok && race.code, "conflict");
      assert.ok(!JSON.stringify(race).includes("private")); assert.equal(calls.length, 2);
    });
    await t.test("editing an option preserves legacy zero-based/sparse order indexes", async () => {
      reset(); current.sections.forEach(s => { s.order_index = 0; s.title = ` ${s.title} `; s.questions.forEach(q => {
        q.order_index = 0; q.text = ` ${q.text} `; q.answer_options.forEach((o, i) => { o.order_index = i * 10; o.text = ` ${o.text} `; });
      }); });
      assert.equal((await service.saveBuilderV2(actor, request())).ok, true);
      const changes = calls[1].args.delta as ReturnType<typeof storage.buildStorageDelta>;
      assert.equal(changes.options.length, 1); assert.equal(changes.options[0].order_index, 0);
      assert.equal(changes.questions.length, 0); assert.equal(changes.sections.length, 0);
    });
    await t.test("rich text is sanitized, remediation validation is not bypassed by delta", async () => {
      reset(); const after = structuredClone(base); after.sections[0].description = '<!--talora-rich-text-v1--><p>Safe</p><script>alert(1)</script>';
      const req = { ...request(), delta: delta.diffBuilderDocument(base, after) };
      assert.equal((await service.saveBuilderV2(actor, req)).ok, true);
      assert.ok(!JSON.stringify(calls.at(-1)?.args.delta).includes("<script"));
      reset(); after.sections[0].questions[0].remediationQuestionId = id(999);
      assert.equal((await service.saveBuilderV2(actor, { ...request(), delta: delta.diffBuilderDocument(base, after) })).ok, false);
      assert.equal(calls.length, 1);
    });
    await t.test("publication validates stored correctness/scoring then CAS; stale validation never publishes", async () => {
      reset(); const publication = { templateId: id(1), versionId: id(2), requestId: id(6), expectedRevision: "7" };
      assert.equal((await service.publishBuilderV2(actor, publication)).ok, true);
      assert.equal(calls.at(-1)?.name, "publish_builder_version_v2"); assert.equal(calls.at(-1)?.args.expected_revision, "7");
      reset(); current.sections[0].questions[0].answer_options.forEach(o => { o.is_correct = false; });
      assert.equal((await service.publishBuilderV2(actor, publication)).ok, false); assert.equal(calls.length, 1);
      reset(); Object.assign(current.version, { scoring_schema_version: "2.0", assessment_domain: "knowledge", result_shape: "score", scoring_config_json: {} });
      assert.equal((await service.publishBuilderV2(actor, publication)).ok, false); assert.equal(calls.length, 1);
      reset(); error = { code: "40001" }; const conflict = await service.publishBuilderV2(actor, publication);
      assert.equal(!conflict.ok && conflict.code, "conflict"); assert.equal(calls.length, 2);
    });
    await t.test("flag defaults off and disabling V2 never calls V1 or any RPC", async () => {
      reset(); delete process.env.BUILDER_SAVE_V2;
      assert.equal((await service.saveBuilderV2(actor, request())).ok, false); assert.equal(calls.length, 0);
    });
  } finally { if (previous === undefined) delete process.env.BUILDER_SAVE_V2; else process.env.BUILDER_SAVE_V2 = previous; }
});

test("V2 server actions derive actor/scope from auth and gate company/platform roles", async () => {
  const company = { user: { id: id(3) }, activeCompany: { id: id(4), role: "recruiter" } };
  const platform = { user: { id: id(6) }, role: "platform_admin" };
  const actors: unknown[] = [], paths: string[] = [];
  const actionsLoad = loader({
    "@/lib/auth/context": { requireCompanyContext: async () => company },
    "@/lib/admin/context": { requirePlatformContext: async () => platform },
    "@/lib/observability/server-performance": { measureServerOperation: (_name: string, fn: () => unknown) => fn() },
    "next/cache": { revalidatePath: (path: string) => paths.push(path) },
    "./builder-v2-service": { saveBuilderV2: async (actor: unknown) => { actors.push(actor); return ack("8"); },
      publishBuilderV2: async (actor: unknown) => { actors.push(actor); return ack("8"); } },
  });
  const actions = actionsLoad<typeof import("../lib/tests/builder-v2-actions.ts")>("lib/tests/builder-v2-actions.ts");
  const base = fixture(), input = { templateId: id(1), versionId: id(2), expectedRevision: "7", requestId: id(5), delta: delta.diffBuilderDocument(base, edit(base, "Changed")) };
  await actions.saveCompanyBuilderV2Action(input); await actions.saveSystemBuilderV2Action(input);
  assert.deepEqual(actors, [{ userId: id(3), companyId: id(4) }, { userId: id(6), companyId: null }]);
  company.activeCompany.role = "viewer"; platform.role = "platform_support";
  assert.equal((await actions.saveCompanyBuilderV2Action(input)).ok, false);
  assert.equal((await actions.saveSystemBuilderV2Action(input)).ok, false); assert.equal(actors.length, 2);
  company.activeCompany.role = "owner";
  await actions.publishCompanyBuilderV2Action(input); assert.deepEqual(paths, [`/dashboard/tests/${id(1)}`, "/dashboard/tests"]);
});
