import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";


const publicSchema = JSON.parse(
  readFileSync(
    new URL("../docs/13_TALVIA_TEST_IMPORT_SCHEMA_V2.json", import.meta.url),
    "utf8",
  ),
) as {
  properties: {
    schema_version: { const: string };
    scoring: {
      properties: Record<string, unknown>;
      required: string[];
    };
  };
};

const migration = readFileSync(
  new URL("../supabase/migrations/20260823170000_scoring_v2_import.sql", import.meta.url),
  "utf8",
);
const sjtMigration = readFileSync(
  new URL("../supabase/migrations/20260823210000_sjt_scoring_model.sql", import.meta.url),
  "utf8",
);
const hardeningMigration = readFileSync(
  new URL("../supabase/migrations/20260824120000_scoring_v2_hardening.sql", import.meta.url),
  "utf8",
);

test("talvia.test.v2 exposes explicit item models and score interpretation", () => {
  assert.equal(publicSchema.properties.schema_version.const, "talvia.test.v2");
  assert.deepEqual(
    publicSchema.properties.scoring.required,
    ["scoring_version", "assessment_domain", "result_shape", "dimensions", "items"],
  );
  for (const property of [
    "dimensions",
    "items",
    "thresholds",
    "composites",
    "norm_assignments",
    "overall_score",
    "learning_scoring",
  ]) {
    assert.ok(property in publicSchema.properties.scoring.properties, property);
  }
  const serialized = JSON.stringify(publicSchema.properties.scoring.properties.items);
  assert.match(serialized, /reverse_scored/);
  assert.match(serialized, /item_weight/);
  assert.match(serialized, /dimension_effects/);
  assert.match(serialized, /signal_classification/);
  assert.match(serialized, /forced_choice/);
  assert.match(serialized, /sjt/);
  assert.match(
    JSON.stringify(publicSchema.properties.scoring.properties.assessment_domain),
    /learning/,
  );
  assert.match(
    JSON.stringify(publicSchema.properties.scoring.properties.assessment_domain),
    /attention/,
  );
});

test("v2 database import wraps v1 atomically and maps option keys to stored UUIDs", () => {
  assert.match(migration, /public\.import_company_test_v1/);
  assert.match(migration, /public\.import_system_test_v1/);
  assert.match(migration, /perform public\.apply_talvia_scoring_v2/);
  assert.match(migration, /statementId', option_row\.id::text/);
  assert.match(migration, /'thresholds', thresholds_json/);
  assert.match(migration, /scoring_schema_version = '2\.0'/);
  assert.match(sjtMigration, /apply_talvia_scoring_v2_pre_sjt/);
  assert.match(sjtMigration, /'optionId', option_row\.id::text/);
  assert.match(sjtMigration, /set scoring_model = 'sjt'/);
  assert.match(hardeningMigration, /apply_talvia_scoring_v2_pre_attention/);
  assert.match(hardeningMigration, /'signalClassification'/);
  assert.match(hardeningMigration, /'targetPresent'/);
});
