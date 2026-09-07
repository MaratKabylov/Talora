import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { compileFunction } from "node:vm";
import { JsxEmit, ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import * as richText from "../lib/rich-text.ts";
import * as presentation from "../lib/tests/presentation-settings.ts";
import * as contentBlocks from "../lib/tests/content-blocks.ts";
import * as shuffle from "../lib/answers/option-shuffle.ts";
import * as structured from "../lib/structured-questions.ts";
import type { AssessmentAvailability } from "../lib/assessment/data.ts";
import type { EmployeeAssessmentAvailability } from "../lib/employee-assessments/public-data.ts";

const id = (n: number) => `f6000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const token = "a".repeat(64);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
function load<T>(path: string, dependencies: Record<string, unknown>, env: Record<string, string> = {}): T {
  const { outputText } = transpileModule(read(path), { compilerOptions: {
    module: ModuleKind.CommonJS, target: ScriptTarget.ES2022, jsx: JsxEmit.ReactJSX,
  } });
  const exports = {};
  compileFunction(outputText, ["exports", "require", "process"])(exports, (specifier: string) => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency ${specifier}`);
    return dependencies[specifier];
  }, { env });
  return exports as T;
}
const richTextServer = load<typeof import("../lib/rich-text.server.ts")>("../lib/rich-text.server.ts", {
  "server-only": {}, "sanitize-html": { __esModule: true, default: sanitizeHtml }, "@/lib/rich-text": richText,
});
const measure = { measureServerOperation: (_name: string, task: () => unknown) => task() };
const request = { assessmentType: "candidate" as const, token, sessionId: id(50) };
function minimalFixture() {
  return { availability: "active" as const, companyName: "Company", contextTitle: "Context", sessionCount: 3,
    completedSessionCount: 1, nextSessionId: id(50), session: { id: id(50), status: "in_progress" as const,
      deadlineAt: null, test: { title: "Logical title", description: null, instructions: null,
        presentationSettings: presentation.DEFAULT_TEST_PRESENTATION_SETTINGS } } };
}
function legacyFixture(scope: "candidate" | "employee"): AssessmentAvailability | EmployeeAssessmentAvailability {
  const minimal = minimalFixture();
  return { availability: "active", companyName: minimal.companyName, consentGivenAt: "2026-09-07",
    invitationId: id(40), invitationStatus: "started", tests: [], totalDurationMinutes: 99,
    package: { title: "private package", description: "unused description" },
    sessions: [
      { ...minimal.session, id: id(49), status: "completed", startedAt: null, completedAt: null, test: { ...minimal.session.test, versionId: id(30), orderIndex: 0, durationMinutes: 30 } },
      { ...minimal.session, startedAt: null, completedAt: null, test: { ...minimal.session.test, versionId: id(31), orderIndex: 1, durationMinutes: 30 } },
      { ...minimal.session, id: id(51), status: "not_started", startedAt: null, completedAt: null, test: { ...minimal.session.test, versionId: id(32), orderIndex: 2, durationMinutes: 30 } },
    ], ...(scope === "candidate" ? { applicationId: id(20), job: { title: minimal.contextTitle, department: null, location: null },
      candidate: { id: id(10), fullName: "Private name", email: "private@example.invalid", phone: null, city: null, profileCompletedAt: null } }
      : { participantId: id(20), assessment: { title: minimal.contextTitle, description: "unused" },
        employee: { id: id(10), fullName: "Private name", email: "private@example.invalid", phone: null, department: null, roleTitle: null, profileCompletedAt: null } }),
  } as AssessmentAvailability | EmployeeAssessmentAvailability;
}
function harness(result: unknown = minimalFixture(), flag = "true", fail = false) {
  const calls: unknown[][] = [];
  const reader = load<typeof import("../lib/assessment/test-overview.ts")>("../lib/assessment/test-overview.ts", {
    "server-only": {}, zod: { z }, "@/lib/rich-text.server": richTextServer,
    "@/lib/tests/presentation-settings": presentation, "@/lib/observability/server-performance": measure,
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (...args: unknown[]) => {
      calls.push(args); return { data: typeof result === "function" ? result() : result, error: fail ? { message: token } : null };
    } }) },
  }, { ASSESSMENT_OVERVIEW_V2: flag });
  return { ...reader, calls };
}

