import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileFunction } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";

import * as multipleChoice from "../lib/answers/multiple-choice.ts";
import * as legacyRegistry from "../lib/assessment-results/legacy-registry.ts";
import * as forcedChoice from "../lib/forced-choice.ts";
import * as scoringTypes from "../lib/scoring/types.ts";
import * as structuredQuestions from "../lib/structured-questions.ts";
import * as builderConstants from "../lib/tests/builder-constants.ts";
import * as testConstants from "../lib/tests/constants.ts";
import * as importScoring from "../lib/tests/import-scoring.ts";
import * as remediation from "../lib/tests/remediation.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const { outputText } = transpileModule(read(path), {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
  });
  const exports = {};
  compileFunction(outputText, ["exports", "require"])(exports, (specifier: string) => {
    assert.ok(Object.hasOwn(dependencies, specifier), `Unexpected dependency ${specifier}`);
    return dependencies[specifier];
  });
  return exports as T;
}

const definition = load<typeof import("../lib/scoring/definition.ts")>(
  "../lib/scoring/definition.ts",
  { "./types.ts": scoringTypes, zod: { z } },
);
const importParser = load<typeof import("../lib/tests/import-parser.ts")>(
  "../lib/tests/import-parser.ts",
  {
    "@/lib/answers/multiple-choice": multipleChoice,
    "@/lib/assessment-results/legacy-registry": legacyRegistry,
    "@/lib/forced-choice": forcedChoice,
    "@/lib/rich-text.server": {
      sanitizeRichTextValue: (value: string | null | undefined) => value?.trim() || null,
    },
    "@/lib/tests/builder-constants": builderConstants,
    "@/lib/tests/constants": testConstants,
    "@/lib/tests/import-scoring": importScoring,
    "@/lib/tests/remediation": remediation,
    "server-only": {},
    zod: { z },
  },
);
const importParserV2 = load<typeof import("../lib/tests/import-parser-v2.ts")>(
  "../lib/tests/import-parser-v2.ts",
  {
    "@/lib/scoring/definition": definition,
    "@/lib/scoring/types": scoringTypes,
    "@/lib/tests/import-parser": importParser,
    "server-only": {},
    zod: { z },
  },
);
const publicationValidation = load<typeof import("../lib/tests/publication-validation.ts")>(
  "../lib/tests/publication-validation.ts",
  {
    "@/lib/answers/multiple-choice": multipleChoice,
    "@/lib/scoring/definition": definition,
    "@/lib/scoring/types": scoringTypes,
    "@/lib/structured-questions": structuredQuestions,
  },
);

const importsRoot = new URL("../artifacts/talvia-scoring-v2-imports/", import.meta.url);

function parseImport(fileName: string) {
  return importParserV2.parseTalviaTestImportV2(
    readFileSync(new URL(fileName, importsRoot), "utf8"),
  );
}

test("four generated system-test imports pass the production V2 parser", () => {
  for (const fileName of [
    "attention.json",
    "learning.json",
    "motivation.json",
    "work-behavior.json",
  ]) {
    assert.doesNotThrow(() => parseImport(fileName), fileName);
  }
});

