import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { comparisonPage, DEFAULT_COMPARISON_FILTERS } from "../lib/comparison/pagination.ts";

const read = (name: string) => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const id = (n: number) => `fa100000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const migration = read("20260909140000_dashboard_list_read_models");

test("list views execute production DDL and SELECT policies with caller RLS", async (t) => {
  const db = new PGlite();
  try {
    // Local auth stand-in only; business DDL and SELECT policies below are production SQL.
    await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function public.is_company_member(target uuid) returns boolean language sql stable as
      $$ select target::text = current_setting('test.company', true) $$;
      create function public.current_user_can_access_system_test(target uuid) returns boolean language sql stable as
      $$ select target::text = current_setting('test.system', true) $$;
      create function public.current_user_can_access_system_package(target uuid) returns boolean language sql stable as
      $$ select target::text = current_setting('test.package', true) $$;`);
    const initial = read("20260525000000_initial_schema");
    await db.exec(initial.slice(initial.indexOf("create table if not exists public.companies"), initial.indexOf("create or replace function")));
    const employee = read("20260607100000_employee_assessments");
    await db.exec(employee.slice(employee.indexOf("create table"), employee.indexOf("drop trigger")));
    const policies: [string, string][] = [
      [initial, "members can read jobs"], [initial, "members can read applications"],
      [employee, "members can read employees"], [employee, "members can read employee assessments"],
      [employee, "members can read employee assessment participants"],
      [read("20260531100000_company_test_access_controls"), "members can read accessible test templates"],
      [read("20260827120000_archive_old_test_versions"), "members can read accessible test versions"],
      [read("20260607110000_assessment_package_management"), "members can read package tests"],
    ];
    for (const [source, name] of policies) {
      const start = source.indexOf(`create policy "${name}"`);
      assert.notEqual(start, -1, name);
      await db.exec(source.slice(start, source.indexOf(";", start) + 1));
    }
    // Package read policy comes from the system package access migration.
    const files = ["20260525000000_initial_schema", "20260531100000_company_test_access_controls"];
    const packagePolicy = files.map(read).flatMap(source => source.match(/create policy "[^"]+"\s+on public.assessment_packages for select to authenticated[\s\S]*?;/g) ?? []).at(-1);
    assert.ok(packagePolicy);
    await db.exec(packagePolicy);
    for (const table of ["jobs", "candidate_applications", "test_templates", "test_versions", "assessment_packages",
      "assessment_package_tests", "employees", "employee_assessments", "employee_assessment_participants"]) {
      await db.exec(`alter table public.${table} enable row level security`);
    }
    await db.exec(`grant usage on schema public to authenticated, anon, service_role;
      grant select on all tables in schema public to authenticated, service_role;`);
    await db.exec(migration);
    // Company-scoped access helpers are local stand-ins; the new RPC and views
    // execute their production DDL and the selected production RLS policies.
    await db.exec(`create function public.company_can_access_system_test(company uuid, target uuid)
      returns boolean language sql stable as $$ select public.is_company_member(company)
        and target::text = current_setting('test.granted_system', true) $$;
      create function public.company_can_access_system_package(company uuid, target uuid)
      returns boolean language sql stable as $$ select public.is_company_member(company)
        and target::text = current_setting('test.granted_package', true) $$;`);
    await db.exec(read("20260909160000_dashboard_list_pagination"));
    const paginationChecks = (await db.query<{ check_name: string; passed: boolean }>(readFileSync(
      new URL("../supabase/verification/dashboard_list_pagination.sql", import.meta.url), "utf8"))).rows;
    assert.equal(paginationChecks.length, 13);
    assert.deepEqual(paginationChecks.filter(row => !row.passed), []);
    const verification = readFileSync(new URL("../supabase/verification/dashboard_list_read_models.sql", import.meta.url), "utf8");
    const verificationRows = (await db.query<{ check_name: string; passed: boolean }>(verification)).rows;
    assert.equal(verificationRows.length, 19);
    assert.deepEqual(verificationRows.filter(row => !row.passed), []);
    await db.exec(`insert into companies(id,name) values ('${id(1)}','A'),('${id(2)}','B');
      insert into assessment_packages(id,company_id,title,is_system) values
        ('${id(10)}','${id(1)}','Own',false),('${id(11)}','${id(2)}','Other',false),('${id(12)}',null,'System',true);
      insert into test_templates(id,company_id,title,is_system) values
        ('${id(20)}','${id(1)}','Own',false),('${id(21)}','${id(2)}','Other',false),('${id(22)}',null,'System',true),('${id(23)}','${id(1)}','Empty',false);
      insert into test_versions(id,test_template_id,title,version_number,status,published_at,duration_minutes) values
        ('${id(30)}','${id(20)}','Published',1,'published',now(),10),('${id(31)}','${id(20)}','Draft',2,'draft',null,20),
        ('${id(32)}','${id(22)}','System published',1,'published',now(),15),('${id(33)}','${id(22)}','Hidden system draft',2,'draft',null,30);
      insert into assessment_package_tests(package_id,test_version_id,order_index,is_required) values
        ('${id(10)}','${id(30)}',0,true),('${id(10)}','${id(31)}',1,false),('${id(12)}','${id(32)}',0,true);
      insert into employee_assessments(id,company_id,assessment_package_id,title) values
        ('${id(40)}','${id(1)}','${id(10)}','Own'),('${id(41)}','${id(2)}','${id(11)}','Other'),('${id(42)}','${id(1)}','${id(10)}','Empty');
      insert into employees(id,company_id,full_name,email,department,role_title) values
        ('${id(50)}','${id(1)}','One','one@example.test','Engineering','Developer'),
        ('${id(51)}','${id(1)}','Two','two@example.test','Engineering','Developer'),
        ('${id(52)}','${id(2)}','Other','other@example.test','Private','Private');
      insert into employee_assessment_participants(id,company_id,employee_assessment_id,employee_id,status,fit_score) values
        ('${id(60)}','${id(1)}','${id(40)}','${id(50)}','completed',80),
        ('${id(61)}','${id(1)}','${id(40)}','${id(51)}','invited',null),
        ('${id(62)}','${id(2)}','${id(41)}','${id(52)}','completed',10);
      insert into jobs(id,company_id,title) values ('${id(70)}','${id(1)}','Own'),('${id(71)}','${id(2)}','Other');
      insert into candidates(id,full_name) values ('${id(80)}','One'),('${id(81)}','Two'),('${id(82)}','Other');
      insert into candidate_applications(id,company_id,job_id,candidate_id,status,fit_score) values
        ('${id(90)}','${id(1)}','${id(70)}','${id(80)}','completed',60),
        ('${id(91)}','${id(1)}','${id(70)}','${id(81)}','shortlisted',80),
        ('${id(92)}','${id(2)}','${id(71)}','${id(82)}','completed',10);
      set role authenticated; set test.company = '${id(1)}'; set test.system = '${id(22)}'; set test.package = '${id(12)}';`);

    await t.test("test summaries expose visible latest/published versions, counts, empty templates; no rich payload", async () => {
      const rows = (await db.query<Record<string, unknown>>("select * from test_template_list order by id")).rows;
      assert.deepEqual(rows.map(row => row.id), [id(20), id(22), id(23)]);
      assert.equal(rows[0].latest_version_id, id(31)); assert.equal(rows[0].published_version_id, id(30));
      assert.equal(Number(rows[0].version_count), 2); assert.equal(rows[0].has_draft, true);
      assert.equal(rows[1].latest_version_id, id(32)); assert.equal(Number(rows[1].version_count), 1);
      assert.equal(rows[1].has_draft, false); assert.equal(rows[2].latest_version_id, null);
      assert.equal(Number(rows[2].version_count), 0);
      assert.deepEqual(Object.keys(rows[0]), ["id", "company_id", "title", "category", "is_system", "status", "updated_at",
        "latest_version_id", "latest_version_number", "latest_version_status", "published_version_id", "published_version_number",
        "published_version_status", "version_count", "has_draft"]);
    });
    await t.test("package aggregates match the old visible child joins", async () => {
      const rows = (await db.query<Record<string, unknown>>("select * from assessment_package_list order by id")).rows;
      assert.deepEqual(rows.map(row => row.id), [id(10), id(12)]);
      assert.equal(Number(rows[0].test_count), 2); assert.equal(Number(rows[0].required_count), 1);
      assert.equal(Number(rows[0].duration_minutes), 30);
      assert.deepEqual(Object.keys(rows[0]), ["id", "company_id", "title", "is_system", "updated_at", "test_count", "required_count", "duration_minutes"]);
    });
    await t.test("employee counts, null average and filter options are isolated and independent of participant payload", async () => {
      const rows = (await db.query<Record<string, unknown>>("select * from employee_assessment_list order by id")).rows;
      assert.deepEqual(rows.map(row => row.id), [id(40), id(42)]);
      assert.equal(Number(rows[0].participant_count), 2); assert.equal(Number(rows[0].completed_count), 1);
      assert.equal(Number(rows[0].average_fit_score), 80); assert.equal(rows[1].average_fit_score, null);
      assert.equal(Number(rows[1].participant_count), 0);
      assert.deepEqual(Object.keys(rows[0]), ["id", "company_id", "title", "status", "updated_at", "assessment_package_title", "participant_count", "completed_count", "average_fit_score"]);
      const filters = (await db.query<{ departments: string[]; role_titles: string[] }>(`select departments,role_titles from employee_comparison_filters where id='${id(40)}'`)).rows[0];
      assert.deepEqual(filters, { departments: ["Engineering"], role_titles: ["Developer"] });
      assert.equal((await db.query(`select * from employee_assessment_list where company_id='${id(2)}'`)).rows.length, 0);
    });
    await t.test("job comparison overview counts completed/shortlisted and excludes other tenants", async () => {
      const rows = (await db.query<Record<string, unknown>>("select * from job_comparison_summary")).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].id, id(70));
      assert.equal(Number(rows[0].participant_count), 2); assert.equal(Number(rows[0].completed_count), 2);
      assert.equal(Number(rows[0].shortlisted_count), 1); assert.equal(Number(rows[0].average_fit_score), 70);
    });
    await t.test("tenant list RPCs enforce the requested company even when RLS exposes a system item via another membership", async () => {
      await db.exec(`set test.granted_system = '${id(22)}'; set test.granted_package = '${id(12)}';`);
      for (const [rpc, expected] of [["list_company_test_templates", [id(20), id(22), id(23)]],
        ["list_company_assessment_packages", [id(10), id(12)]]] as const) {
        assert.deepEqual((await db.query<{ id: string }>(`select id from ${rpc}('${id(1)}') order by id`)).rows.map(row => row.id), expected);
        assert.equal((await db.query(`select id from ${rpc}('${id(2)}')`)).rows.length, 0);
      }
      // Global RLS visibility remains, but the chosen tenant's grant is revoked.
      await db.exec("set test.granted_system = ''; set test.granted_package = '';");
      assert.equal((await db.query(`select id from test_template_list where is_system`)).rows.length, 1);
      assert.equal((await db.query(`select id from list_company_test_templates('${id(1)}') where is_system`)).rows.length, 0);
      assert.equal((await db.query(`select id from list_company_assessment_packages('${id(1)}') where is_system`)).rows.length, 0);
      await db.exec("reset role; set role anon;");
      for (const rpc of ["list_company_test_templates", "list_company_assessment_packages"]) {
        await assert.rejects(db.query(`select * from ${rpc}('${id(1)}')`), /permission denied/);
      }
      await db.exec("reset role; set role authenticated;");
    });
    await t.test("revoked system access changes counts; no-member and anon cannot obtain list data", async () => {
      await db.exec("set test.system = ''; set test.package = '';");
      assert.equal((await db.query(`select * from test_template_list where id='${id(22)}'`)).rows.length, 0);
      await db.exec("set test.company = '';");
      assert.equal((await db.query("select * from employee_assessment_list")).rows.length, 0);
      await db.exec("reset role; set role anon;");
      for (const view of ["test_template_list", "assessment_package_list", "employee_assessment_list", "job_comparison_summary", "employee_comparison_filters"]) {
        await assert.rejects(db.query(`select * from ${view}`), /permission denied/);
      }
      await db.exec("reset role; set role service_role;");
      assert.equal((await db.query("select * from test_template_list")).rows.length, 4);
      await assert.rejects(db.exec(`delete from test_template_list where id='${id(20)}'`), /permission denied|cannot delete/);
    });
    await t.test("keyset traverses real SQL with equal and null scores, ascending and descending", async () => {
      await db.exec("reset role; create temporary table cursor_rows(id uuid, fit_score numeric);");
      for (let n = 1; n <= 127; n++) await db.query("insert into cursor_rows values ($1,$2)", [id(1000+n), n > 95 ? null : n % 3 * 25]);
      for (const sort of ["fit_asc", "fit_desc"] as const) {
        let cursor: string | undefined; const seen: string[] = [];
        do {
          const page = comparisonPage(id(1), id(40), { ...DEFAULT_COMPARISON_FILTERS, sort }, cursor);
          // Compile only the small validated PostgREST predicate produced by the cursor helper.
          const where = page.predicate?.replaceAll(/fit_score\.(gt|lt|eq)\.([0-9.]+)/g, (_, op, v) => `fit_score ${{gt:">",lt:"<",eq:"="}[op as "gt"]} ${v}`)
            .replaceAll(/id\.gt\.([a-f0-9-]+)/g, "id > '$1'").replaceAll("fit_score.is.null", "fit_score is null")
            .replaceAll(/and\(([^,]+),([^()]+)\)/g, "($1 and $2)").replaceAll(",", " or ");
          const rows = (await db.query<{ id: string; fit_score: number | null }>(`select id, fit_score::float8 as fit_score from cursor_rows ${where ? `where ${where}` : ""} order by fit_score ${page.ascending ? "asc" : "desc"} nulls last, id asc limit 51`)).rows;
          const result = page.finish(rows); seen.push(...result.items.map(row => row.id)); cursor = result.nextCursor ?? undefined;
        } while (cursor);
        const expected = (await db.query<{ id: string }>(`select id from cursor_rows order by fit_score ${sort === "fit_asc" ? "asc" : "desc"} nulls last, id asc`)).rows.map(row => row.id);
        assert.deepEqual(seen, expected); assert.equal(new Set(seen).size, 127);
      }
    });
  } finally { await db.close(); }
});