// Feed the same SQL fixture to the REAL V1 readers in the shape returned by PostgREST.
// Only transport is replaced; package eligibility/order and presentation are not copied.
async function readLegacyFromDatabase(db: PGlite, scope: "candidate" | "employee") {
  type Row = Record<string, unknown>;
  const tables = ["companies", "candidates", "employees", "jobs", "employee_assessments", "invitations",
    "employee_assessment_invitations", "assessment_packages", "assessment_package_tests", "test_versions",
    "test_templates", "test_sessions", "employee_assessment_sessions"];
  const records: Record<string, Row[]> = Object.fromEntries(await Promise.all(tables.map(async table =>
    [table, (await db.query<Row>(`select * from public.${table}`)).rows] as const)));
  const version = (versionId: unknown) => {
    const row = records.test_versions.find(entry => entry.id === versionId);
    return row ? { ...row, test_templates: records.test_templates.find(entry => entry.id === row.test_template_id) ?? null } : null;
  };
  const packageRecord = (packageId: unknown) => {
    const row = records.assessment_packages.find(entry => entry.id === packageId);
    return row ? { ...row, assessment_package_tests: records.assessment_package_tests.filter(entry => entry.package_id === packageId)
      .map(entry => ({ ...entry, test_versions: version(entry.test_version_id) })) } : null;
  };
  const transport = { ...records,
    jobs: records.jobs.map(row => ({ ...row, assessment_packages: packageRecord(row.assessment_package_id) })),
    employee_assessments: records.employee_assessments.map(row => ({ ...row, assessment_packages: packageRecord(row.assessment_package_id) })),
    employee_assessment_sessions: records.employee_assessment_sessions.map(row => ({ ...row,
      test_versions: version(row.test_version_id), assessment_packages: packageRecord(row.package_id) })),
  } as Record<string, Row[]>;
  const admin = { from: (table: string) => {
    let filtered = transport[table];
    assert.ok(filtered, `Unexpected V1 table ${table}`);
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => { filtered = filtered.filter(row => row[column] === value); return query; },
      maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: filtered, error: null }).then(resolve),
    };
    return query;
  } };
  const dependencies = {
    "@/lib/supabase/admin": { createAdminClient: () => admin }, "@/lib/observability/server-performance": measure,
    "@/lib/rich-text.server": richTextServer, "@/lib/tests/presentation-settings": presentation,
    "@/lib/tests/content-blocks": contentBlocks, "@/lib/answers/option-shuffle": shuffle, "@/lib/structured-questions": structured,
  };
  return scope === "candidate"
    ? load<typeof import("../lib/assessment/data.ts")>("../lib/assessment/data.ts", dependencies).getAssessmentByToken(token)
    : load<typeof import("../lib/employee-assessments/public-data.ts")>("../lib/employee-assessments/public-data.ts", dependencies).getEmployeeAssessmentByToken(token);
}