test("four generated imports pass publication validation", () => {
  for (const fileName of [
    "attention.json",
    "learning.json",
    "motivation.json",
    "work-behavior.json",
  ]) {
    const document = parseImport(fileName);
    const definitionDocument = importParserV2.buildScoringDefinitionFromImportV2(document);
    const items = importParserV2.buildScoringItemsFromImportV2(document);
    const itemByKey = new Map(items.map((item) => [item.id, item]));
    const sections = document.test.sections.map((section) => ({
      questions: section.questions.map((question) => {
        const item = itemByKey.get(question.key);
        const options = "options" in question ? question.options : [];
        return {
          answer_options: options.map((option) => ({
            competency_effect_json: "competency_effects" in option ? option.competency_effects : {},
            id: option.key,
            is_correct:
              "is_correct" in option && typeof option.is_correct === "boolean"
                ? option.is_correct
                : null,
            match_text: null,
            points: "points" in option && typeof option.points === "number" ? option.points : 0,
            text: option.text,
          })),
          competency_key: question.competency_key,
          id: question.key,
          points: item?.scoringModel === "criterion" ? item.config.maxPoints : 0,
          question_type: question.type,
          scoring_config_json: item?.config,
          scoring_model: item?.scoringModel ?? null,
          settings_json: {
            incorrectFeedback:
              "incorrect_feedback" in question
                ? question.incorrect_feedback ?? undefined
                : undefined,
            remediationQuestionId:
              "remediation_question_key" in question
                ? question.remediation_question_key ?? undefined
                : undefined,
            required: question.required,
          },
        };
      }),
    }));
    assert.equal(
      publicationValidation.validateQuestionsForPublication(sections, {
        assessment_domain: definitionDocument.assessmentDomain,
        result_shape: definitionDocument.resultShape,
        scoring_config_json: definitionDocument,
        scoring_schema_version: "2.0",
      }),
      null,
      fileName,
    );
  }
});

test("learning and attention imports implement their dedicated score contracts", () => {
  const learning = parseImport("learning.json");
  assert.equal(learning.scoring.assessment_domain, "learning");
  assert.deepEqual(learning.scoring.learning_scoring, {
    initial_weight: 0.8,
    recovery_weight: 0.2,
  });
  assert.deepEqual(learning.scoring.overall_score, {
    source_key: "learning_final",
    source_type: "criterion",
  });
  assert.equal(
    learning.test.sections.reduce((count, section) => count + section.content_blocks.length, 0),
    2,
  );
  assert.equal(
    learning.test.sections.flatMap((section) => section.questions)
      .filter((question) => question.type === "single_choice" && question.remediation_question_key)
      .length,
    6,
  );

  const attention = parseImport("attention.json");
  assert.equal(attention.test.sections.length, 4);
  assert.deepEqual(attention.scoring.overall_score, {
    source_key: "attention_accuracy",
    source_type: "criterion",
  });
  assert.ok(
    attention.test.sections.flatMap((section) => section.questions)
      .every((question) => question.type === "single_choice" && question.shuffle_options),
  );
});

test("profile and hybrid imports keep ipsative profiles separate from performance", () => {
  const motivation = parseImport("motivation.json");
  assert.equal(motivation.scoring.overall_score, null);
  assert.equal(motivation.scoring.dimensions.length, 9);
  assert.equal(motivation.scoring.items.length, 27);
  assert.ok(motivation.scoring.items.every((item) => item.scoring_model === "forced_choice"));

  const behavior = parseImport("work-behavior.json");
  assert.equal(behavior.scoring.result_shape, "hybrid");
  assert.deepEqual(behavior.scoring.overall_score, {
    source_key: "sjt_total",
    source_type: "criterion",
  });
  assert.equal(
    behavior.scoring.items.filter((item) => item.scoring_model === "forced_choice").length,
    18,
  );
  assert.equal(behavior.scoring.items.filter((item) => item.scoring_model === "sjt").length, 6);
});

test("V2 import migration persists content blocks after the atomic content import", () => {
  const contentMigration = read(
    "../supabase/migrations/20260927100000_test_import_content_blocks.sql",
  );
  const remediationMigration = read(
    "../supabase/migrations/20260927110000_scoring_v2_import_remediation.sql",
  );
  assert.match(contentMigration, /apply_talvia_import_content_blocks_v2/);
  assert.match(contentMigration, /'contentBlocks'/);
  assert.match(contentMigration, /perform public\.apply_talvia_scoring_v2/);
  assert.match(contentMigration, /perform public\.apply_talvia_import_content_blocks_v2/);
  assert.match(remediationMigration, /apply_talvia_import_remediation_v2/);
  assert.match(remediationMigration, /'incorrectFeedback'/);
  assert.match(remediationMigration, /'remediationQuestionId'/);
  assert.match(
    remediationMigration,
    /perform public\.apply_talvia_import_remediation_v2/,
  );
});

