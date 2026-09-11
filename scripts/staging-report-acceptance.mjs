// Opt-in report-page acceptance against the authorized current project.
// Creates only a temporary Auth user and disabled-at-shutdown membership; never changes schema or business rows.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const SOURCE_REPORT = "docs/performance/PERF012_SCORING_2026-09-10.json";
const OUTPUT_REPORT = "docs/performance/PERF013_STAGING_2026-09-11.json";
const ACTIVE_COMPANY_COOKIE = "talvia_active_company_id";

const requireCheck = (condition, label) => {
  if (!condition) throw new Error(label);
};
const safeCode = (error) =>
  /^[A-Za-z0-9_]{1,40}$/.test(error?.code ?? "") ? error.code : "request_failed";
const percentile = (values, fraction) =>
  [...values].sort((left, right) => left - right)[Math.ceil(values.length * fraction) - 1];
const unicodeEscaped = (value) =>
  [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint > 127 ? `\\u${codePoint.toString(16).padStart(4, "0")}` : character;
    })
    .join("");
const includesMarker = (body, marker) =>
  body.includes(marker) || body.toLowerCase().includes(unicodeEscaped(marker).toLowerCase());

async function loadEnv() {
  const env = {};
  for (const name of [".env", ".env.local"]) {
    try {
      Object.assign(env, parseEnv(await readFile(name, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return Object.assign(env, process.env);
}

async function waitForServer(baseUrl) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(baseUrl, { redirect: "manual", signal: AbortSignal.timeout(2_000) });
      if (response.status > 0) return;
    } catch {
      // The local server can take a few seconds to become ready.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  throw new Error("local_server_unavailable");
}

async function readPage(baseUrl, path, cookieHeader) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      accept: "text/html",
      cookie: cookieHeader,
      "x-request-id": `perf013-${randomUUID()}`,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const reader = response.body?.getReader();
  requireCheck(reader, "response_body_missing");
  const decoder = new TextDecoder();
  let body = "";
  let bytes = 0;
  let chunks = 0;
  let firstChunkBytes = 0;
  let firstByteMs = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks += 1;
    bytes += value.byteLength;
    if (firstByteMs === null) {
      firstByteMs = performance.now() - startedAt;
      firstChunkBytes = value.byteLength;
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  return {
    body,
    measurement: {
      bytes,
      chunks,
      firstByteMs,
      firstChunkBytes,
      status: response.status,
      totalMs: performance.now() - startedAt,
    },
  };
}

export async function runStagingReportAcceptance(
  env,
  baseUrl,
  outputPath,
  progress = () => {},
  sourcePath = SOURCE_REPORT,
) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  requireCheck(url && anonKey && serviceKey, "missing_supabase_settings");

  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const fingerprint = createHash("sha256").update(new URL(url).origin).digest("hex");
  requireCheck(source.completed === true, "source_report_incomplete");
  requireCheck(source.projectFingerprint === fingerprint, "project_fingerprint_mismatch");

  const companyId = source.fixtures.company;
  const candidateId = source.fixtures.scopes.find((scope) => scope.scope === "candidate")?.owner;
  const employeeId = source.fixtures.scopes.find((scope) => scope.scope === "employee")?.owner;
  requireCheck(companyId && candidateId && employeeId, "source_targets_missing");

  const report = {
    runId: randomUUID(),
    startedAt: new Date().toISOString(),
    completed: false,
    projectFingerprint: fingerprint,
    scope:
      "Authorized current project; existing PERF-012 synthetic report rows are read only. One temporary Auth user and membership are disabled at shutdown. No schema, flag, business-row update or delete.",
    sourceReport: sourcePath,
    checks: [],
    metrics: [],
    shutdown: [],
  };
  const save = () => writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  const check = (name, condition) => {
    report.checks.push({ name, passed: Boolean(condition) });
    requireCheck(condition, name);
  };

  const service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const cookies = new Map();
  const auth = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: (values) => values.forEach(({ name, value }) => cookies.set(name, value)),
    },
  });
  let userId = null;
  let membershipCreated = false;

  try {
    progress("Verifying existing PERF-012 synthetic report targets");
    const [companyResult, candidateResult, employeeResult] = await Promise.all([
      service.from("companies").select("id, name").eq("id", companyId).maybeSingle(),
      service
        .from("candidate_applications")
        .select("id, company_id")
        .eq("id", candidateId)
        .maybeSingle(),
      service
        .from("employee_assessment_participants")
        .select("id, company_id")
        .eq("id", employeeId)
        .maybeSingle(),
    ]);
    requireCheck(!companyResult.error && !candidateResult.error && !employeeResult.error, "target_read_failed");
    check("synthetic-company", companyResult.data?.name?.startsWith("PERF-STAGING-"));
    check(
      "candidate-target-owned-by-synthetic-company",
      candidateResult.data?.id === candidateId && candidateResult.data?.company_id === companyId,
    );
    check(
      "employee-target-owned-by-synthetic-company",
      employeeResult.data?.id === employeeId && employeeResult.data?.company_id === companyId,
    );

    progress("Creating a temporary authenticated report reader");
    const email = `perf013-${report.runId}@example.invalid`;
    const password = randomBytes(36).toString("base64url");
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: "PERF-013 report acceptance", perf_run_id: report.runId },
    });
    requireCheck(!created.error && created.data.user, `create_test_user_${safeCode(created.error)}`);
    userId = created.data.user.id;
    const membership = await service.from("company_users").insert({
      company_id: companyId,
      role: "viewer",
      status: "active",
      user_id: userId,
    });
    requireCheck(!membership.error, `create_membership_${safeCode(membership.error)}`);
    membershipCreated = true;
    const signedIn = await auth.auth.signInWithPassword({ email, password });
    requireCheck(!signedIn.error && signedIn.data.session, `sign_in_${safeCode(signedIn.error)}`);
    cookies.set(ACTIVE_COMPANY_COOKIE, companyId);
    const cookieHeader = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");

    progress("Measuring candidate and employee report HTML streams");
    const targets = [
      {
        name: "candidate-first-page",
        path: `/dashboard/applications/${candidateId}/report`,
        markers: ["Overall score", "Ответы кандидата"],
      },
      {
        name: "candidate-second-page",
        path: `/dashboard/applications/${candidateId}/report?answersPage=2&eventsPage=2`,
        markers: ["Overall score", "answersPage", "eventsPage"],
      },
      {
        name: "employee-first-page",
        path: `/dashboard/employee-assessments/participants/${employeeId}/report`,
        markers: ["Overall score", "Результаты и ответы сотрудника"],
      },
      {
        name: "employee-second-page",
        path: `/dashboard/employee-assessments/participants/${employeeId}/report?answersPage=2&eventsPage=2`,
        markers: ["Overall score", "answersPage", "eventsPage"],
      },
    ];
    for (const target of targets) {
      const samples = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const result = await readPage(baseUrl, target.path, cookieHeader);
        check(`${target.name}:status-${attempt}`, result.measurement.status === 200);
        check(
          `${target.name}:markers-${attempt}`,
          target.markers.every((marker) => includesMarker(result.body, marker)),
        );
        check(
          `${target.name}:streamed-${attempt}`,
          result.measurement.chunks > 1 && result.measurement.firstChunkBytes < result.measurement.bytes,
        );
        samples.push(result.measurement);
      }
      const warm = samples.slice(1);
      report.metrics.push({
        name: target.name,
        first: samples[0],
        repetitions: warm.length,
        p50FirstByteMs: percentile(warm.map((sample) => sample.firstByteMs), 0.5),
        p95FirstByteMs: percentile(warm.map((sample) => sample.firstByteMs), 0.95),
        p50TotalMs: percentile(warm.map((sample) => sample.totalMs), 0.5),
        p95TotalMs: percentile(warm.map((sample) => sample.totalMs), 0.95),
        maxBytes: Math.max(...warm.map((sample) => sample.bytes)),
        maxFirstChunkBytes: Math.max(...warm.map((sample) => sample.firstChunkBytes)),
        samples: warm,
      });
      progress(`Measured ${target.name}`);
      await save();
    }
    report.completed = true;
  } catch (error) {
    report.failure = error instanceof Error ? error.message.slice(0, 180) : "staging_run_failed";
    progress(`Run stopped: ${report.failure}`);
  } finally {
    progress("Disabling temporary report access");
    if (membershipCreated && userId) {
      const membership = await service
        .from("company_users")
        .update({ status: "disabled" })
        .eq("company_id", companyId)
        .eq("user_id", userId);
      report.shutdown.push({
        name: "disable-membership",
        passed: !membership.error,
        code: membership.error ? safeCode(membership.error) : null,
      });
    }
    if (userId) {
      const banned = await service.auth.admin.updateUserById(userId, { ban_duration: "8760h" });
      report.shutdown.push({
        name: "ban-test-user",
        passed: !banned.error,
        code: banned.error ? safeCode(banned.error) : null,
      });
      const signedOut = await auth.auth.signOut({ scope: "global" });
      report.shutdown.push({
        name: "revoke-test-sessions",
        passed: !signedOut.error,
        code: signedOut.error ? safeCode(signedOut.error) : null,
      });
    }
    report.finishedAt = new Date().toISOString();
    await save();
  }
  return report;
}

