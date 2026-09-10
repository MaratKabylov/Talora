// Explicit opt-in. Creates new synthetic assessment rows and verifies the real
// Next completion route through scoring finalization. Tokens stay in memory.
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const requireValue = (condition, label) => {
  if (!condition) throw new Error(label);
};
const dataOf = (response, label) => {
  if (response.error) throw new Error(`${label}:${/^[A-Z0-9_]{1,30}$/.test(response.error.code) ? response.error.code : "request_failed"}`);
  return response.data;
};
const asNumber = value => typeof value === "number" ? value : Number(value);

async function postCompletion(baseUrl, body) {
  const started = performance.now();
  const response = await fetch(new URL("/api/assessment/complete", baseUrl), {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(30000),
  });
  const payload = await response.json().catch(() => ({}));
  return { durationMs: performance.now() - started, payload, status: response.status };
}

export async function runScoringAcceptance(env, sourcePath, baseUrl, progress = () => {}) {
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  requireValue(url && key && env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "missing-settings");
  requireValue(baseUrl && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(baseUrl), "local-base-url-required");
  requireValue(source.completed && source.companies?.length === 2 && source.prefix === `PERF-STAGING-${source.runId.slice(0, 8)}` &&
    source.projectFingerprint === createHash("sha256").update(new URL(url).origin).digest("hex"), "source-ownership");
  const destination = resolve(dirname(sourcePath), "scoring-report.json");
  const report = {
    runId: randomUUID(),
    parentRunId: source.runId,
    projectFingerprint: source.projectFingerprint,
    startedAt: new Date().toISOString(),
    completed: false,
    checks: [],
    metrics: [],
    fixtures: {},
    shutdown: [],
    scope: "Synthetic candidate/employee Next completion route to real scoring finalizer; no browser UI, SQL EXPLAIN or index before/after comparison.",
  };
  const save = () => writeFile(destination, JSON.stringify(report, null, 2) + "\n");
  await writeFile(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });

  const service = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) },
  });
  const company = source.companies[0].id;
  const check = (name, value) => {
    report.checks.push({ name, passed: !!value });
    requireValue(value, name);
  };
  const insert = async (table, values) => dataOf(await service.from(table).insert(values), `seed-${table}`);
  const invitations = [];

  try {
    const owned = dataOf(await service.from("companies").select("id,name").eq("id", company).single(), "tenant");
    check("verified-synthetic-tenant", owned.name === source.companies[0].name && owned.name.startsWith(source.prefix));

    const template = randomUUID(), version = randomUUID(), section = randomUUID(), pkg = randomUUID();
    report.fixtures = { company, template, version, section, package: pkg, scopes: [] };
    await save();

    progress("Creating scoring fixture with one weighted competency and all-correct answers");
    await insert("test_templates", { id: template, company_id: company, title: `${source.prefix} scoring route`, is_system: false });
    await insert("test_versions", { id: version, test_template_id: template, title: `${source.prefix} scoring route`, version_number: 1,
      status: "draft", duration_minutes: 60, settings_json: { presentationMode: "section", captureQuestionTime: true } });
    await insert("test_sections", { id: section, test_version_id: version, title: "Synthetic scoring section", order_index: 0 });
    const questions = Array.from({ length: 20 }, (_, n) => ({ id: randomUUID(), section_id: section,
      question_type: "single_choice", text: `Synthetic scoring question ${n}`, order_index: n, points: 1, competency_key: "communication" }));
    const options = questions.flatMap(q => Array.from({ length: 4 }, (_, n) => ({ id: randomUUID(), question_id: q.id,
      text: `Synthetic scoring option ${n}`, order_index: n, is_correct: n === 0, points: n === 0 ? 1 : 0 })));
    await insert("questions", questions);
    await insert("answer_options", options);
    dataOf(await service.from("test_versions").update({ status: "published" }).eq("id", version).eq("status", "draft"), "publish-fixture");
    await insert("assessment_packages", { id: pkg, company_id: company, title: `${source.prefix} scoring package` });
    await insert("assessment_package_tests", { package_id: pkg, test_version_id: version, order_index: 0, weight: 1, is_required: true });

    const answers = questions.map((question, n) => ({
      answer: { selectedOptionId: options[n * 4].id },
      questionId: question.id,
      timeSpentSeconds: 2,
    }));

    for (const scope of ["candidate", "employee"]) {
      progress(`Completing ${scope} through the local Next route and verifying persisted scoring`);
      const employee = scope === "employee";
      const person = randomUUID(), context = randomUUID(), owner = randomUUID(), session = randomUUID(), invitation = randomUUID();
      const clientId = randomUUID(), deviceId = randomUUID(), token = randomBytes(32).toString("hex");
      const personColumn = employee ? "employee_id" : "candidate_id";
      const contextColumn = employee ? "employee_assessment_id" : "job_id";
      const ownerColumn = employee ? "participant_id" : "application_id";
      const sessionTable = employee ? "employee_assessment_sessions" : "test_sessions";
      const invitationTable = employee ? "employee_assessment_invitations" : "invitations";
      const ownerTable = employee ? "employee_assessment_participants" : "candidate_applications";
      const resultTable = employee ? "employee_assessment_test_results" : "test_results";
      const summaryTable = employee ? "employee_assessment_competency_summary" : "application_competency_summary";
      const reportTable = employee ? "employee_assessment_reports" : "candidate_reports";
      const summaryParent = employee ? "participant_id" : "application_id";
      const routeType = employee ? "employee" : "candidate";

      report.fixtures.scopes.push({ scope, person, context, owner, session, invitation });
      await save();
      await insert(employee ? "employees" : "candidates", { id: person, company_id: company, full_name: `${source.prefix} scoring ${scope}`,
        email: `perf-${person}@example.invalid` });
      await insert(employee ? "employee_assessments" : "jobs", { id: context, company_id: company,
        title: `${source.prefix} scoring ${scope}`, assessment_package_id: pkg });
      await insert(employee ? "employee_assessment_competency_weights" : "job_competency_weights",
        { company_id: company, [contextColumn]: context, competency_key: "communication", weight: 1, minimum_score: null, is_required: true });
      await insert(ownerTable, { id: owner, company_id: company, [personColumn]: person, [contextColumn]: context, status: "in_progress" });
      invitations.push({ id: invitation, table: invitationTable });
      await insert(invitationTable, { id: invitation, company_id: company, [ownerColumn]: owner, [personColumn]: person,
        [contextColumn]: context, token, status: "started", consent_given_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString() });
      await insert(sessionTable, { id: session, [ownerColumn]: owner, [personColumn]: person, test_version_id: version,
        status: "in_progress", started_at: new Date().toISOString(), deadline_at: new Date(Date.now() + 3600000).toISOString() });

      const base = { p_scope: scope, p_token: token, p_session_id: session, p_client_id: clientId, p_device_id: deviceId };
      const claim = dataOf(await service.rpc("control_assessment_session_lease_v2", { ...base, p_operation: "claim", p_payload: { clientEventId: randomUUID() } }), `${scope}-claim`);
      check(`${scope}:claim`, claim.status === "active");
      const saved = dataOf(await service.rpc("save_assessment_section_v2", { ...base, p_section_id: section, p_answers: answers, p_direction: "next" }), `${scope}-save-section`);
      check(`${scope}:section-saved`, saved.status === "active");

      const before = dataOf(await service.from(ownerTable).select("status,current_stage,overall_score,fit_score,scoring_revision").eq("id", owner).single(), `${scope}-before`);
      check(`${scope}:before-unscored`, before.status === "in_progress" && before.scoring_revision === 0 && before.overall_score === null && before.fit_score === null);

      const completion = await postCompletion(baseUrl, { assessmentType: routeType, token, sessionId: session, clientId, deviceId });
      report.metrics.push({ scope, route: "/api/assessment/complete", durationMs: completion.durationMs, status: completion.status });
      check(`${scope}:route-200`, completion.status === 200);
      check(`${scope}:route-redirect-complete`, completion.payload?.status === "redirect" && String(completion.payload.redirectTo ?? "").endsWith("/complete"));

      const [ownerAfter, invitationAfter, sessionAfter, resultRows, summaryRows, reportRows] = await Promise.all([
        service.from(ownerTable).select("status,current_stage,completed_at,overall_score,fit_score,recommendation,risk_level,requires_review,scoring_revision").eq("id", owner).single(),
        service.from(invitationTable).select("status,expires_at").eq("id", invitation).single(),
        service.from(sessionTable).select("status,score,max_score,percentage,completed_at").eq("id", session).single(),
        service.from(resultTable).select("session_id,raw_score,max_score,percentage,level,requires_review,scoring_revision").eq("session_id", session),
        service.from(summaryTable).select("competency_key,score,max_score,percentage,weighted_score,is_below_minimum").eq(summaryParent, owner),
        service.from(reportTable).select("overall_score,fit_score,recommendation").eq(summaryParent, owner),
      ]);
      const ownerData = dataOf(ownerAfter, `${scope}-owner-after`);
      const invitationData = dataOf(invitationAfter, `${scope}-invitation-after`);
      const sessionData = dataOf(sessionAfter, `${scope}-session-after`);
      const results = dataOf(resultRows, `${scope}-results`);
      const summaries = dataOf(summaryRows, `${scope}-summaries`);
      const reports = dataOf(reportRows, `${scope}-reports`);

      check(`${scope}:owner-completed`, ownerData.status === "completed" && ownerData.current_stage === "assessment_completed" && ownerData.completed_at);
      check(`${scope}:scores-persisted`, asNumber(ownerData.overall_score) === 100 && asNumber(ownerData.fit_score) === 100 && ownerData.scoring_revision === 1);
      check(`${scope}:invitation-completed`, invitationData.status === "completed");
      check(`${scope}:session-scored`, sessionData.status === "completed" && asNumber(sessionData.score) === 20 && asNumber(sessionData.max_score) === 20 && asNumber(sessionData.percentage) === 100);
      check(`${scope}:result-row`, results.length === 1 && asNumber(results[0].raw_score) === 20 && asNumber(results[0].max_score) === 20 &&
        asNumber(results[0].percentage) === 100 && results[0].scoring_revision === 1 && results[0].requires_review === false);
      check(`${scope}:summary-row`, summaries.length === 1 && summaries[0].competency_key === "communication" &&
        asNumber(summaries[0].percentage) === 100 && asNumber(summaries[0].weighted_score) === 100 && summaries[0].is_below_minimum === false);
      check(`${scope}:report-row`, reports.length === 1 && asNumber(reports[0].overall_score) === 100 && asNumber(reports[0].fit_score) === 100);

      const retry = await postCompletion(baseUrl, { assessmentType: routeType, token, sessionId: session, clientId, deviceId });
      report.metrics.push({ scope, route: "/api/assessment/complete:retry", durationMs: retry.durationMs, status: retry.status });
      check(`${scope}:route-retry-200`, retry.status === 200);
      const ownerRetry = dataOf(await service.from(ownerTable).select("status,scoring_revision,overall_score,fit_score").eq("id", owner).single(), `${scope}-owner-retry`);
      check(`${scope}:retry-idempotent`, ownerRetry.status === "completed" && ownerRetry.scoring_revision === 1 &&
        asNumber(ownerRetry.overall_score) === 100 && asNumber(ownerRetry.fit_score) === 100);
      await save();
    }

    report.completed = true;
  } catch (error) {
    report.failure = /^[A-Za-z0-9_:-]{1,180}$/.test(error.message) ? error.message : "scoring-acceptance-failed";
  } finally {
    for (const invitation of invitations) {
      const response = await service.from(invitation.table).update({ expires_at: new Date(0).toISOString() })
        .eq("id", invitation.id).eq("company_id", company).select("id,expires_at,status");
      report.shutdown.push({ name: `${invitation.table}:expire-completed-token`, passed: !response.error && response.data?.length === 1 &&
        new Date(response.data[0].expires_at).getTime() === 0 && response.data[0].status === "completed" });
    }
    report.finishedAt = new Date().toISOString();
    await save();
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const executeIndex = process.argv.indexOf("--execute");
    const baseIndex = process.argv.indexOf("--base-url");
    requireValue(executeIndex >= 0 && process.argv[executeIndex + 1] && baseIndex >= 0 && process.argv[baseIndex + 1],
      "explicit-execute-and-base-url-required");
    const env = {};
    for (const path of [".env", ".env.local"]) {
      try { Object.assign(env, parseEnv(await readFile(path, "utf8"))); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    Object.assign(env, process.env);
    const result = await runScoringAcceptance(env, resolve(process.argv[executeIndex + 1]), process.argv[baseIndex + 1], console.log);
    console.log(JSON.stringify({ completed: result.completed, passed: result.checks.filter(c => c.passed).length,
      total: result.checks.length, shutdown: result.shutdown, failure: result.failure, metrics: result.metrics }));
    if (!result.completed || result.shutdown.some(c => !c.passed)) process.exitCode = 1;
  } catch {
    console.error("Scoring acceptance could not start; no credentials, tokens or raw errors are logged.");
    process.exitCode = 1;
  }
}