test("test overview uses one RPC for either scope, strips extras and sanitizes current instructions", async () => {
  const raw = minimalFixture();
  const html = `${richText.RICH_TEXT_PREFIX}<p onclick="steal()">Read me</p><script>steal()</script>`;
  const payload = { ...raw, employee: { email: "private@example.invalid" }, sessions: ["OTHER CONTENT"],
    session: { ...raw.session, active_client_id_hash: "secret", test: { ...raw.session.test, description: html, instructions: html,
      scoring_config_json: { points: 99 }, presentationSettings: { presentationMode: "one_question", allowBack: false, captureQuestionTime: true, scoringKey: "secret" } } } };
  for (const assessmentType of ["candidate", "employee"] as const) {
    const reader = harness(payload);
    const result = await reader.getAssessmentTestOverview({ ...request, assessmentType }, async () => { throw Error("No full overview"); });
    assert.equal(result.availability, "active");
    assert.deepEqual(reader.calls, [["read_assessment_test_overview_v2", { p_scope: assessmentType, p_token: token, p_session_id: id(50) }]]);
    const json = JSON.stringify(result);
    assert.ok(json.includes("Read me"));
    for (const secret of ["private@example.invalid", "OTHER CONTENT", "secret", "steal", "scoring_config_json"]) assert.ok(!json.includes(secret), secret);
  }
});

test("overview RPC errors and malformed or mismatched responses fail closed without fallback", async () => {
  for (const [data, fail] of [[null, true], [null, false], [{}, false],
    [{ ...minimalFixture(), session: { ...minimalFixture().session, id: id(99) } }, false],
    [{ ...minimalFixture(), completedSessionCount: 4 }, false]] as const) {
    const reader = harness(data, "true", fail);
    await assert.rejects(reader.getAssessmentTestOverview(request, async () => { throw Error("Fallback forbidden"); }),
      error => !String(error).includes(token));
    assert.equal(reader.calls.length, 1);
  }
  const reader = harness();
  for (const invalid of [{ ...request, token: "bad" }, { ...request, sessionId: "bad" }]) {
    assert.deepEqual(await reader.getAssessmentTestOverview(invalid, async () => { throw Error("No fallback"); }), { availability: "invalid" });
  }
  assert.deepEqual(reader.calls, []);
  for (const availability of ["invalid", "expired", "cancelled", "completed", "needs_consent"] as const) {
    assert.deepEqual(await harness({ availability, privateData: token }).getAssessmentTestOverview(request, async () => legacyFixture("candidate")), { availability });
  }
});

test("flag-off overview projects both legacy shapes and retains consent and terminal redirects", async () => {
  for (const scope of ["candidate", "employee"] as const) {
    const reader = harness(null, "false");
    const legacy = legacyFixture(scope);
    assert.deepEqual(await reader.getAssessmentTestOverview({ ...request, assessmentType: scope }, async () => legacy), minimalFixture());
    assert.deepEqual(reader.calls, []);
    assert.deepEqual(reader.projectLegacyTestOverview({ ...legacy, consentGivenAt: null } as AssessmentAvailability, id(50)), { availability: "needs_consent" });
    assert.deepEqual(reader.projectLegacyTestOverview(legacy, id(99)), { availability: "invalid" });
    for (const availability of ["invalid", "expired", "cancelled", "completed"] as const) {
      assert.deepEqual(reader.projectLegacyTestOverview({ ...legacy, availability } as AssessmentAvailability, id(50)), { availability });
    }
  }
});

