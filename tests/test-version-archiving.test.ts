import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260827120000_archive_old_test_versions.sql",
    import.meta.url,
  ),
  "utf8",
);
const companyActions = readFileSync(new URL("../lib/tests/actions.ts", import.meta.url), "utf8");
const adminActions = readFileSync(
  new URL("../lib/admin/test-actions.ts", import.meta.url),
  "utf8",
);

test("only a superseded published version can be archived", () => {
  assert.match(migration, /selected_version_status <> 'published'/);
  assert.match(
    migration,
    /newer_version\.status = 'published'[\s\S]*newer_version\.version_number > selected_version_number/,
  );
  assert.match(migration, /TEST_VERSION_ARCHIVE_NOT_SUPERSEDED/);
});

test("archiving blocks live dependencies but preserves historical publication data", () => {
  assert.match(migration, /from public\.assessment_package_tests/);
  assert.equal((migration.match(/status in \('not_started', 'in_progress'\)/g) ?? []).length, 2);
  assert.match(migration, /set[\s\S]*archived_at = now\(\),[\s\S]*status = 'archived'/);
  assert.doesNotMatch(
    migration.slice(migration.indexOf("create or replace function public.archive_old_test_version")),
    /delete from public\.(test_results|candidate_reports|employee_assessment_reports)/,
  );
});

test("archived published content remains immutable and readable in historical reports", () => {
  assert.ok((migration.match(/version\.published_at is not null/g) ?? []).length >= 7);
  assert.match(migration, /test_versions\.status in \('published', 'archived'\)/);
  assert.match(migration, /version\.status in \('published', 'archived'\)/);
  assert.match(migration, /Published test versions cannot be deleted/);
  assert.match(migration, /Archived test versions cannot be edited/);
});

test("company and platform actions use the atomic archive RPC", () => {
  assert.match(companyActions, /rpc\("archive_old_test_version"/);
  assert.match(adminActions, /rpc\("archive_old_test_version"/);
  assert.match(migration, /insert into public\.company_audit_logs/);
  assert.match(migration, /insert into public\.platform_audit_logs/);
});
