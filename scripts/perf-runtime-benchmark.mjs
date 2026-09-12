import { mkdir, writeFile } from "node:fs/promises";
import { platform, release } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_SAMPLES = 10;
const TARGET_PATH = "/api/tests/import-schema?version=v2";

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unknown positional argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    values.set(arg.slice(2), value);
    index += 1;
  }
  return values;
}

function percentile(values, fraction) {
  const sorted = values.slice().sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return round(sorted[index]);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function assertLocalBaseUrl(value) {
  const url = new URL(value);
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (url.protocol !== "http:" || !localHosts.has(url.hostname) || url.pathname !== "/") {
    throw new Error("--base-url must be an http://localhost, http://127.0.0.1 or http://[::1] origin");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("--base-url must not contain credentials, query parameters or a fragment");
  }
  return url;
}

function detectRuntimeRegion() {
  const candidates = [
    ["VERCEL_REGION", process.env.VERCEL_REGION],
    ["AWS_REGION", process.env.AWS_REGION],
    ["FUNCTION_REGION", process.env.FUNCTION_REGION],
  ];
  const match = candidates.find(([, value]) => typeof value === "string" && value.length > 0);
  return match ? { source: match[0], value: match[1] } : { source: null, value: null };
}

async function sample(url) {
  const startedAt = performance.now();
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.arrayBuffer();
  const durationMs = round(performance.now() - startedAt);
  const disposition = response.headers.get("content-disposition");
  const cacheControl = response.headers.get("cache-control");

  if (response.status !== 200) throw new Error(`Expected HTTP 200, received ${response.status}`);
  if (!disposition?.includes("talvia-test-import-schema-v2.json")) {
    throw new Error("Unexpected Content-Disposition for the v2 schema");
  }
  if (!cacheControl?.includes("public")) throw new Error("Expected a public Cache-Control policy");
  JSON.parse(Buffer.from(body).toString("utf8"));

  return {
    bytes: body.byteLength,
    cacheControl,
    durationMs,
    status: response.status,
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.get("mode");
  if (mode !== "development" && mode !== "production") {
    throw new Error("--mode must be development or production");
  }

  const baseUrl = assertLocalBaseUrl(args.get("base-url") ?? "http://127.0.0.1:3000");
  const samples = Number.parseInt(args.get("samples") ?? String(DEFAULT_SAMPLES), 10);
  if (!Number.isSafeInteger(samples) || samples < 3 || samples > 100) {
    throw new Error("--samples must be an integer between 3 and 100");
  }

  const targetUrl = new URL(TARGET_PATH, baseUrl);
  const first = await sample(targetUrl);
  const warm = [];
  for (let index = 0; index < samples; index += 1) warm.push(await sample(targetUrl));

  const durations = warm.map(({ durationMs }) => durationMs);
  const runtimeRegion = detectRuntimeRegion();
  const report = {
    schemaVersion: 1,
    task: "PERF-017",
    generatedAt: new Date().toISOString(),
    mode,
    environment: {
      executionContext: "local-workstation",
      node: process.version,
      os: `${platform()} ${release()}`,
      machineNameRecorded: false,
      cwdUnderSyncedOneDrive: /[\\/]OneDrive[\\/]/i.test(process.cwd()),
      nextRuntimeRegion: runtimeRegion.value,
      nextRuntimeRegionSource: runtimeRegion.source,
      supabasePostgresRegion: null,
    },
    target: {
      baseUrl: baseUrl.origin,
      path: TARGET_PATH,
      remoteDatabaseCalls: 0,
    },
    first,
    warm: {
      count: warm.length,
      minMs: round(Math.min(...durations)),
      p50Ms: percentile(durations, 0.5),
      p95Ms: percentile(durations, 0.95),
      maxMs: round(Math.max(...durations)),
      samplesMs: durations,
    },
    limitations: [
      "Local workstation measurement; it is not a deployed application or product SLA.",
      "The fixed schema endpoint performs no remote database calls, so this comparison isolates local Next.js mode overhead.",
      "The first request can include startup or development compilation work; warm percentiles use sequential requests only.",
      "No project URL, project reference, key, token, user data or machine name is recorded.",
    ],
  };

  const output = args.get("output");
  if (output) {
    const destination = resolve(output);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    console.log(`Wrote ${destination}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
