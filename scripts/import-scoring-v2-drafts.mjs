import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IMPORT_ROOT = resolve(ROOT, "artifacts", "talvia-scoring-v2-imports");
const LEGACY_LEARNING_DRAFT_ID = "af1b72f9-e7c3-4fdc-b00f-c52254d655d0";

const TARGETS = [
  {
    domain: "attention",
    fileName: "attention.json",
    models: { criterion: 32 },
    publishedVersionId: "c8be3ee4-0f3d-408a-8949-9e7bb6d4ad6c",
    resultShape: "score",
    templateId: "00000000-0000-4000-8000-000000000103",
  },
  {
    domain: "motivation",
    fileName: "motivation.json",
    models: { forced_choice: 27 },
    publishedVersionId: "4e6d36ed-67dd-4f65-9f0e-a477424dd0a3",
    resultShape: "profile",
    templateId: "00000000-0000-4000-8000-000000000105",
  },
  {
    domain: "learning",
    fileName: "learning.json",
    models: { criterion: 28 },
    publishedVersionId: "03692dc1-a443-4777-8a44-6bfa0ed2c235",
    resultShape: "score",
    templateId: "00000000-0000-4000-8000-000000000102",
  },
  {
    domain: "behavior",
    fileName: "work-behavior.json",
    models: { forced_choice: 18, sjt: 6 },
    publishedVersionId: "4ea6b597-ca14-4ee2-840a-028378e01ea0",
    resultShape: "hybrid",
    templateId: "00000000-0000-4000-8000-000000000104",
  },
];

