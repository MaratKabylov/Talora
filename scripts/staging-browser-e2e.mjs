// Explicit opt-in. Creates one synthetic candidate assessment in the verified
// staging tenant and exposes only loopback control endpoints. The invitation
// token stays in memory and is never written to stdout or the evidence file.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const requireValue = (condition, label) => { if (!condition) throw new Error(label); };
const dataOf = (response, label) => {
  if (response.error) throw new Error(`${label}:${/^[A-Z0-9_]{1,30}$/.test(response.error.code) ? response.error.code : "request_failed"}`);
  return response.data;
};
const asNumber = value => typeof value === "number" ? value : Number(value);
const safeMessage = error => /^[A-Za-z0-9_:-]{1,180}$/.test(error?.message ?? "") ? error.message : "browser-e2e-failed";

export async function runBrowserE2ECoordinator(env, sourcePath, appBaseUrl, port, progress = () => {}) {
  const sourceDocument = JSON.parse(await readFile(sourcePath, "utf8"));
  const source = sourceDocument.acceptance ?? sourceDocument;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  requireValue(url && key, "missing-settings");
  requireValue(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(appBaseUrl), "local-app-url-required");
  requireValue(Number.isInteger(port) && port >= 1024 && port <= 65535, "invalid-control-port");
  requireValue(source.completed && source.companies?.length === 2 && source.prefix === `PERF-STAGING-${source.runId.slice(0, 8)}` &&
    source.projectFingerprint === createHash("sha256").update(new URL(url).origin).digest("hex"), "source-ownership");

  const destination = resolve(dirname(sourcePath), "PERF017_AUTH_BROWSER_E2E_2026-09-12.json");
  const report = {
    runId: randomUUID(), parentRunId: source.runId, projectFingerprint: source.projectFingerprint,
    startedAt: new Date().toISOString(), completed: false, browserStages: [], checks: [], shutdown: [],
    scope: "Chrome candidate consent/profile/test/completion against local production Next and the current verified synthetic Supabase tenant. One required single-choice question. No schema or remote flag changes.",
  };
  const save = () => writeFile(destination, JSON.stringify(report, null, 2) + "\n");
  await writeFile(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });

  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) },
  });
  const company = source.companies[0].id;
  const prefix = `${source.prefix} browser e2e`;
  const ids = Object.fromEntries(["template", "version", "section", "question", "package", "job", "candidate", "application", "invitation"].map(name => [name, randomUUID()]));
  const options = Array.from({ length: 4 }, () => randomUUID());
  const token = randomBytes(32).toString("hex");
  const syntheticEmail = `browser-${ids.candidate}@example.invalid`;
  let invitationCreated = false;
  let finalized = false;
  let server;
  const insert = async (table, values) => dataOf(await service.from(table).insert(values), `seed-${table}`);
  const check = (name, value) => {
    const passed = Boolean(value);
    report.checks.push({ name, passed });
    requireValue(passed, name);
  };

  async function expireInvitation() {
    if (!invitationCreated || report.shutdown.length) return;
    const current = dataOf(await service.from("invitations").select("status").eq("id", ids.invitation).single(), "shutdown-read");
    const patch = current.status === "completed"
      ? { expires_at: new Date(0).toISOString() }
      : { status: "expired", expires_at: new Date(0).toISOString() };
    const result = await service.from("invitations").update(patch).eq("id", ids.invitation).eq("company_id", company).select("status,expires_at");
    report.shutdown.push({ name: "expire-synthetic-invitation", passed: !result.error && result.data?.length === 1 && new Date(result.data[0].expires_at).getTime() === 0 });
    await save();
  }

  async function verifyAndFinalize() {
    if (finalized) return { completed: report.completed, checks: report.checks.length, shutdown: report.shutdown.every(item => item.passed) };
    finalized = true;
    try {
      const [candidateResponse, applicationResponse, invitationResponse, sessionResponse, resultsResponse, summaryResponse, candidateReportResponse] = await Promise.all([
        service.from("candidates").select("full_name,email,profile_completed_at").eq("id", ids.candidate).single(),
        service.from("candidate_applications").select("status,current_stage,completed_at,overall_score,fit_score,scoring_revision").eq("id", ids.application).single(),
        service.from("invitations").select("status,opened_at,consent_given_at,consent_version").eq("id", ids.invitation).single(),
        service.from("test_sessions").select("id,status,score,max_score,percentage,started_at,completed_at").eq("application_id", ids.application).single(),
        service.from("test_results").select("raw_score,max_score,percentage,scoring_revision").eq("application_id", ids.application),
        service.from("application_competency_summary").select("competency_key,percentage,weighted_score").eq("application_id", ids.application),
        service.from("candidate_reports").select("overall_score,fit_score").eq("application_id", ids.application),
      ]);
      const candidate = dataOf(candidateResponse, "verify-candidate");
      const application = dataOf(applicationResponse, "verify-application");
      const invitation = dataOf(invitationResponse, "verify-invitation");
      const session = dataOf(sessionResponse, "verify-session");
      const answers = dataOf(await service.from("candidate_answers").select("selected_option_id,is_correct,time_spent_seconds").eq("session_id", session.id), "verify-answers");
      const results = dataOf(resultsResponse, "verify-results");
      const summaries = dataOf(summaryResponse, "verify-summary");
      const candidateReports = dataOf(candidateReportResponse, "verify-report");

      check("browser-stage-consent", report.browserStages.includes("consent"));
      check("browser-stage-profile", report.browserStages.includes("profile"));
      check("browser-stage-test", report.browserStages.includes("test"));
      check("browser-stage-complete", report.browserStages.includes("complete"));
      check("consent-persisted", invitation.opened_at && invitation.consent_given_at && invitation.consent_version === "mvp_v1");
      check("profile-persisted", candidate.profile_completed_at && candidate.full_name === `${prefix} candidate` && candidate.email === syntheticEmail);
      check("application-completed", application.status === "completed" && application.current_stage === "assessment_completed" && application.completed_at && application.scoring_revision === 1);
      check("application-scores", asNumber(application.overall_score) === 100 && asNumber(application.fit_score) === 100);
      check("invitation-completed", invitation.status === "completed");
      check("session-completed", session.status === "completed" && session.started_at && session.completed_at && asNumber(session.score) === 1 && asNumber(session.max_score) === 1 && asNumber(session.percentage) === 100);
      check("answer-persisted", answers.length === 1 && answers[0].selected_option_id === options[0] && answers[0].is_correct === true);
      check("result-persisted", results.length === 1 && asNumber(results[0].raw_score) === 1 && asNumber(results[0].percentage) === 100 && results[0].scoring_revision === 1);
      check("competency-summary-persisted", summaries.length === 1 && summaries[0].competency_key === "communication" && asNumber(summaries[0].percentage) === 100 && asNumber(summaries[0].weighted_score) === 100);
      check("candidate-report-persisted", candidateReports.length === 1 && asNumber(candidateReports[0].overall_score) === 100 && asNumber(candidateReports[0].fit_score) === 100);
      report.completed = true;
    } catch (error) {
      report.failure = safeMessage(error);
    } finally {
      await expireInvitation();
      report.finishedAt = new Date().toISOString();
      await save();
    }
    return { completed: report.completed, checks: report.checks.length, shutdown: report.shutdown.every(item => item.passed), failure: report.failure };
  }

  try {
    const owned = dataOf(await service.from("companies").select("name").eq("id", company).single(), "tenant");
    requireValue(owned.name === source.companies[0].name && owned.name.startsWith(source.prefix), "verified-synthetic-tenant");
    progress("Creating one-question browser fixture in verified synthetic tenant");
    await insert("test_templates", { id: ids.template, company_id: company, title: `${prefix} test`, is_system: false });
    await insert("test_versions", { id: ids.version, test_template_id: ids.template, title: `${prefix} test`, version_number: 1,
      status: "draft", duration_minutes: 15, settings_json: { presentationMode: "section", captureQuestionTime: true, allowBack: true } });
    await insert("test_sections", { id: ids.section, test_version_id: ids.version, title: `${prefix} section`, order_index: 0 });
    await insert("questions", { id: ids.question, section_id: ids.section, question_type: "single_choice", text: `${prefix} question`,
      order_index: 0, points: 1, competency_key: "communication", settings_json: { required: true } });
    await insert("answer_options", options.map((id, index) => ({ id, question_id: ids.question, text: `${prefix} option ${index + 1}`,
      order_index: index, is_correct: index === 0, points: index === 0 ? 1 : 0 })));
    dataOf(await service.from("test_versions").update({ status: "published" }).eq("id", ids.version).eq("status", "draft"), "publish-fixture");
    await insert("assessment_packages", { id: ids.package, company_id: company, title: `${prefix} package` });
    await insert("assessment_package_tests", { package_id: ids.package, test_version_id: ids.version, order_index: 0, weight: 1, is_required: true });
    await insert("jobs", { id: ids.job, company_id: company, title: `${prefix} job`, assessment_package_id: ids.package });
    await insert("job_competency_weights", { company_id: company, job_id: ids.job, competency_key: "communication", weight: 1, is_required: true });
    await insert("candidates", { id: ids.candidate, company_id: company, full_name: `${prefix} initial` });
    await insert("candidate_applications", { id: ids.application, company_id: company, candidate_id: ids.candidate, job_id: ids.job, status: "invited" });
    await insert("invitations", { id: ids.invitation, company_id: company, application_id: ids.application, candidate_id: ids.candidate,
      job_id: ids.job, token, status: "sent", expires_at: new Date(Date.now() + 3600000).toISOString() });
    invitationCreated = true;
    await save();
  } catch (error) {
    report.failure = safeMessage(error);
    await expireInvitation().catch(() => undefined);
    report.finishedAt = new Date().toISOString();
    await save();
    throw error;
  }

  server = createServer(async (request, response) => {
    const remote = request.socket.remoteAddress ?? "";
    if (!remote.includes("127.0.0.1") && remote !== "::1" && remote !== "::ffff:127.0.0.1") {
      response.writeHead(403).end(); return;
    }
    const requestUrl = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method === "GET" && requestUrl.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify({ ready: true })); return;
    }
    if (request.method === "GET" && requestUrl.pathname === "/start") {
      response.writeHead(302, { Location: `${appBaseUrl.replace(/\/$/, "")}/assessment/${token}`, "Cache-Control": "no-store" }).end(); return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/stage") {
      let body = "";
      for await (const chunk of request) body += chunk;
      let stage;
      try { stage = JSON.parse(body).stage; } catch { /* handled below */ }
      if (!["consent", "profile", "test", "complete"].includes(stage)) { response.writeHead(400).end(); return; }
      if (!report.browserStages.includes(stage)) report.browserStages.push(stage);
      await save();
      response.writeHead(204).end(); return;
    }
    if (request.method === "POST" && requestUrl.pathname === "/finalize") {
      const result = await verifyAndFinalize();
      response.writeHead(result.completed && result.shutdown ? 200 : 500, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(result));
      setTimeout(() => server.close(), 25);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  progress(`BROWSER_E2E_READY port=${port}`);
  return { server, report, finalize: verifyAndFinalize };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const executeIndex = process.argv.indexOf("--execute");
    const baseIndex = process.argv.indexOf("--app-base-url");
    const portIndex = process.argv.indexOf("--control-port");
    requireValue(executeIndex >= 0 && process.argv[executeIndex + 1] && baseIndex >= 0 && process.argv[baseIndex + 1] && portIndex >= 0,
      "explicit-execute-base-url-and-port-required");
    const env = {};
    for (const path of [".env", ".env.local"]) {
      try { Object.assign(env, parseEnv(await readFile(path, "utf8"))); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    Object.assign(env, process.env);
    const coordinator = await runBrowserE2ECoordinator(env, resolve(process.argv[executeIndex + 1]), process.argv[baseIndex + 1], Number(process.argv[portIndex + 1]), console.log);
    const shutdown = async () => { await coordinator.finalize(); coordinator.server.close(); };
    process.once("SIGINT", () => void shutdown().finally(() => process.exit(130)));
    process.once("SIGTERM", () => void shutdown().finally(() => process.exit(143)));
  } catch {
    console.error("Browser E2E coordinator could not start; no credentials, tokens or raw errors are logged.");
    process.exitCode = 1;
  }
}