test("real test pages support all read-flag combinations and reuse legacy overview only within one request", async () => {
  const jsxRuntime = createRequire(import.meta.url)("react/jsx-runtime");
  const Session = () => null;
  type Element = { type: unknown; props?: Record<string, unknown> };
  const findSession = (node: unknown): Element | undefined => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.map(findSession).find(Boolean);
    const element = node as Element;
    return element.type === Session ? element : findSession(element.props?.children);
  };
  for (const scope of ["candidate", "employee"] as const) {
    for (const overviewV2 of [false, true]) for (const sectionV2 of [false, true]) {
      let fullOverviewReads = 0; let fullContentReads = 0; let sectionReads = 0;
      let rpcResult: unknown = minimalFixture();
      const overview = harness(() => rpcResult, String(overviewV2));
      const legacy = legacyFixture(scope);
      const legacyRead = async () => { fullOverviewReads++; return legacy; };
      const legacyContentRead = (_token: string, _sessionId: string, current: unknown) => {
        fullContentReads++; assert.equal(current, legacy); return {};
      };
      const page = load<{ default: (props: unknown) => Promise<Element> }>(
        scope === "candidate" ? "../app/assessment/[token]/test/[sessionId]/page.tsx" : "../app/employee-assessment/[token]/test/[sessionId]/page.tsx", {
          "react/jsx-runtime": jsxRuntime, "next/navigation": { redirect: (path: string) => { throw Error(`redirect:${path}`); } },
          "@/components/assessment/assessment-shell": { AssessmentShell: () => null, AssessmentUnavailable: () => null },
          "@/components/assessment/candidate-test-session": { AssessmentTestSession: Session },
          "@/components/assessment/test-taking-guard": { TestTakingGuard: () => null },
          "@/components/feedback-message": { FeedbackMessage: () => null }, "@/components/ui/rich-text-content": { RichTextContent: () => null },
          "@/lib/assessment/data": { getAssessmentByToken: legacyRead, getAssessmentQuestionPageData: legacyContentRead },
          "@/lib/employee-assessments/public-data": { getEmployeeAssessmentByToken: legacyRead, getEmployeeAssessmentQuestionPageData: legacyContentRead },
          "@/lib/assessment/test-overview": overview,
          "@/lib/assessment/section-data": { getAssessmentSectionSnapshot: async (_input: unknown, fallback: () => unknown) => {
            sectionReads++; if (!sectionV2) await fallback();
            return { section: null, sections: [], answers: {}, sectionIndex: 0, questionOffset: 0, otherVisibleQuestionCount: 0, reviewMode: false };
          } },
        });
      const props = { params: Promise.resolve({ token, sessionId: id(50) }), searchParams: Promise.resolve({}) };
      for (let count = 1; count <= 2; count++) {
        const result = await page.default(props);
        assert.ok(findSession(result));
        assert.ok(!JSON.stringify(findSession(result)?.props).includes("private@example.invalid"));
        assert.equal(fullOverviewReads, overviewV2 && sectionV2 ? 0 : count);
        assert.equal(fullContentReads, sectionV2 ? 0 : count);
        assert.equal(overview.calls.length, overviewV2 ? count : 0);
        assert.equal(sectionReads, count);
      }
      if (overviewV2 && sectionV2) {
        const prefix = scope === "candidate" ? "assessment" : "employee-assessment";
        for (const [payload, suffix] of [
          [{ availability: "needs_consent" }, ""], [{ availability: "completed" }, "/complete"],
          [{ ...minimalFixture(), session: { ...minimalFixture().session, status: "completed" }, nextSessionId: id(51) }, `/test/${id(51)}`],
          [{ ...minimalFixture(), session: { ...minimalFixture().session, status: "completed" }, nextSessionId: null }, "/complete"],
          ...["not_started", "expired", "cancelled"].map(status => [{ ...minimalFixture(), session: { ...minimalFixture().session, status } }, "/profile"]),
        ] as const) {
          rpcResult = payload;
          await assert.rejects(page.default(props), error => String(error) === `Error: redirect:/${prefix}/${token}${suffix}`);
        }
        for (const availability of ["invalid", "expired", "cancelled"]) {
          rpcResult = { availability };
          assert.equal(findSession(await page.default(props)), undefined);
        }
        rpcResult = null;
        await assert.rejects(page.default(props), /Unexpected assessment test overview response/);
        assert.equal(fullOverviewReads, 0); assert.equal(fullContentReads, 0); assert.equal(sectionReads, 2);
      }
    }
  }
});

