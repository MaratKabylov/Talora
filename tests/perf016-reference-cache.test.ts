import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const cities = read("../lib/reference-data/system-cities.ts");
const profile = read("../app/(dashboard)/dashboard/profile/page.tsx");
const adminActions = read("../lib/admin/actions.ts");
const companyActions = read("../lib/company/actions.ts");
const importSchemaRoute = read("../app/api/tests/import-schema/route.ts");

test("system city cache is global reference data with a bounded TTL and tag", () => {
  assert.match(cities, /import "server-only"/);
  assert.match(cities, /\.select\("id, name, is_active"\)/);
  assert.match(cities, /\["reference", "system-cities", "v1"\]/);
  assert.match(cities, /revalidate: 60 \* 60/);
  assert.match(cities, /tags: \[SYSTEM_CITIES_CACHE_TAG\]/);
  assert.doesNotMatch(cities, /company_id|invitation|token|answer|session/);
});

test("profile authenticates before reading cached cities and admin mutations invalidate them", () => {
  assert.ok(
    profile.indexOf("await requireCompanyContext()") <
      profile.indexOf("listCachedSystemCities()"),
  );
  assert.equal((adminActions.match(/updateTag\(SYSTEM_CITIES_CACHE_TAG\)/g) ?? []).length, 2);
  assert.match(companyActions, /\.from\("system_cities"\)[\s\S]*\.select\("id, name, is_active"\)/);
  assert.doesNotMatch(companyActions, /listCachedSystemCities/);
});

test("versioned import schemas are explicitly public-cacheable", () => {
  assert.match(importSchemaRoute, /version === "v2"/);
  assert.match(
    importSchemaRoute,
    /"Cache-Control": "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800"/,
  );
  assert.match(importSchemaRoute, /schema-\$\{useV2 \? "v2" : "v1"\}\.json/);

  const v1 = JSON.parse(read("../docs/08_TALVIA_TEST_IMPORT_SCHEMA_V1.json"));
  const v2 = JSON.parse(read("../docs/13_TALVIA_TEST_IMPORT_SCHEMA_V2.json"));
  assert.equal(v1.properties.schema_version.const, "talvia.test.v1");
  assert.equal(v2.properties.schema_version.const, "talvia.test.v2");
});
