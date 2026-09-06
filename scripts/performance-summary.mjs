import { readFile } from "node:fs/promises";

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return Math.round(sorted[index] * 100) / 100;
}

function parseEvent(line) {
  const start = line.indexOf("{");
  if (start < 0) return null;

  try {
    const value = JSON.parse(line.slice(start));
    return typeof value?.event === "string" && value.event.startsWith("performance.")
      ? value
      : null;
  } catch {
    return null;
  }
}

async function readInput() {
  if (process.argv.length > 2) {
    return (await Promise.all(process.argv.slice(2).map((path) => readFile(path, "utf8")))).join("\n");
  }

  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const input = await readInput();
const events = input.split(/\r?\n/).map(parseEvent).filter(Boolean);
const groups = new Map();

for (const event of events) {
  const label = event.operation ?? event.name ?? "unknown";
  const key = `${event.event}:${label}`;
  const group = groups.get(key) ?? {
    event: event.event,
    failures: 0,
    label,
    values: [],
  };
  const value = event.durationMs ?? event.value;
  if (typeof value === "number" && Number.isFinite(value)) group.values.push(value);
  if (event.outcome === "failure") group.failures += 1;
  groups.set(key, group);
}

const summary = [...groups.values()]
  .map((group) => ({
    count: group.values.length,
    event: group.event,
    failures: group.failures,
    metric: group.label,
    p50: percentile(group.values, 0.5),
    p95: percentile(group.values, 0.95),
  }))
  .sort((left, right) => left.event.localeCompare(right.event) || left.metric.localeCompare(right.metric));

if (summary.length === 0) {
  console.error("Performance events were not found in the supplied logs.");
  process.exitCode = 1;
} else {
  console.table(summary);
}
