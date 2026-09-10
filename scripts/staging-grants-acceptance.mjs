// Uses only the isolated test identity/companies from a completed staging-list run.
import { randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { listPage } from "../lib/lists/pagination.ts";

const one = value => Array.isArray(value) ? value[0] : value;
const checked = (response, label) => { if (response.error) throw new Error(label); return response.data; };
const requireCheck = (value, name) => { if (!value) throw new Error(name); };

export async function runGrantChecks(env, sourcePath) {
  const source = JSON.parse(await readFile(sourcePath, "utf8"));
  requireCheck(source.completed && source.companies.length === 2, "Incomplete staging fixture");
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  requireCheck(createHash("sha256").update(new URL(url).origin).digest("hex") === source.projectFingerprint, "Project does not match fixture");
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(30000) }),
  } };
  const service = createClient(url, env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY, options);
  const client = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
  const identity = source.users.find(u => u.label === "dual");
  requireCheck(identity, "Fixture dual user missing");
  const [a, b] = source.companies.map(c => c.id);
  const user = checked(await service.auth.admin.getUserById(identity.id), "Load fixture identity").user;
  requireCheck(user.user_metadata?.perf_run_id === source.runId && user.email?.endsWith("@example.invalid"), "Identity ownership mismatch");
  const companies = checked(await service.from("companies").select("id,name").in("id", [a, b]), "Load fixture companies");
  requireCheck(companies.length === 2 && companies.every(c => c.name.startsWith(source.prefix)), "Company ownership mismatch");
  const report = { runId: source.runId, startedAt: new Date().toISOString(), completed: false, checks: [], shutdown: [],
    scope: "Synthetic dual user only; existing published system package contents are read by ID, never modified. Grants are created only on the two synthetic companies and moved A to B for revoke coverage." };
  const save = () => writeFile(resolve(dirname(sourcePath), "grants-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const check = (name, passed) => { report.checks.push({ name, passed: !!passed }); requireCheck(passed, name); };
  await writeFile(resolve(dirname(sourcePath), "grants-report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  try {
    const packages = checked(await service.from("assessment_packages")
      .select("id,assessment_package_tests(test_versions(test_template_id,status,test_templates(is_system,status)))")
      .eq("is_system", true).is("company_id", null).limit(10).limit(31, { referencedTable: "assessment_package_tests" }), "Read system package metadata");
    const eligible = packages.find(p => p.assessment_package_tests.length > 0 && p.assessment_package_tests.length <= 30 && p.assessment_package_tests.every(pt => {
      const v = one(pt.test_versions), t = one(v?.test_templates);
      return v?.status === "published" && t?.is_system && t?.status === "active";
    }));
    requireCheck(eligible, "No bounded published system package available for grant test");
    const templateIds = [...new Set(eligible.assessment_package_tests.map(pt => one(pt.test_versions).test_template_id))];
    const existing = checked(await service.from("company_system_test_access").select("test_template_id").in("company_id", [a, b]), "Check fresh grants");
    requireCheck(existing.length === 0, "Fixture already has grants; refuse to overwrite");
    const password = randomBytes(36).toString("base64url");
    checked(await service.auth.admin.updateUserById(identity.id, { password, ban_duration: "none" }), "Activate fixture identity");
    checked(await service.from("company_users").update({ status: "active" }).eq("user_id", identity.id).in("company_id", [a, b]), "Activate fixture memberships");
    checked(await client.auth.signInWithPassword({ email: user.email, password }), "Sign in fixture identity");

    const templates = company => client.rpc("list_company_test_templates", { target_company_id: company }, { get: true }).select("id").in("id", templateIds);
    const packageQuery = company => client.rpc("list_company_assessment_packages", { target_company_id: company }, { get: true }).select("id").eq("id", eligible.id);
    check("system-templates-initially-hidden", checked(await templates(a), "Before grant templates").length === 0);
    check("system-package-initially-hidden", checked(await packageQuery(a), "Before grant package").length === 0);
    checked(await service.from("company_system_test_access").insert(templateIds.map(test_template_id => ({ company_id: a, test_template_id }))), "Grant fixture A");
    check("system-templates-granted-A", checked(await templates(a), "Granted A templates").length === templateIds.length);
    check("system-package-granted-A", checked(await packageQuery(a), "Granted A package").length === 1);
    check("dual-membership-does-not-leak-templates-to-B", checked(await templates(b), "Unprivileged B templates").length === 0);
    check("dual-membership-does-not-leak-package-to-B", checked(await packageQuery(b), "Unprivileged B package").length === 0);

    // Move only the grant rows created immediately above; do not delete anything.
    checked(await service.from("company_system_test_access").update({ company_id: b }).eq("company_id", a).in("test_template_id", templateIds), "Move fixture grants A to B");
    check("templates-revoked-from-A", checked(await templates(a), "Revoked A templates").length === 0);
    check("package-revoked-from-A", checked(await packageQuery(a), "Revoked A package").length === 0);
    check("templates-visible-to-B-after-move", checked(await templates(b), "Granted B templates").length === templateIds.length);
    check("package-visible-to-B-after-move", checked(await packageQuery(b), "Granted B package").length === 1);

    // Traverse the three remaining date-list read models with real RPC/view queries.
    for (const [name, rpc, view] of [["templates", "list_company_test_templates", null], ["packages", "list_company_assessment_packages", null], ["assessments", null, "employee_assessment_list"]]) {
      const make = actor => rpc ? actor.rpc(rpc, { target_company_id: a }, { get: true }).select("id,updated_at").eq("is_system", false)
        : actor.from(view).select("id,updated_at").eq("company_id", a);
      // Authenticated baseline is restricted to the synthetic A company and <=107 rows.
      for (const sort of ["date_asc", "date_desc"]) {
        const expected = checked(await make(client).order("updated_at", { ascending: sort === "date_asc" }).order("id").limit(200), "Bounded baseline");
        const seen = []; let cursor;
        do {
          const page = listPage([name, a], "updated_at", { sort, pageSize: "50", cursor });
          const rows = checked(await page.apply(make(client)), "Traverse read model");
          const result = page.finish(rows); seen.push(...result.items.map(r => r.id)); cursor = result.nextCursor;
          requireCheck(seen.length <= expected.length, "Read model cursor must advance");
        } while (cursor);
        check(`${name}:${sort}:no-gaps`, seen.length === expected.length && seen.every((id, n) => id === expected[n].id));
      }
    }
    checked(await service.from("company_users").update({ status: "disabled" }).eq("user_id", identity.id).eq("company_id", b), "Disable fixture B membership");
    check("disabled-membership-hides-system-grant", checked(await templates(b), "Disabled B templates").length === 0);
    check("disabled-membership-hides-system-package", checked(await packageQuery(b), "Disabled B package").length === 0);
    report.grantedTemplateCount = templateIds.length; report.completed = true;
  } catch {
    report.failure = "Grant/list acceptance incomplete; inspect the named checks and prerequisite fixture, no raw error was saved.";
  } finally {
    const membership = await service.from("company_users").update({ status: "disabled" }).eq("user_id", identity.id).in("company_id", [a, b]);
    const ban = await service.auth.admin.updateUserById(identity.id, { ban_duration: "8760h" });
    const signOut = await client.auth.signOut({ scope: "global" });
    report.shutdown = [{ name: "disable-memberships", passed: !membership.error }, { name: "ban-test-user", passed: !ban.error }, { name: "revoke-sessions", passed: !signOut.error }];
    report.finishedAt = new Date().toISOString(); await save();
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== "--execute" || !process.argv[3]) throw new Error("Use --execute <staging report path> only for an authorized test fixture.");
  const env = {};
  for (const name of [".env", ".env.local"]) { try { Object.assign(env, parseEnv(await readFile(name, "utf8"))); } catch (error) { if (error.code !== "ENOENT") throw error; } }
  Object.assign(env, process.env);
  const report = await runGrantChecks(env, resolve(process.argv[3]));
  console.log(JSON.stringify({ completed: report.completed, checks: report.checks, shutdown: report.shutdown, failure: report.failure ?? null }));
  if (!report.completed || report.shutdown.some(check => !check.passed)) process.exitCode = 1;
}