async function loadEnv() {
  const env = {};
  for (const name of [".env", ".env.local"]) {
    try {
      Object.assign(env, parseEnv(await readFile(resolve(ROOT, name), "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return { ...env, ...process.env };
}

function createAdmin(env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase server credentials.");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
}

function fail(label, error) {
  throw new Error(`${label}: ${error?.code ?? error?.message ?? "unknown"}`);
}

async function findActor(admin) {
  for (const role of ["platform_owner", "platform_admin"]) {
    const { data, error } = await admin
      .from("platform_users")
      .select("user_id, role")
      .eq("status", "active")
      .eq("role", role)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) fail("Unable to resolve platform actor", error);
    if (data) return data;
  }
  throw new Error("No active platform owner/admin is available for the audited import.");
}

async function verifyMigration(admin) {
  const { error } = await admin.rpc("apply_talvia_import_content_blocks_v2", {
    import_document: { test: { sections: [] } },
    target_version_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  });
  if (error) fail("Content-block migration is unavailable", error);
}

async function readVersions(admin, templateId) {
  const { data, error } = await admin
    .from("test_versions")
    .select(
      "id, test_template_id, version_number, status, scoring_schema_version, assessment_domain, result_shape, scoring_config_json",
    )
    .eq("test_template_id", templateId)
    .order("version_number", { ascending: false });
  if (error) fail("Unable to read system-test versions", error);
  return data ?? [];
}

async function ensureArchiveAudit(admin, actor, templateId) {
  const { data, error } = await admin
    .from("platform_audit_logs")
    .select("id")
    .eq("action", "archive_system_test_version")
    .eq("target_id", LEGACY_LEARNING_DRAFT_ID)
    .limit(1);
  if (error) fail("Unable to verify legacy-draft audit", error);
  if ((data ?? []).length > 0) return;

  const { error: insertError } = await admin.from("platform_audit_logs").insert({
    action: "archive_system_test_version",
    actor_role: actor.role,
    actor_user_id: actor.user_id,
    company_id: null,
    metadata_json: { reason: "scoring_v2_migration", testTemplateId: templateId },
    reason: null,
    target_id: LEGACY_LEARNING_DRAFT_ID,
    target_type: "test_version",
  });
  if (insertError) fail("Unable to audit legacy-draft archive", insertError);
}

async function archiveLegacyLearningDraft(admin, actor, target) {
  const versions = await readVersions(admin, target.templateId);
  const legacy = versions.find((version) => version.id === LEGACY_LEARNING_DRAFT_ID);
  if (!legacy) throw new Error("Expected Learning legacy draft v7 was not found.");
  if (legacy.version_number !== 7 || legacy.scoring_schema_version !== null) {
    throw new Error("Learning legacy draft identity no longer matches the audited source.");
  }
  if (legacy.status === "draft") {
    const otherDrafts = versions.filter(
      (version) => version.status === "draft" && version.id !== LEGACY_LEARNING_DRAFT_ID,
    );
    if (otherDrafts.length > 0) throw new Error("Learning has an unexpected additional draft.");
    const { data, error } = await admin
      .from("test_versions")
      .update({ status: "archived" })
      .eq("id", LEGACY_LEARNING_DRAFT_ID)
      .eq("test_template_id", target.templateId)
      .eq("status", "draft")
      .select("id")
      .maybeSingle();
    if (error || !data) fail("Unable to archive Learning legacy draft", error);
  } else if (legacy.status !== "archived") {
    throw new Error(`Learning legacy draft has unexpected status '${legacy.status}'.`);
  }
  await ensureArchiveAudit(admin, actor, target.templateId);
}

async function importOrReuseDraft(admin, actor, target, document) {
  const versions = await readVersions(admin, target.templateId);
  const drafts = versions.filter((version) => version.status === "draft");
  if (drafts.length > 1) throw new Error(`${document.test.title} has more than one draft.`);
  if (drafts.length === 1) {
    const draft = drafts[0];
    if (
      draft.scoring_schema_version !== "2.0" ||
      draft.assessment_domain !== target.domain ||
      draft.result_shape !== target.resultShape
    ) {
      throw new Error(`${document.test.title} has an unexpected existing draft.`);
    }
    return { reused: true, versionId: draft.id, versionNumber: draft.version_number };
  }

  const { data, error } = await admin.rpc("import_system_test_v2", {
    import_document: document,
    target_created_by: actor.user_id,
    target_template_id: target.templateId,
  });
  if (error) fail(`Unable to import ${document.test.title}`, error);
  const record = (data ?? [])[0];
  if (!record?.created_version_id || record.created_template_id !== target.templateId) {
    throw new Error(`${document.test.title}: import RPC returned an invalid receipt.`);
  }
  const created = (await readVersions(admin, target.templateId)).find(
    (version) => version.id === record.created_version_id,
  );
  if (!created) throw new Error(`${document.test.title}: created draft cannot be read back.`);
  return { reused: false, versionId: created.id, versionNumber: created.version_number };
}

async function fetchRowsByIn(admin, table, select, column, values) {
  if (values.length === 0) return [];
  const { data, error } = await admin.from(table).select(select).in(column, values);
  if (error) fail(`Unable to verify ${table}`, error);
  return data ?? [];
}

async function repairLearningRemediation(admin, actor, target, document, receipt) {
  if (target.domain !== "learning") return false;
  const { data: sections, error: sectionError } = await admin
    .from("test_sections")
    .select("id, order_index")
    .eq("test_version_id", receipt.versionId);
  if (sectionError) fail("Unable to inspect Learning remediation sections", sectionError);
  const questions = await fetchRowsByIn(
    admin,
    "questions",
    "id, section_id, order_index, text, settings_json",
    "section_id",
    (sections ?? []).map((section) => section.id),
  );
  const linked = questions.filter(
    (question) => typeof question.settings_json?.remediationQuestionId === "string",
  );
  if (linked.length === 6) return false;
  if (linked.length !== 0) {
    throw new Error(`Обучаемость: refusing to repair a partial remediation state (${linked.length}/6).`);
  }

  const sectionIdByOrder = new Map(
    (sections ?? []).map((section) => [section.order_index, section.id]),
  );
  const remoteByPosition = new Map(
    questions.map((question) => [`${question.section_id}:${question.order_index}`, question]),
  );
  const localByKey = new Map();
  document.test.sections.forEach((section, sectionIndex) => {
    section.questions.forEach((question, questionIndex) => {
      localByKey.set(question.key, { question, questionIndex, sectionIndex });
    });
  });
  const updates = [];
  for (const entry of localByKey.values()) {
    const question = entry.question;
    if (!question.remediation_question_key) continue;
    const targetEntry = localByKey.get(question.remediation_question_key);
    if (!targetEntry || targetEntry.sectionIndex !== entry.sectionIndex) {
      throw new Error("Обучаемость: local remediation target is invalid.");
    }
    const sectionId = sectionIdByOrder.get(entry.sectionIndex + 1);
    const source = remoteByPosition.get(`${sectionId}:${entry.questionIndex + 1}`);
    const remediation = remoteByPosition.get(`${sectionId}:${targetEntry.questionIndex + 1}`);
    if (!source || !remediation || source.text !== question.text || remediation.text !== targetEntry.question.text) {
      throw new Error("Обучаемость: remote content does not match the audited remediation positions.");
    }
    updates.push({
      id: source.id,
      settings: {
        ...(source.settings_json ?? {}),
        incorrectFeedback: question.incorrect_feedback,
        remediationQuestionId: remediation.id,
      },
    });
  }
  if (updates.length !== 6) throw new Error("Обучаемость: expected six remediation repairs.");
  for (const update of updates) {
    const { data, error } = await admin
      .from("questions")
      .update({ settings_json: update.settings })
      .eq("id", update.id)
      .select("id")
      .maybeSingle();
    if (error || !data) fail("Unable to repair Learning remediation link", error);
  }
  const { error: auditError } = await admin.from("platform_audit_logs").insert({
    action: "repair_system_test_v2_remediation",
    actor_role: actor.role,
    actor_user_id: actor.user_id,
    company_id: null,
    metadata_json: { repairedLinks: updates.length, testTemplateId: target.templateId },
    reason: "remote_importer_missing_remediation_poststep",
    target_id: receipt.versionId,
    target_type: "test_version",
  });
  if (auditError) fail("Unable to audit Learning remediation repair", auditError);
  return true;
}

async function verifyDraft(admin, target, document, receipt) {
  const versions = await readVersions(admin, target.templateId);
  const published = versions.find((version) => version.id === target.publishedVersionId);
  if (!published || published.status !== "published") {
    throw new Error(`${document.test.title}: audited published source was modified.`);
  }
  const draft = versions.find((version) => version.id === receipt.versionId);
  if (
    !draft ||
    draft.status !== "draft" ||
    draft.scoring_schema_version !== "2.0" ||
    draft.assessment_domain !== target.domain ||
    draft.result_shape !== target.resultShape
  ) {
    throw new Error(`${document.test.title}: V2 draft metadata verification failed.`);
  }
  if (versions.filter((version) => version.status === "draft").length !== 1) {
    throw new Error(`${document.test.title}: expected exactly one draft.`);
  }

  const { data: sections, error: sectionError } = await admin
    .from("test_sections")
    .select("id, settings_json")
    .eq("test_version_id", receipt.versionId);
  if (sectionError) fail(`Unable to verify ${document.test.title} sections`, sectionError);
  const questions = await fetchRowsByIn(
    admin,
    "questions",
    "id, scoring_model, scoring_config_json, settings_json",
    "section_id",
    (sections ?? []).map((section) => section.id),
  );
  const options = await fetchRowsByIn(
    admin,
    "answer_options",
    "id, question_id",
    "question_id",
    questions.map((question) => question.id),
  );
  const expectedQuestions = document.test.sections.flatMap((section) => section.questions);
  const expectedOptions = expectedQuestions.reduce(
    (count, question) => count + (question.options?.length ?? 0),
    0,
  );
  if (
    (sections ?? []).length !== document.test.sections.length ||
    questions.length !== expectedQuestions.length ||
    options.length !== expectedOptions
  ) {
    throw new Error(`${document.test.title}: imported content counts do not match the source.`);
  }
  for (const [model, expected] of Object.entries(target.models)) {
    if (questions.filter((question) => question.scoring_model === model).length !== expected) {
      throw new Error(`${document.test.title}: scoring model '${model}' count mismatch.`);
    }
  }
  const definition = draft.scoring_config_json;
  const expectedOverall = {
    attention: "attention_accuracy",
    behavior: "sjt_total",
    learning: "learning_final",
    motivation: null,
  }[target.domain];
  if ((definition?.overallScore?.sourceId ?? null) !== expectedOverall) {
    throw new Error(`${document.test.title}: overall score source mismatch.`);
  }
  const expectedScaleCount = target.domain === "motivation" ? 9 : target.domain === "behavior" ? 6 : 0;
  if (!Array.isArray(definition?.scales) || definition.scales.length !== expectedScaleCount) {
    throw new Error(`${document.test.title}: dimension count mismatch.`);
  }
  if (
    target.domain === "learning" &&
    (definition?.learningScoring?.initialWeight !== 0.8 ||
      definition?.learningScoring?.recoveryWeight !== 0.2)
  ) {
    throw new Error("Обучаемость: learning weights mismatch.");
  }
  if (target.domain === "learning") {
    const parents = questions.filter(
      (question) => typeof question.settings_json?.remediationQuestionId === "string",
    );
    if (
      parents.length !== 6 ||
      parents.some((question) => !question.settings_json?.incorrectFeedback)
    ) {
      const feedbackCount = parents.filter(
        (question) => Boolean(question.settings_json?.incorrectFeedback),
      ).length;
      throw new Error(
        `Обучаемость: remediation links mismatch (${parents.length} links, ${feedbackCount} feedback entries).`,
      );
    }
  }
  if (
    target.domain === "attention" &&
    questions.some((question) => question.settings_json?.shuffleOptions !== true)
  ) {
    throw new Error("Внимательность: shuffleOptions is not enabled for every question.");
  }
  if (
    ["attention", "learning"].includes(target.domain) &&
    questions.some(
      (question) =>
        question.scoring_config_json?.minPoints !== 0 ||
        !(question.scoring_config_json?.maxPoints > 0),
    )
  ) {
    throw new Error(`${document.test.title}: criterion point bounds mismatch.`);
  }
  const optionIdsByQuestion = new Map();
  for (const option of options) {
    const ids = optionIdsByQuestion.get(option.question_id) ?? [];
    ids.push(option.id);
    optionIdsByQuestion.set(option.question_id, ids);
  }
  for (const question of questions) {
    if (question.scoring_model === "sjt") {
      const configured = question.scoring_config_json?.options?.map((option) => option.optionId) ?? [];
      const stored = optionIdsByQuestion.get(question.id) ?? [];
      if (configured.length !== stored.length || configured.some((id) => !stored.includes(id))) {
        throw new Error("Рабочее поведение: SJT option UUID mapping mismatch.");
      }
    }
    if (question.scoring_model === "forced_choice") {
      const configured =
        question.scoring_config_json?.statements?.map((statement) => statement.statementId) ?? [];
      const stored = optionIdsByQuestion.get(question.id) ?? [];
      if (configured.length !== stored.length || configured.some((id) => !stored.includes(id))) {
        throw new Error(`${document.test.title}: Forced Choice statement UUID mapping mismatch.`);
      }
    }
  }
  const expectedBlocks = document.test.sections.reduce(
    (count, section) => count + section.content_blocks.length,
    0,
  );
  const storedBlocks = (sections ?? []).reduce(
    (count, section) =>
      count + (Array.isArray(section.settings_json?.contentBlocks)
        ? section.settings_json.contentBlocks.length
        : 0),
    0,
  );
  if (storedBlocks !== expectedBlocks) {
    throw new Error(`${document.test.title}: content-block count mismatch.`);
  }
  const { data: auditRows, error: auditError } = await admin
    .from("platform_audit_logs")
    .select("id")
    .eq("action", "import_system_test_version")
    .eq("target_id", receipt.versionId)
    .limit(1);
  if (auditError) fail(`${document.test.title}: unable to verify import audit`, auditError);
  if ((auditRows ?? []).length !== 1) {
    throw new Error(`${document.test.title}: import audit event is missing.`);
  }
  return {
    contentBlocks: storedBlocks,
    options: options.length,
    questions: questions.length,
    sections: (sections ?? []).length,
  };
}

async function main() {
  if (!process.argv.includes("--execute")) {
    throw new Error("Refusing remote writes without --execute.");
  }
  const env = await loadEnv();
  const admin = createAdmin(env);
  await verifyMigration(admin);
  const actor = await findActor(admin);
  const learningTarget = TARGETS.find((target) => target.domain === "learning");
  await archiveLegacyLearningDraft(admin, actor, learningTarget);

  const results = [];
  for (const target of TARGETS) {
    const document = JSON.parse(await readFile(resolve(IMPORT_ROOT, target.fileName), "utf8"));
    const receipt = await importOrReuseDraft(admin, actor, target, document);
    const remediationRepaired = await repairLearningRemediation(
      admin,
      actor,
      target,
      document,
      receipt,
    );
    const counts = await verifyDraft(admin, target, document, receipt);
    results.push({
      ...counts,
      reused: receipt.reused,
      remediationRepaired,
      title: document.test.title,
      versionId: receipt.versionId,
      versionNumber: receipt.versionNumber,
    });
  }
  console.log(JSON.stringify({ archivedLegacyLearningDraft: true, drafts: results }, null, 2));
}

await main();