test("overview SQL preserves progress/eligibility and only returns current test content", async (t) => {
  const db = new PGlite();
  try {
    for (const path of ["./fixtures/session-control-v2.sql", "./fixtures/assessment-test-overview-v2.sql",
      "../supabase/migrations/20260907120000_assessment_test_overview_v2.sql"]) await db.exec(read(path));
    await db.exec(`
      insert into public.companies values ('${id(1)}','Company'), ('${id(2)}','Other Company');
      insert into public.assessment_packages values ('${id(3)}','${id(1)}','Package','private package description'), ('${id(4)}',null,'System',null);
      insert into public.candidates(id,company_id,email) values ('${id(10)}','${id(1)}','private@example.invalid'), ('${id(11)}','${id(2)}','other@example.invalid');
      insert into public.employees(id,company_id,email) select id,company_id,email from public.candidates;
      insert into public.jobs(id,company_id,assessment_package_id,title) values ('${id(12)}','${id(1)}','${id(3)}','Context');
      insert into public.employee_assessments(id,company_id,assessment_package_id,title) select id,company_id,assessment_package_id,title from public.jobs;
      insert into public.candidate_applications(id,company_id,candidate_id,job_id) values ('${id(20)}','${id(1)}','${id(10)}','${id(12)}'), ('${id(21)}','${id(2)}','${id(11)}','${id(12)}');
      insert into public.employee_assessment_participants(id,company_id,employee_id,employee_assessment_id) select id,company_id,candidate_id,job_id from public.candidate_applications;
      insert into public.test_templates values ('${id(25)}','Logical title');
      insert into public.test_versions(id,test_template_id,status,title) values ('${id(30)}','${id(25)}','published','Version 1'), ('${id(31)}','${id(25)}','published','Version 2'), ('${id(32)}','${id(25)}','published','Version 3');
      insert into public.assessment_package_tests values ('${id(3)}','${id(30)}',0), ('${id(3)}','${id(31)}',1), ('${id(3)}','${id(32)}',2);
      insert into public.invitations(id,company_id,application_id,candidate_id,job_id,token,status,consent_given_at,expires_at)
        values ('${id(40)}','${id(1)}','${id(20)}','${id(10)}','${id(12)}','${token}','started',now(),now()+interval '1 day');
      insert into public.employee_assessment_invitations(id,company_id,participant_id,employee_id,employee_assessment_id,token,status,consent_given_at,expires_at)
        select id,company_id,application_id,candidate_id,job_id,token,status,consent_given_at,expires_at from public.invitations;
      insert into public.test_sessions(id,application_id,candidate_id,test_version_id,status) values
        ('${id(49)}','${id(20)}','${id(10)}','${id(30)}','completed'), ('${id(50)}','${id(20)}','${id(10)}','${id(31)}','in_progress'),
        ('${id(51)}','${id(20)}','${id(10)}','${id(32)}','not_started'), ('${id(52)}','${id(21)}','${id(11)}','${id(31)}','in_progress');
      insert into public.employee_assessment_sessions(id,participant_id,employee_id,test_version_id,status,package_id,package_order_index)
        select id,application_id,candidate_id,test_version_id,status,'${id(3)}',case id when '${id(49)}' then 0 when '${id(50)}' then 1 else 2 end from public.test_sessions;
    `);
    for (const scope of ["candidate", "employee"] as const) {
      const employee = scope === "employee";
      const invites = employee ? "employee_assessment_invitations" : "invitations";
      const sessions = employee ? "employee_assessment_sessions" : "test_sessions";
      const people = employee ? "employees" : "candidates";
      const owners = employee ? "employee_assessment_participants" : "candidate_applications";
      const contexts = employee ? "employee_assessments" : "jobs";
      const snapshot = async (overrides: { token?: string | null; session?: string | null; scope?: string | null } = {}) => {
        const result = await db.query<{ result: unknown }>("select public.read_assessment_test_overview_v2($1,$2,$3) as result",
          [Object.hasOwn(overrides, "scope") ? overrides.scope : scope, Object.hasOwn(overrides, "token") ? overrides.token : token,
            Object.hasOwn(overrides, "session") ? overrides.session : id(50)]);
        return result.rows[0].result;
      };
      const scenario = (name: string, run: () => Promise<void>) => t.test(`${scope}: ${name}`, async () => {
        await db.exec("begin"); try { await run(); } finally { await db.exec("rollback"); }
      });
      await scenario("minimal data, template title and counts match V1", async () => {
        const raw = await snapshot();
        const presented = await harness(raw).getAssessmentTestOverview({ ...request, assessmentType: scope }, async () => { throw Error("No legacy"); });
        assert.deepEqual(presented, minimalFixture());
        assert.deepEqual(presented, harness().projectLegacyTestOverview(await readLegacyFromDatabase(db, scope), id(50)));
        await db.exec(`update public.test_versions set settings_json = '{"presentationMode":"one_question","allowBack":false,"captureQuestionTime":true,"scoringKey":"secret"}', instructions = 'Current instruction', description = 'Current description' where id = '${id(31)}'`);
        const updated = JSON.stringify(await snapshot());
        assert.ok(updated.includes("Current instruction")); assert.ok(!updated.includes("scoringKey"));
        assert.ok(!updated.includes("private@example.invalid")); assert.ok(!updated.includes("private package description"));
        assert.ok(!updated.includes("Version 1"));
        const withSettings = await harness(await snapshot()).getAssessmentTestOverview({ ...request, assessmentType: scope }, async () => { throw Error("No legacy"); });
        assert.deepEqual(withSettings, harness().projectLegacyTestOverview(await readLegacyFromDatabase(db, scope), id(50)));
      });
      await scenario("other test descriptions and instructions do not grow the response", async () => {
        const before = JSON.stringify(await snapshot());
        await db.exec(`update public.test_versions set instructions = repeat('OTHER TEST CONTENT',10000), description = repeat('unused',10000), settings_json = jsonb_build_object('scoringKey',repeat('secret',10000)) where id <> '${id(31)}'`);
        assert.equal(JSON.stringify(await snapshot()), before);
        await db.exec(`
          insert into public.test_versions(id,test_template_id,status,title,instructions)
            select md5('overview-version-' || g)::uuid,'${id(25)}','published','OTHER TEST',repeat('unused instruction',1000) from generate_series(1,200) g;
          insert into public.assessment_package_tests(package_id,test_version_id,order_index)
            select '${id(3)}',md5('overview-version-' || g)::uuid,100+g from generate_series(1,200) g;
          insert into public.${sessions}(id,${employee ? "participant_id,employee_id" : "application_id,candidate_id"},test_version_id,status)
            select md5('overview-session-' || g)::uuid,'${id(20)}','${id(10)}',md5('overview-version-' || g)::uuid,'not_started' from generate_series(1,200) g;
        `);
        const larger = await snapshot() as ReturnType<typeof minimalFixture>;
        assert.equal(larger.sessionCount, 203);
        assert.ok(JSON.stringify(larger).length - before.length < 20);
      });
      await scenario("foreign identities, tenant chains and invalid parameters fail closed", async () => {
        for (const override of [{ token: "bad" }, { token: "b".repeat(64) }, { token: null }, { scope: "invalid" }, { scope: null },
          { session: null }, { session: id(52) }, { session: id(99) }]) assert.deepEqual(await snapshot(override), { availability: "invalid" });
        for (const table of [invites, people, owners, contexts]) {
          await db.exec("savepoint denied");
          await db.exec(`update public.${table} set company_id = '${id(2)}' where company_id = '${id(1)}'`);
          assert.deepEqual(await snapshot(), { availability: "invalid" });
          await db.exec("rollback to savepoint denied");
        }
        await db.exec(`update public.${sessions} set ${employee ? "employee_id" : "candidate_id"} = '${id(11)}' where id = '${id(50)}'`);
        assert.deepEqual(await snapshot(), { availability: "invalid" });
      });
      await scenario("consent, expiry and terminal invitations expose only a state and do not write", async () => {
        for (const [field, availability] of [["consent_given_at = null", "needs_consent"], ["status = 'cancelled'", "cancelled"],
          ["status = 'expired'", "expired"], ["expires_at = now() - interval '1 second'", "expired"],
          ["status = 'completed', expires_at = now() - interval '1 day'", "completed"]]) {
          await db.exec("savepoint state_test"); await db.exec(`update public.${invites} set ${field}`);
          const before = await db.exec(`select * from public.${invites}; select * from public.${sessions} order by id`);
          assert.deepEqual(await snapshot(), { availability });
          assert.deepEqual(await db.exec(`select * from public.${invites}; select * from public.${sessions} order by id`), before);
          await db.exec("rollback to savepoint state_test");
        }
        await db.exec(`update public.${invites} set status = 'sent', consent_given_at = null, expires_at = null`);
        assert.deepEqual(await snapshot(), { availability: "needs_consent" });
      });
      await scenario("eligibility retains scope-specific package and archived-version behavior", async () => {
        await db.exec(`update public.test_versions set status = 'archived' where id = '${id(31)}'`);
        if (!employee) assert.deepEqual(await snapshot(), { availability: "invalid" });
        else {
          assert.ok(JSON.stringify(await snapshot()).includes('"sessionCount":3'));
          await db.exec(`update public.employee_assessments set assessment_package_id = '${id(4)}'`);
          const raw = await snapshot();
          assert.deepEqual(await harness(raw).getAssessmentTestOverview({ ...request, assessmentType: scope }, async () => { throw Error("No legacy"); }), minimalFixture());
        }
        const changed = await harness(await snapshot()).getAssessmentTestOverview({ ...request, assessmentType: scope }, async () => { throw Error("No legacy"); });
        assert.deepEqual(changed, harness().projectLegacyTestOverview(await readLegacyFromDatabase(db, scope), id(50)));
      });
      await scenario("progress and next session use package order, not requested-session position", async () => {
        await db.exec(`update public.${sessions} set status = 'in_progress' where id = '${id(51)}'`);
        await db.exec(`update public.assessment_package_tests set order_index = -1 where test_version_id = '${id(32)}'`);
        const result = await snapshot() as ReturnType<typeof minimalFixture>;
        assert.equal(result.nextSessionId, id(51)); assert.equal(result.completedSessionCount, 1);
        await db.exec(`update public.${sessions} set status = 'completed' where id = '${id(50)}'`);
        assert.equal((await snapshot() as ReturnType<typeof minimalFixture>).session.status, "completed");
        await db.exec(`update public.${sessions} set deadline_at = '2026-09-07T15:00:00Z', status = 'expired' where id = '${id(50)}'`);
        const expired = await snapshot() as ReturnType<typeof minimalFixture>;
        assert.equal(expired.session.status, "expired");
        assert.equal(new Date(expired.session.deadlineAt!).toISOString(), "2026-09-07T15:00:00.000Z");
      });
      await scenario("service-only STABLE function and deployment verification, with no write access needed", async () => {
        const before = await db.exec(`select * from public.${invites}; select * from public.${sessions} order by id`);
        await db.exec("set local role service_role"); assert.ok(await snapshot()); await db.exec("reset role");
        assert.deepEqual(await db.exec(`select * from public.${invites}; select * from public.${sessions} order by id`), before);
        for (const role of ["anon", "authenticated"]) {
          await db.exec("savepoint role_test"); await db.exec(`set local role ${role}`);
          await assert.rejects(snapshot(), /permission denied/); await db.exec("rollback to savepoint role_test");
        }
        const verification = await db.exec(read("../supabase/verification/assessment_test_overview_v2.sql"));
        assert.deepEqual(verification[0].rows, [{ signature: "public.read_assessment_test_overview_v2(text,text,uuid)",
          installed: true, permissions_ok: true, stable_snapshot: true }]);
      });
    }
  } finally { await db.close(); }
});
