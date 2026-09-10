// Local-only individual-index screening. Full plans remain in the chosen output directory.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { candidates, runBenchmark } from "./perf-index-benchmark.mjs";

function planFacts(plan) {
  const nodes = [];
  function visit(node) {
    nodes.push({ type: node["Node Type"], index: node["Index Name"] ?? null,
      rows: node["Actual Rows"], loops: node["Actual Loops"], removedByFilter: node["Rows Removed by Filter"] ?? 0 });
    for (const child of node.Plans ?? []) visit(child);
  }
  visit(plan.Plan);
  return { nodes, sharedHitBlocks: plan.Plan["Shared Hit Blocks"] ?? 0,
    sharedReadBlocks: plan.Plan["Shared Read Blocks"] ?? 0 };
}

export function summarizePair(report) {
  const result = { candidates: report.candidates, postgres: report.postgres, node: report.node,
    repetitions: report.repetitions, generatedAt: report.generatedAt, sources: report.sources,
    dataset: report.phases.before.dataset,
    addedBytes: report.phases.after.indexes.filter((index) => index.name.startsWith("perf012_"))
      .reduce((total, index) => total + Number(index.bytes), 0), reads: [], writes: [] };
  for (const group of ["reads", "writes"]) {
    for (const before of report.phases.before[group]) {
      const after = report.phases.after[group].find((entry) => entry.name === before.name);
      assert.ok(after);
      if (group === "reads") assert.equal(before.fingerprint, after.fingerprint);
      result[group].push({ name: before.name, sql: before.sql,
        ...(group === "reads" ? { rowCount: before.rowCount, fingerprint: before.fingerprint } : {}),
        before: { warmMs: before.warmMs, ...planFacts(before.plan) },
        after: { warmMs: after.warmMs, ...planFacts(after.plan) } });
    }
  }
  return result;
}

export async function runIsolation({ directory, repetitions = 30, progress = () => {} }) {
  await mkdir(directory, { recursive: true });
  const summary = { generatedAt: new Date().toISOString(),
    scriptSha256: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex"),
    limitations: "Local PGlite partial schema, owner role, no production RLS/triggers/PostgREST. Sequential paired fresh databases; no-index controls expose drift, not a statistical correction. Write proxies do not establish autosave acceptance. Full plans are in adjacent per-run JSON files.",
    runs: [] };
  const selections = [
    { name: "control-start", indexNames: [] },
    ...candidates.map(({ name }) => ({ name, indexNames: [name] })),
    { name: "control-end", indexNames: [] },
  ];
  // Invalidate a previous completed summary before any database setup can fail.
  await writeFile(resolve(directory, "summary.json"), `${JSON.stringify({ ...summary,
    completed: false, expectedRuns: selections.length })}\n`);
  for (const [position, selection] of selections.entries()) {
    progress(`Isolation ${position + 1}/${selections.length}: ${selection.name}`);
    const report = await runBenchmark({ repetitions, indexNames: selection.indexNames, progress });
    await writeFile(resolve(directory, `${selection.name}.json`), `${JSON.stringify(report)}\n`);
    summary.runs.push({ name: selection.name, ...summarizePair(report) });
    // Save progress after each completed pair; an interrupted run cannot look complete.
    await writeFile(resolve(directory, "summary.json"), `${JSON.stringify({ ...summary,
      completed: summary.runs.length === selections.length, expectedRuns: selections.length })}\n`);
  }
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] ?? "artifacts/performance/perf012-isolation");
  const summary = await runIsolation({ directory, progress: console.log });
  console.log(`Completed ${summary.runs.length} paired runs; summary and full plans saved to ${directory}`);
}
