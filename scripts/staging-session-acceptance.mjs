// Explicit opt-in. Only new synthetic assessment rows in a verified staging tenant.
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";

const requireValue = (condition, label) => { if (!condition) throw new Error(label); };
const dataOf = (response, label) => {
  if (response.error) throw new Error(`${label}:${/^[A-Z0-9_]{1,30}$/.test(response.error.code) ? response.error.code : "request_failed"}`);
  return response.data;
};
export async function runSessionAcceptance(env, sourcePath, progress = () => {}) {
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  requireValue(url && key && env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "missing-settings");
  requireValue(source.completed && source.companies?.length === 2 && source.prefix === `PERF-STAGING-${source.runId.slice(0, 8)}` &&
    source.projectFingerprint === createHash("sha256").update(new URL(url).origin).digest("hex"), "source-ownership");
  const destination = resolve(dirname(sourcePath), "sessions-report.json");
  const report = { runId: randomUUID(), parentRunId: source.runId, projectFingerprint: source.projectFingerprint,
    startedAt: new Date().toISOString(), completed: false, checks: [], metrics: [], fixtures: {}, shutdown: [],
    scope: "Synthetic candidate/employee server-only RPC behavior; real 100-question/400-option published version. No scoring finalizer or browser, no index before/after comparison." };
  const save = () => writeFile(destination, JSON.stringify(report, null, 2) + "\n");
  await writeFile(destination, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  const makeClient = k => createClient(url, k, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) } });
  const service = makeClient(key), anon = makeClient(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const company = source.companies[0].id;
  const check = (name, value) => { report.checks.push({ name, passed: !!value }); requireValue(value, name); };
  const insert = async (table, values) => dataOf(await service.from(table).insert(values), `seed-${table}`);
  const invitations = [];
  try {
    const owned = dataOf(await service.from("companies").select("id,name").eq("id", company).single(), "tenant");
    check("verified-synthetic-tenant", owned.name === source.companies[0].name && owned.name.startsWith(source.prefix));
    const template = randomUUID(), version = randomUUID(), section = randomUUID(), pkg = randomUUID();
    report.fixtures = { company, template, version, section, package: pkg, scopes: [] }; await save();
    progress("Creating a private 100-question / 400-option test in the verified synthetic tenant");
    await insert("test_templates", { id: template, company_id: company, title: `${source.prefix} RPC acceptance`, is_system: false });
    await insert("test_versions", { id: version, test_template_id: template, title: `${source.prefix} RPC acceptance`, version_number: 1,
      status: "draft", duration_minutes: 60, settings_json: { presentationMode: "section", captureQuestionTime: true } });
    await insert("test_sections", { id: section, test_version_id: version, title: "Synthetic section", order_index: 0 });
    const questions = Array.from({ length: 100 }, (_, n) => ({ id: randomUUID(), section_id: section,
      question_type: "single_choice", text: `Synthetic question ${n}`, order_index: n, points: 1 }));
    const options = questions.flatMap(q => Array.from({ length: 4 }, (_, n) => ({ id: randomUUID(), question_id: q.id,
      text: `Synthetic option ${n}`, order_index: n, is_correct: n === 0, points: n === 0 ? 1 : 0 })));
    await insert("questions", questions);
    await insert("answer_options", options);
    dataOf(await service.from("test_versions").update({ status: "published" }).eq("id", version).eq("status", "draft"), "publish-fixture");
    await insert("assessment_packages", { id: pkg, company_id: company, title: `${source.prefix} RPC package` });
    await insert("assessment_package_tests", { package_id: pkg, test_version_id: version, order_index: 0 });
    const answers = questions.map((q, n) => ({ questionId: q.id, answer: { selectedOptionId: options[n * 4].id }, timeSpentSeconds: 2 }));
    for (const scope of ["candidate", "employee"]) {
      progress(`Checking ${scope} lease, answer upsert, atomic section save and completion`);
      const employee = scope === "employee", person = randomUUID(), context = randomUUID(), owner = randomUUID(), session = randomUUID(), invitation = randomUUID();
      const personColumn = employee ? "employee_id" : "candidate_id", contextColumn = employee ? "employee_assessment_id" : "job_id";
      const ownerColumn = employee ? "participant_id" : "application_id";
      const sessionTable = employee ? "employee_assessment_sessions" : "test_sessions";
      const answerTable = employee ? "employee_assessment_answers" : "candidate_answers";
      const invitationTable = employee ? "employee_assessment_invitations" : "invitations";
      report.fixtures.scopes.push({ scope, person, context, owner, session, invitation }); await save();
      await insert(employee ? "employees" : "candidates", { id: person, company_id: company, full_name: `${source.prefix} RPC ${scope}`,
        ...(employee ? { email: `perf-${person}@example.invalid` } : {}) });
      await insert(employee ? "employee_assessments" : "jobs", { id: context, company_id: company,
        title: `${source.prefix} RPC ${scope}`, assessment_package_id: pkg });
      await insert(employee ? "employee_assessment_participants" : "candidate_applications", { id: owner, company_id: company,
        [personColumn]: person, [contextColumn]: context, status: "in_progress" });
      // Token and lease identifiers stay in memory, never in the manifest/output.
      const token = randomBytes(32).toString("hex");
      invitations.push({ table: invitationTable, id: invitation });
      await insert(invitationTable, { id: invitation, company_id: company, [ownerColumn]: owner, [personColumn]: person,
        [contextColumn]: context, token, status: "started", consent_given_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString() });
      await insert(sessionTable, { id: session, [ownerColumn]: owner, [personColumn]: person, test_version_id: version,
        status: "in_progress", started_at: new Date().toISOString(), deadline_at: new Date(Date.now() + 3600000).toISOString() });
      const base = { p_scope: scope, p_token: token, p_session_id: session, p_client_id: randomUUID(), p_device_id: randomUUID() };
      const args = {
        control_assessment_session_lease_v2: { ...base, p_operation: "claim", p_payload: { clientEventId: randomUUID() } },
        save_assessment_answer_v2: { ...base, p_question_id: questions[0].id, p_draft: answers[0].answer, p_finalize: false, p_time_spent_seconds: 2 },
        save_assessment_section_v2: { ...base, p_section_id: section, p_answers: answers, p_direction: "next" },
        complete_assessment_session_v2: base,
      };
      const call = async (name, override = {}) => dataOf(await service.rpc(name, { ...args[name], ...override }), `${scope}-${name}`);
      for (const [name, parameters] of Object.entries(args)) {
        const denied = await anon.rpc(name, parameters);
        check(`${scope}:${name}:anon-denied`, denied.error?.code === "42501");
      }
      check(`${scope}:claim`, (await call("control_assessment_session_lease_v2")).status === "active");
      check(`${scope}:incomplete`, (await call("complete_assessment_session_v2")).status === "incomplete");
      const snapshot = async () => ({
        session: dataOf(await service.from(sessionTable).select("status,completed_at,last_heartbeat_at,lease_expires_at").eq("id", session).single(), "session-state"),
        answers: dataOf(await service.from(answerTable).select("id,question_id,selected_option_id,time_spent_seconds,updated_at").eq("session_id", session).order("id"), "answer-state"),
      });
      for (const name of ["save_assessment_answer_v2", "save_assessment_section_v2", "complete_assessment_session_v2"]) {
        for (const [label, override, status] of [["wrong-token", { p_token: randomBytes(32).toString("hex") }, "unavailable"],
          ["wrong-session", { p_session_id: randomUUID() }, "unavailable"], ["wrong-client", { p_client_id: randomUUID() }, "blocked"]]) {
          const before = await snapshot();
          check(`${scope}:${name}:${label}`, (await call(name, override)).status === status);
          check(`${scope}:${name}:${label}:unchanged`, JSON.stringify(await snapshot()) === JSON.stringify(before));
        }
      }
      for (const name of ["save_assessment_answer_v2", "save_assessment_section_v2"]) {
        const durations = [];
        for (let n = 0; n < 31; n++) {
          const start = performance.now(), result = await call(name); durations.push(performance.now() - start);
          requireValue(result.status === "active", `${scope}:${name}:active`);
        }
        const warm = durations.slice(1).sort((a, b) => a - b);
        report.metrics.push({ scope, rpc: name, warmRepetitions: 30, firstMs: durations[0], p50Ms: warm[14], p95Ms: warm[28] });
        const stored = (await snapshot()).answers;
        check(`${scope}:${name}:upsert-cardinality`, stored.length === (name === "save_assessment_answer_v2" ? 1 : 100));
        check(`${scope}:${name}:saved-values`, stored.every(a => a.selected_option_id === options[questions.findIndex(q => q.id === a.question_id) * 4].id && a.time_spent_seconds === 2));
        await save();
      }
      const beforeInvalid = await snapshot();
      const invalid = await service.rpc("save_assessment_section_v2", { ...args.save_assessment_section_v2,
        p_answers: [...answers.slice(0, 99), answers[0]] });
      check(`${scope}:duplicate-question-rejected`, invalid.error?.code === "TVS01");
      check(`${scope}:invalid-batch-atomic`, JSON.stringify(await snapshot()) === JSON.stringify(beforeInvalid));
      const started = performance.now(), completed = await call("complete_assessment_session_v2");
      report.metrics.push({ scope, rpc: "complete_assessment_session_v2", repetitions: 1, durationMs: performance.now() - started });
      check(`${scope}:ready-for-scoring`, completed.status === "ready" && completed.ownerId === owner && completed.invitationId === invitation);
      const after = await snapshot();
      check(`${scope}:session-completed`, after.session.status === "completed" && after.session.lease_expires_at === null);
      check(`${scope}:completion-preserves-answers`, JSON.stringify(after.answers) === JSON.stringify(beforeInvalid.answers));
      check(`${scope}:completion-retry`, (await call("complete_assessment_session_v2")).status === "ready");
      check(`${scope}:retry-idempotent`, JSON.stringify(await snapshot()) === JSON.stringify(after));
      check(`${scope}:late-answer-terminal`, (await call("save_assessment_answer_v2")).status === "terminal");
      check(`${scope}:late-answer-unchanged`, JSON.stringify(await snapshot()) === JSON.stringify(after));
      await save();
    }
    report.completed = true;
  } catch (error) {
    report.failure = /^[A-Za-z0-9_:-]{1,180}$/.test(error.message) ? error.message : "session-acceptance-failed";
  } finally {
    for (const invitation of invitations) {
      const response = await service.from(invitation.table).update({ status: "expired", expires_at: new Date(0).toISOString() })
        .eq("id", invitation.id).eq("company_id", company).select("id,status");
      report.shutdown.push({ name: `${invitation.table}:expire-test-token`, passed: !response.error && response.data?.length === 1 && response.data[0].status === "expired" });
    }
    report.finishedAt = new Date().toISOString(); await save();
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv[2] === "--execute" && process.argv[3], "explicit-execute-and-source-required");
    const env = {};
    for (const path of [".env", ".env.local"]) {
      try { Object.assign(env, parseEnv(await readFile(path, "utf8"))); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    Object.assign(env, process.env);
    const result = await runSessionAcceptance(env, resolve(process.argv[3]), console.log);
    console.log(JSON.stringify({ completed: result.completed, passed: result.checks.filter(c => c.passed).length,
      total: result.checks.length, shutdown: result.shutdown, failure: result.failure, metrics: result.metrics }));
    if (!result.completed || result.shutdown.some(c => !c.passed)) process.exitCode = 1;
  } catch { console.error("Session acceptance could not start; no credentials or raw errors are logged."); process.exitCode = 1; }
}