export async function auditPerf013Shutdown(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  requireCheck(url && serviceKey, "missing_supabase_settings");
  const service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const usersResult = await service.auth.admin.listUsers({ page: 1, perPage: 1_000 });
  requireCheck(!usersResult.error, "list_test_users_failed");
  const users = usersResult.data.users.filter(
    (user) => user.user_metadata?.full_name === "PERF-013 report acceptance",
  );
  const userIds = users.map((user) => user.id);
  const membershipsResult =
    userIds.length === 0
      ? { data: [], error: null }
      : await service.from("company_users").select("user_id, status").in("user_id", userIds);
  requireCheck(!membershipsResult.error, "read_test_memberships_failed");
  const memberships = membershipsResult.data ?? [];
  return {
    allMembershipsDisabled: memberships.every((membership) => membership.status === "disabled"),
    allUsersBanned: users.every((user) => Boolean(user.banned_until)),
    membershipCount: memberships.length,
    userCount: users.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = await loadEnv();
  if (process.argv[2] === "--audit-shutdown") {
    const audit = await auditPerf013Shutdown(env);
    console.log(JSON.stringify(audit));
    if (!audit.allMembershipsDisabled || !audit.allUsersBanned) process.exitCode = 1;
  } else if (process.argv[2] !== "--execute") {
    throw new Error("Remote writes require explicit --execute; use only in a user-authorized project.");
  } else {
  const baseUrl = process.argv[3] ?? "http://127.0.0.1:4325";
  const outputPath = resolve(process.argv[4] ?? OUTPUT_REPORT);
  await waitForServer(baseUrl);
  const report = await runStagingReportAcceptance(env, baseUrl, outputPath, console.log);
  console.log(
    JSON.stringify({
      artifact: outputPath,
      checks: report.checks.length,
      completed: report.completed,
      metrics: report.metrics.length,
      shutdownPassed: report.shutdown.every((check) => check.passed),
    }),
  );
  if (!report.completed || report.shutdown.some((check) => !check.passed)) process.exitCode = 1;
  }
}