test("V2 post-import migrations store content blocks and remediation UUIDs", async () => {
  const db = new PGlite();
  const versionId = "10000000-0000-4000-8000-000000000001";
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.test_sections (
      id uuid primary key default gen_random_uuid(),
      test_version_id uuid not null,
      order_index integer not null,
      settings_json jsonb not null default '{}'::jsonb
    );
    create table public.questions (
      id uuid primary key default gen_random_uuid(),
      section_id uuid not null references public.test_sections(id),
      order_index integer not null,
      text text not null,
      settings_json jsonb not null default '{}'::jsonb
    );
    create table public.platform_audit_logs (
      target_id uuid,
      action text,
      metadata_json jsonb not null default '{}'::jsonb
    );
    create function public.apply_talvia_scoring_v2(uuid, jsonb) returns void
      language sql as 'select null::void';
    create function public.import_company_test_v1(uuid, uuid, jsonb)
      returns table (created_template_id uuid, created_version_id uuid)
      language sql as 'select $1, $2';
    create function public.import_system_test_v1(uuid, uuid, jsonb)
      returns table (created_template_id uuid, created_version_id uuid)
      language sql as 'select $1, $2';
  `);
  await db.exec(read("../supabase/migrations/20260927100000_test_import_content_blocks.sql"));
  await db.exec(read("../supabase/migrations/20260927110000_scoring_v2_import_remediation.sql"));
  const sectionResult = await db.query<{ id: string }>(
    "insert into public.test_sections(test_version_id, order_index) values ($1, 1) returning id",
    [versionId],
  );
  const sectionId = sectionResult.rows[0]?.id;
  assert.ok(sectionId);
  await db.query(
    `insert into public.questions(section_id, order_index, text)
     values ($1, 1, 'Initial item'), ($1, 2, 'Recovery item')`,
    [sectionId],
  );
  await db.query(
    "select public.apply_talvia_import_content_blocks_v2($1, $2::jsonb)",
    [
      versionId,
      JSON.stringify({
        test: {
          sections: [{
            content_blocks: [{
              description: "Правило",
              key: "block_01",
              position_index: 2,
              title: "Изменение системы",
            }],
            questions: [
              {
                incorrect_feedback: "Повторите изменённое правило",
                key: "initial_01",
                remediation_question_key: "recovery_01",
                type: "single_choice",
              },
              {
                key: "recovery_01",
                type: "single_choice",
              },
            ],
          }],
        },
      }),
    ],
  );
  const result = await db.query<{ settings_json: { contentBlocks: Array<Record<string, unknown>> } }>(
    "select settings_json from public.test_sections where test_version_id = $1",
    [versionId],
  );
  const block = result.rows[0]?.settings_json.contentBlocks[0];
  assert.equal(block?.title, "Изменение системы");
  assert.equal(block?.description, "Правило");
  assert.equal(block?.positionIndex, 2);
  assert.equal(block?.orderIndex, 0);
  assert.match(String(block?.id), /^[0-9a-f-]{36}$/);

  const questions = await db.query<{
    id: string;
    order_index: number;
    settings_json: Record<string, unknown>;
  }>(
    `select id, order_index, settings_json
     from public.questions
     where section_id = $1
     order by order_index`,
    [sectionId],
  );
  assert.equal(
    questions.rows[0]?.settings_json.incorrectFeedback,
    "Повторите изменённое правило",
  );
  assert.equal(
    questions.rows[0]?.settings_json.remediationQuestionId,
    questions.rows[1]?.id,
  );
  assert.deepEqual(questions.rows[1]?.settings_json, {});
  await db.close();
});
