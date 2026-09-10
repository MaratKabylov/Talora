import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHash } from "node:crypto";

const { runStagingLists }: { runStagingLists: (env: Record<string, string>, directory: string) => Promise<unknown> } =
  await import(new URL("../scripts/staging-list-acceptance.mjs", import.meta.url).href);

test("staging refuses to overwrite the fixture manifest before any remote access", async () => {
  const directory = await mkdtemp(join(tmpdir(), "talvia-staging-manifest-"));
  const report = join(directory, "report.json");
  const previous = JSON.stringify({ runId: "existing", companies: ["owned-fixture"] });
  await writeFile(report, previous);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected remote request"); };
  try {
    await assert.rejects(runStagingLists({ NEXT_PUBLIC_SUPABASE_URL: "https://fixture.example.invalid",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture" }, directory), { code: "EEXIST" });
    assert.equal(calls, 0);
    assert.equal(await readFile(report, "utf8"), previous);
  } finally {
    globalThis.fetch = originalFetch;
    await unlink(report); await rmdir(directory);
  }
});

test("session staging verifies source ownership and preserves an existing manifest before remote access", async () => {
  const { runSessionAcceptance } = await import(new URL("../scripts/staging-session-acceptance.mjs", import.meta.url).href);
  const directory = await mkdtemp(join(tmpdir(), "talvia-session-manifest-"));
  const source = join(directory, "report.json"), destination = join(directory, "sessions-report.json");
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.example.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture" };
  const previous = JSON.stringify({ fixtures: { session: "owned-fixture" } });
  await writeFile(destination, previous);
  const manifest = { completed: true, companies: [{ id: "a" }, { id: "b" }], runId: "12345678-fixture", prefix: "PERF-STAGING-12345678", projectFingerprint: "wrong-project" };
  await writeFile(source, JSON.stringify(manifest));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected remote request"); };
  try {
    await assert.rejects(runSessionAcceptance(env, source), /source-ownership/);
    manifest.projectFingerprint = createHash("sha256").update(env.NEXT_PUBLIC_SUPABASE_URL).digest("hex");
    await writeFile(source, JSON.stringify(manifest));
    await assert.rejects(runSessionAcceptance(env, source), { code: "EEXIST" });
    assert.equal(calls, 0);
    assert.equal(await readFile(destination, "utf8"), previous);
  } finally {
    globalThis.fetch = originalFetch;
    await unlink(source); await unlink(destination); await rmdir(directory);
  }
});

test("scoring staging verifies source ownership and preserves an existing manifest before remote access", async () => {
  const { runScoringAcceptance } = await import(new URL("../scripts/staging-scoring-acceptance.mjs", import.meta.url).href);
  const directory = await mkdtemp(join(tmpdir(), "talvia-scoring-manifest-"));
  const source = join(directory, "report.json"), destination = join(directory, "scoring-report.json");
  const env = { NEXT_PUBLIC_SUPABASE_URL: "https://fixture.example.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture", SUPABASE_SERVICE_ROLE_KEY: "fixture" };
  const previous = JSON.stringify({ fixtures: { owner: "owned-fixture" } });
  await writeFile(destination, previous);
  const manifest = { completed: true, companies: [{ id: "a" }, { id: "b" }], runId: "12345678-fixture", prefix: "PERF-STAGING-12345678", projectFingerprint: "wrong-project" };
  await writeFile(source, JSON.stringify(manifest));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected remote request"); };
  try {
    await assert.rejects(runScoringAcceptance(env, source, "http://localhost:3020"), /source-ownership/);
    manifest.projectFingerprint = createHash("sha256").update(new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin).digest("hex");
    await writeFile(source, JSON.stringify(manifest));
    await assert.rejects(runScoringAcceptance(env, source, "http://localhost:3020"), { code: "EEXIST" });
    assert.equal(calls, 0);
    assert.equal(await readFile(destination, "utf8"), previous);
  } finally {
    globalThis.fetch = originalFetch;
    await unlink(source); await unlink(destination); await rmdir(directory);
  }
});
