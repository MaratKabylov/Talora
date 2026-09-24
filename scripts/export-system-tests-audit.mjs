import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const PAGE_SIZE = 500;
const IN_CHUNK_SIZE = 50;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_ROOT = resolve(ROOT, "artifacts", "talvia-tests-audit");
const ZIP_PATH = resolve(ROOT, "artifacts", "talvia-tests-audit.zip");

function readOnlyFetch(input, init = {}) {
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    throw new Error(`Refusing non-read Supabase request method: ${method}`);
  }
  return fetch(input, { ...init, signal: AbortSignal.timeout(60000) });
}

async function loadEnv() {
  const env = {};
  for (const name of [".env", ".env.local"]) {
    try {
      Object.assign(env, parseEnv(await readFile(resolve(ROOT, name), "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  Object.assign(env, process.env);
  return env;
}

function createReadOnlySupabase(env) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serverKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serverKey) {
    throw new Error(
      "Supabase server credentials are missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return {
    client: createClient(supabaseUrl, serverKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: { fetch: readOnlyFetch },
    }),
    projectFingerprint: createHash("sha256").update(new URL(supabaseUrl).origin).digest("hex"),
  };
}

async function fetchAll(client, table, select, configure = (query) => query) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const query = configure(client.from(table).select(select).range(from, to));
    const { data, error } = await query;
    if (error) throw new Error(`Unable to read ${table}: ${error.code ?? "unknown"}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function fetchByIn(client, table, select, column, values, configure = (query) => query) {
  const uniqueValues = [...new Set(values)].filter(Boolean);
  const rows = [];
  for (let index = 0; index < uniqueValues.length; index += IN_CHUNK_SIZE) {
    const chunk = uniqueValues.slice(index, index + IN_CHUNK_SIZE);
    rows.push(
      ...(await fetchAll(client, table, select, (query) => configure(query.in(column, chunk)))),
    );
  }
  return rows;
}

async function countRows(client, table, configure = (query) => query) {
  const { count, error } = await configure(
    client.from(table).select("id", { count: "exact", head: true }),
  );
  if (error) throw new Error(`Unable to count ${table}: ${error.code ?? "unknown"}`);
  return count ?? 0;
}

async function countByIn(client, table, column, values, configure = (query) => query) {
  const uniqueValues = [...new Set(values)].filter(Boolean);
  let total = 0;
  for (let index = 0; index < uniqueValues.length; index += IN_CHUNK_SIZE) {
    const chunk = uniqueValues.slice(index, index + IN_CHUNK_SIZE);
    total += await countRows(client, table, (query) => configure(query.in(column, chunk)));
  }
  return total;
}

function sortByOrderThenId(left, right) {
  return (left.order_index ?? 0) - (right.order_index ?? 0) || String(left.id).localeCompare(String(right.id));
}

function sortVersionsDesc(left, right) {
  return (
    (right.version_number ?? 0) - (left.version_number ?? 0) ||
    String(right.published_at ?? "").localeCompare(String(left.published_at ?? "")) ||
    String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")) ||
    String(right.id).localeCompare(String(left.id))
  );
}

function slugify(value) {
  const slug = String(value ?? "system-test")
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || "system-test";
}

function collectMatchingJson(root, matcher, path = "$", output = []) {
  if (!root || typeof root !== "object") return output;
  if (Array.isArray(root)) {
    root.forEach((value, index) => collectMatchingJson(value, matcher, `${path}[${index}]`, output));
    return output;
  }
  for (const [key, value] of Object.entries(root)) {
    const childPath = `${path}.${key}`;
    if (matcher(key, value)) output.push({ path: childPath, value });
    collectMatchingJson(value, matcher, childPath, output);
  }
  return output;
}

function extractScoringAuditIndex(config, settings) {
  const root = { scoring_config_json: config ?? null, settings_json: settings ?? null };
  const keyIncludes = (...needles) => (key) => needles.some((needle) => key.toLowerCase().includes(needle));
  return {
    scales: collectMatchingJson(root, keyIncludes("scale")),
    reverseScoring: collectMatchingJson(root, keyIncludes("reverse", "invert")),
    dimensionEffects: collectMatchingJson(root, keyIncludes("dimension", "effect")),
    weights: collectMatchingJson(root, keyIncludes("weight")),
    norms: collectMatchingJson(root, keyIncludes("norm")),
    thresholds: collectMatchingJson(root, keyIncludes("threshold", "cutoff", "band")),
    composites: collectMatchingJson(root, keyIncludes("composite")),
  };
}

function buildQuestionAudit(question, options) {
  const settings = question.settings_json ?? {};
  return {
    type: question.question_type,
    text: question.text,
    description: question.description,
    difficulty: question.difficulty,
    required: typeof settings.required === "boolean" ? settings.required : true,
    correctOptionIds: options.filter((option) => option.is_correct === true).map((option) => option.id),
    correctOptions: options
      .filter((option) => option.is_correct === true)
      .map((option) => ({ id: option.id, text: option.text, points: option.points })),
    points: question.points,
    explanations: options
      .filter((option) => option.explanation)
      .map((option) => ({ optionId: option.id, explanation: option.explanation })),
    remediationQuestionId:
      typeof settings.remediationQuestionId === "string" ? settings.remediationQuestionId : null,
    scoringModel: question.scoring_model ?? null,
    scoringConfigJson: question.scoring_config_json ?? null,
    scoringAuditIndex: extractScoringAuditIndex(question.scoring_config_json, settings),
  };
}

async function exportVersion(client, version) {
  const sections = await fetchAll(client, "test_sections", "*", (query) =>
    query.eq("test_version_id", version.id).order("order_index").order("id"),
  );
  const questions = await fetchByIn(
    client,
    "questions",
    "*",
    "section_id",
    sections.map((section) => section.id),
    (query) => query.order("order_index").order("id"),
  );
  const options = await fetchByIn(
    client,
    "answer_options",
    "*",
    "question_id",
    questions.map((question) => question.id),
    (query) => query.order("order_index").order("id"),
  );

  const questionsBySection = Map.groupBy(questions.sort(sortByOrderThenId), (question) => question.section_id);
  const optionsByQuestion = Map.groupBy(options.sort(sortByOrderThenId), (option) => option.question_id);
  const exportedSections = sections.sort(sortByOrderThenId).map((section) => ({
    section,
    questions: (questionsBySection.get(section.id) ?? []).map((question) => {
      const questionOptions = optionsByQuestion.get(question.id) ?? [];
      return {
        question,
        audit: buildQuestionAudit(question, questionOptions),
        answerOptions: questionOptions.map((option) => ({
          option,
          audit: {
            id: option.id,
            matchTargetId: option.match_target_id ?? null,
            text: option.text,
            matchText: option.match_text ?? null,
            isCorrect: option.is_correct,
            points: option.points,
            explanation: option.explanation,
            competencyEffectJson: option.competency_effect_json ?? null,
          },
        })),
      };
    }),
  }));

  const exportedCounts = {
    sections: sections.length,
    questions: questions.length,
    answerOptions: options.length,
  };
  const databaseCounts = {
    sections: await countRows(client, "test_sections", (query) => query.eq("test_version_id", version.id)),
    questions: await countByIn(
      client,
      "questions",
      "section_id",
      sections.map((section) => section.id),
    ),
    answerOptions: await countByIn(
      client,
      "answer_options",
      "question_id",
      questions.map((question) => question.id),
    ),
  };
  const countMatches =
    exportedCounts.sections === databaseCounts.sections &&
    exportedCounts.questions === databaseCounts.questions &&
    exportedCounts.answerOptions === databaseCounts.answerOptions;

  return {
    version,
    scoringAuditIndex: {
      scoringSchemaVersion: version.scoring_schema_version ?? null,
      assessmentDomain: version.assessment_domain ?? null,
      resultShape: version.result_shape ?? null,
      scoringType: version.scoring_type ?? null,
      scoringConfigJson: version.scoring_config_json ?? null,
      settingsJson: version.settings_json ?? null,
      ...extractScoringAuditIndex(version.scoring_config_json, version.settings_json),
    },
    sections: exportedSections,
    counts: { exported: exportedCounts, database: databaseCounts, match: countMatches },
  };
}

function buildManifestEntry(template, fileName, latestPublishedVersion, draftVersions, omittedVersions) {
  const allVersions = [latestPublishedVersion, ...draftVersions].filter(Boolean);
  const sum = (field) =>
    allVersions.reduce((total, version) => total + version.counts.exported[field], 0);
  return {
    file: fileName,
    templateId: template.id,
    title: template.title,
    category: template.category,
    templateStatus: template.status,
    latestPublishedVersion: latestPublishedVersion
      ? {
          id: latestPublishedVersion.version.id,
          versionNumber: latestPublishedVersion.version.version_number,
          status: latestPublishedVersion.version.status,
          publishedAt: latestPublishedVersion.version.published_at ?? null,
          counts: latestPublishedVersion.counts.exported,
        }
      : null,
    draftVersions: draftVersions.map((version) => ({
      id: version.version.id,
      versionNumber: version.version.version_number,
      status: version.version.status,
      counts: version.counts.exported,
    })),
    omittedVersions,
    counts: {
      exportedVersions: allVersions.length,
      sections: sum("sections"),
      questions: sum("questions"),
      answerOptions: sum("answerOptions"),
    },
    verification: {
      countMatchesDatabase: allVersions.every((version) => version.counts.match),
      versions: Object.fromEntries(allVersions.map((version) => [version.version.id, version.counts])),
    },
  };
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}

async function writeZipArchive(destination, files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name.replaceAll("\\", "/"), "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    chunks.push(local, data);
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name,
      ]),
    );
    offset += local.length + data.length;
  }
  const centralOffset = offset;
  const centralDirectory = Buffer.concat(central);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDirectory.length),
    u32(centralOffset),
    u16(0),
  ]);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.concat([...chunks, centralDirectory, end]));
}

async function run() {
  const env = await loadEnv();
  const { client, projectFingerprint } = createReadOnlySupabase(env);
  const exportedAt = new Date().toISOString();
  const runDir = resolve(OUTPUT_ROOT, exportedAt.replace(/[:.]/g, "-"));

  await rm(runDir, { recursive: true, force: true });
  await mkdir(runDir, { recursive: true });

  const templates = await fetchAll(client, "test_templates", "*", (query) =>
    query.eq("is_system", true).is("company_id", null).order("title").order("id"),
  );
  const allVersions = await fetchByIn(
    client,
    "test_versions",
    "*",
    "test_template_id",
    templates.map((template) => template.id),
    (query) => query.order("version_number", { ascending: false }).order("id"),
  );
  const versionsByTemplate = Map.groupBy(allVersions, (version) => version.test_template_id);
  const files = [];
  const manifestEntries = [];

  for (const [templateIndex, template] of templates.entries()) {
    const versions = versionsByTemplate.get(template.id) ?? [];
    const published = versions.filter((version) => version.status === "published").sort(sortVersionsDesc);
    const drafts = versions.filter((version) => version.status === "draft").sort(sortVersionsDesc);
    const latestPublished = published[0] ? await exportVersion(client, published[0]) : null;
    const draftVersions = [];
    for (const draft of drafts) draftVersions.push(await exportVersion(client, draft));

    const fileName = `${String(templateIndex + 1).padStart(3, "0")}-${slugify(template.title)}-${template.id}.json`;
    const omittedVersions = versions
      .filter((version) => version.id !== latestPublished?.version.id && !drafts.some((draft) => draft.id === version.id))
      .map((version) => ({
        id: version.id,
        versionNumber: version.version_number,
        status: version.status,
        publishedAt: version.published_at ?? null,
      }));
    const document = {
      exportMetadata: {
        exportedAt,
        projectFingerprint,
        scope:
          "All system test templates (is_system=true, company_id is null); latest published version plus all draft versions.",
        readOnlyGuarantee: "Supabase requests are limited by this script to GET and HEAD only.",
        excludedData:
          "No participant personal data, assessment sessions, results, invitation tokens, passwords, or environment variables are exported.",
      },
      template,
      latestPublishedVersion: latestPublished,
      draftVersions,
      omittedVersions,
    };
    const json = `${JSON.stringify(document, null, 2)}\n`;
    await writeFile(resolve(runDir, fileName), json);
    files.push({ name: fileName, data: Buffer.from(json, "utf8") });
    manifestEntries.push(
      buildManifestEntry(template, fileName, latestPublished, draftVersions, omittedVersions),
    );
  }

  const totals = manifestEntries.reduce(
    (accumulator, entry) => {
      accumulator.exportedVersions += entry.counts.exportedVersions;
      accumulator.sections += entry.counts.sections;
      accumulator.questions += entry.counts.questions;
      accumulator.answerOptions += entry.counts.answerOptions;
      return accumulator;
    },
    { exportedVersions: 0, sections: 0, questions: 0, answerOptions: 0 },
  );
  const databaseTotals = {
    templates: await countRows(client, "test_templates", (query) =>
      query.eq("is_system", true).is("company_id", null),
    ),
    selectedVersions: totals.exportedVersions,
    sections: totals.sections,
    questions: totals.questions,
    answerOptions: totals.answerOptions,
  };
  const manifest = {
    exportedAt,
    projectFingerprint,
    archiveName: "talvia-tests-audit.zip",
    outputDirectory: runDir,
    scope:
      "System tests only. One JSON file per system test template. Each file contains the latest published version and draft versions, when present.",
    excludedData:
      "Participant personal data, assessment sessions, test results, invitation tokens, passwords, and environment variables are not queried or serialized.",
    totals: {
      templates: templates.length,
      ...totals,
    },
    databaseCounts: databaseTotals,
    verification: {
      templateCountMatchesDatabase: templates.length === databaseTotals.templates,
      contentCountsMatchDatabase: manifestEntries.every((entry) => entry.verification.countMatchesDatabase),
    },
    tests: manifestEntries,
  };
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(resolve(runDir, "manifest.json"), manifestJson);
  files.push({ name: "manifest.json", data: Buffer.from(manifestJson, "utf8") });
  await writeZipArchive(ZIP_PATH, files);

  if (!manifest.verification.templateCountMatchesDatabase || !manifest.verification.contentCountsMatchDatabase) {
    throw new Error("Export count verification failed. See manifest.json for details.");
  }

  return {
    archive: ZIP_PATH,
    outputDirectory: runDir,
    templates: manifest.totals.templates,
    exportedVersions: manifest.totals.exportedVersions,
    sections: manifest.totals.sections,
    questions: manifest.totals.questions,
    answerOptions: manifest.totals.answerOptions,
    verification: manifest.verification,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const summary = await run();
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "System test audit export failed.");
    process.exitCode = 1;
  }
}
