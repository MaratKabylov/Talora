import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = resolve(ROOT, "artifacts", "talvia-scoring-v2-imports");

const TARGETS = {
  "00000000-0000-4000-8000-000000000102": {
    fileName: "learning.json",
    kind: "learning",
  },
  "00000000-0000-4000-8000-000000000103": {
    fileName: "attention.json",
    kind: "attention",
  },
  "00000000-0000-4000-8000-000000000104": {
    fileName: "work-behavior.json",
    kind: "work_behavior",
  },
  "00000000-0000-4000-8000-000000000105": {
    fileName: "motivation.json",
    kind: "motivation",
  },
};

const DIMENSION_TITLES = {
  motivation_autonomy: "Автономия",
  motivation_growth: "Развитие",
  motivation_income: "Вознаграждение",
  motivation_influence: "Влияние",
  motivation_meaning: "Смысл",
  motivation_recognition: "Признание",
  motivation_result: "Результат",
  motivation_stability: "Стабильность",
  motivation_team: "Команда",
  responsibility: "Ответственность",
  work_adaptability: "Самоконтроль и адаптивность",
  work_collaboration: "Сотрудничество",
  work_initiative: "Инициативность",
  work_organization: "Организованность",
  work_result_orientation: "Ориентация на результат",
};

const MOTIVATION_DIMENSIONS = [
  "motivation_result",
  "motivation_growth",
  "motivation_autonomy",
  "motivation_influence",
  "motivation_team",
  "motivation_stability",
  "motivation_income",
  "motivation_recognition",
  "motivation_meaning",
];

const BEHAVIOR_DIMENSIONS = [
  "responsibility",
  "work_organization",
  "work_initiative",
  "work_result_orientation",
  "work_collaboration",
  "work_adaptability",
];

function pad(value) {
  return String(value).padStart(2, "0");
}

function ordered(values, field = "order_index") {
  const readField = (value) =>
    field.split(".").reduce((current, part) => current?.[part], value);
  return [...values].sort(
    (left, right) =>
      Number(readField(left) ?? 0) - Number(readField(right) ?? 0) ||
      String(left.id ?? "").localeCompare(String(right.id ?? "")),
  );
}

function required(settings) {
  return settings?.required !== false;
}

function collectQuestionEntries(version) {
  return ordered(version.sections, "section.order_index").flatMap((sectionEntry, sectionIndex) =>
    ordered(sectionEntry.questions, "question.order_index").map((questionEntry, questionIndex) => ({
      key: `q_${pad(sectionIndex + 1)}_${pad(questionIndex + 1)}`,
      questionEntry,
      questionIndex,
      sectionEntry,
      sectionIndex,
    })),
  );
}

function sourceOptions(entry) {
  return ordered(entry.questionEntry.answerOptions, "option.order_index");
}

function optionKey(questionKey, optionIndex) {
  return `${questionKey}_option_${pad(optionIndex + 1)}`;
}

function buildQuestion(entry, remediationKeys, forceAttentionShuffle) {
  const source = entry.questionEntry.question;
  const settings = source.settings_json ?? {};
  const common = {
    competency_key: source.competency_key,
    description: source.description,
    difficulty: source.difficulty,
    key: entry.key,
    required: required(settings),
    text: source.text,
  };
  const options = sourceOptions(entry);

  if (source.question_type === "forced_choice") {
    return {
      ...common,
      forced_choice: { mode: "most_least" },
      options: options.map((optionEntry, optionIndex) => ({
        competency_effects: optionEntry.option.competency_effect_json ?? {},
        explanation: optionEntry.option.explanation,
        key: optionKey(entry.key, optionIndex),
        text: optionEntry.option.text,
      })),
      type: "forced_choice",
    };
  }

  if (source.question_type !== "single_choice") {
    throw new Error(`Unsupported source question type '${source.question_type}' in ${entry.key}.`);
  }

  const remediationId = settings.remediationQuestionId ?? null;
  return {
    ...common,
    incorrect_feedback: settings.incorrectFeedback ?? null,
    options: options.map((optionEntry, optionIndex) => ({
      competency_effects: optionEntry.option.competency_effect_json ?? {},
      explanation: optionEntry.option.explanation,
      is_correct: optionEntry.option.is_correct === true,
      key: optionKey(entry.key, optionIndex),
      points: Number(optionEntry.option.points ?? 0),
      text: optionEntry.option.text,
    })),
    remediation_question_key: remediationId ? remediationKeys.get(remediationId) ?? null : null,
    shuffle_options: forceAttentionShuffle ? true : settings.shuffleOptions === true,
    type: "single_choice",
  };
}

function buildTest(audit, version, entries, kind) {
  const entryByQuestionId = new Map(entries.map((entry) => [entry.questionEntry.question.id, entry.key]));
  return {
    category: audit.template.category,
    description: version.version.description,
    duration_minutes: version.version.duration_minutes,
    instructions: version.version.instructions,
    presentation: {
      allow_back: version.version.settings_json?.allowBack === true,
      capture_question_time: version.version.settings_json?.captureQuestionTime === true,
      mode: version.version.settings_json?.presentationMode ?? "section",
    },
    scoring_type:
      kind === "motivation"
        ? "competency_profile"
        : kind === "work_behavior"
          ? "mixed"
          : "points",
    sections: ordered(version.sections, "section.order_index").map((sectionEntry, sectionIndex) => {
      const sectionKey = `section_${pad(sectionIndex + 1)}`;
      const sectionEntries = entries.filter((entry) => entry.sectionIndex === sectionIndex);
      const contentBlocks = ordered(
        sectionEntry.section.settings_json?.contentBlocks ?? [],
        "orderIndex",
      );
      return {
        content_blocks: contentBlocks.map((block, blockIndex) => ({
          description: block.description ?? null,
          key: `${sectionKey}_block_${pad(blockIndex + 1)}`,
          position_index: block.positionIndex,
          title: block.title,
        })),
        description: sectionEntry.section.description,
        key: sectionKey,
        questions: sectionEntries.map((entry) =>
          buildQuestion(entry, entryByQuestionId, kind === "attention"),
        ),
        title: sectionEntry.section.title,
      };
    }),
    title: audit.template.title,
  };
}

function occurrenceCounts(entries, dimensions) {
  const counts = Object.fromEntries(dimensions.map((key) => [key, 0]));
  for (const entry of entries) {
    for (const optionEntry of sourceOptions(entry)) {
      for (const key of Object.keys(optionEntry.option.competency_effect_json ?? {})) {
        if (key in counts) counts[key] += 1;
      }
    }
  }
  return counts;
}

function buildDimensions(entries, keys) {
  const counts = occurrenceCounts(entries, keys);
  return keys.map((key, index) => {
    if (!counts[key]) throw new Error(`Dimension '${key}' has no source statements.`);
    return {
      aggregation: "sum",
      description: null,
      interpretation_key: null,
      key,
      min_answered_items: null,
      min_answered_ratio: 1,
      missing_policy: "insufficient",
      order: index + 1,
      theoretical_max: counts[key],
      theoretical_min: -counts[key],
      title: DIMENSION_TITLES[key],
    };
  });
}

function buildForcedChoiceItem(entry) {
  return {
    centering: "none",
    method: "ipsative",
    question_key: entry.key,
    role_weights: { least: -1, most: 1 },
    scoring_model: "forced_choice",
    statements: sourceOptions(entry).map((optionEntry, optionIndex) => {
      const dimensions = Object.keys(optionEntry.option.competency_effect_json ?? {});
      if (dimensions.length !== 1) {
        throw new Error(`${entry.key} option ${optionIndex + 1} must map to exactly one dimension.`);
      }
      return {
        dimension_key: dimensions[0],
        keyed_direction: 1,
        option_key: optionKey(entry.key, optionIndex),
      };
    }),
  };
}

function buildCriterionItem(entry) {
  const points = sourceOptions(entry).map((optionEntry) => Number(optionEntry.option.points ?? 0));
  return {
    competency_bindings: [],
    max_points: Math.max(...points),
    min_points: 0,
    question_key: entry.key,
    scoring_model: "criterion",
    strategy: "single_choice_points",
  };
}

function buildSjtItem(entry) {
  const options = sourceOptions(entry).map((optionEntry, optionIndex) => ({
    dimension_effects: [],
    option_key: optionKey(entry.key, optionIndex),
    points: Number(optionEntry.option.points ?? 0),
  }));
  return {
    max_points: Math.max(...options.map((option) => option.points)),
    min_points: Math.min(...options.map((option) => option.points)),
    options,
    question_key: entry.key,
    scoring_model: "sjt",
  };
}

function buildScoring(entries, kind) {
  const common = {
    composites: [],
    learning_scoring: null,
    norm_assignments: [],
    scoring_version: "2.0",
    thresholds: [],
  };

  if (kind === "learning" || kind === "attention") {
    return {
      ...common,
      assessment_domain: kind,
      dimensions: [],
      items: entries.map(buildCriterionItem),
      learning_scoring:
        kind === "learning" ? { initial_weight: 0.8, recovery_weight: 0.2 } : null,
      overall_score: {
        source_key: kind === "learning" ? "learning_final" : "attention_accuracy",
        source_type: "criterion",
      },
      result_shape: "score",
    };
  }

  if (kind === "motivation") {
    return {
      ...common,
      assessment_domain: "motivation",
      dimensions: buildDimensions(entries, MOTIVATION_DIMENSIONS),
      items: entries.map(buildForcedChoiceItem),
      overall_score: null,
      result_shape: "profile",
    };
  }

  return {
    ...common,
    assessment_domain: "behavior",
    dimensions: buildDimensions(
      entries.filter((entry) => entry.questionEntry.question.question_type === "forced_choice"),
      BEHAVIOR_DIMENSIONS,
    ),
    items: entries.map((entry) =>
      entry.questionEntry.question.question_type === "forced_choice"
        ? buildForcedChoiceItem(entry)
        : buildSjtItem(entry),
    ),
    overall_score: { source_key: "sjt_total", source_type: "criterion" },
    result_shape: "hybrid",
  };
}

function validateSource(audit, target) {
  if (!audit.latestPublishedVersion) throw new Error(`${audit.template.title}: no published version.`);
  if (audit.template.id !== audit.latestPublishedVersion.version.test_template_id) {
    throw new Error(`${audit.template.title}: published version belongs to another template.`);
  }
  if (!audit.latestPublishedVersion.counts?.match) {
    throw new Error(`${audit.template.title}: exported row counts do not match Supabase.`);
  }
  const questionTypes = collectQuestionEntries(audit.latestPublishedVersion).map(
    (entry) => entry.questionEntry.question.question_type,
  );
  if (target.kind === "work_behavior") {
    if (questionTypes.filter((type) => type === "forced_choice").length !== 18) {
      throw new Error("Рабочее поведение must contain 18 forced-choice blocks.");
    }
    if (questionTypes.filter((type) => type === "single_choice").length !== 6) {
      throw new Error("Рабочее поведение must contain 6 SJT questions.");
    }
  }
  if (target.kind === "motivation" && questionTypes.length !== 27) {
    throw new Error("Мотивационный профиль must contain 27 forced-choice blocks.");
  }
}

export function buildImportDocument(audit, target) {
  validateSource(audit, target);
  const version = audit.latestPublishedVersion;
  const entries = collectQuestionEntries(version);
  return {
    schema_version: "talvia.test.v2",
    scoring: buildScoring(entries, target.kind),
    test: buildTest(audit, version, entries, target.kind),
  };
}

export async function buildImports(inputDirectory, outputDirectory = DEFAULT_OUTPUT) {
  const files = (await readdir(inputDirectory)).filter((name) => name.endsWith(".json"));
  const audits = [];
  for (const fileName of files) {
    const audit = JSON.parse(await readFile(resolve(inputDirectory, fileName), "utf8"));
    if (audit?.template?.id in TARGETS) audits.push(audit);
  }
  if (audits.length !== Object.keys(TARGETS).length) {
    throw new Error(`Expected four target system tests, found ${audits.length}.`);
  }

  await mkdir(outputDirectory, { recursive: true });
  const manifest = [];
  for (const audit of audits.sort((left, right) => left.template.title.localeCompare(right.template.title, "ru"))) {
    const target = TARGETS[audit.template.id];
    const document = buildImportDocument(audit, target);
    const path = resolve(outputDirectory, target.fileName);
    await writeFile(path, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    const questions = document.test.sections.flatMap((section) => section.questions);
    manifest.push({
      contentBlocks: document.test.sections.reduce(
        (count, section) => count + section.content_blocks.length,
        0,
      ),
      fileName: target.fileName,
      options: questions.reduce((count, question) => count + (question.options?.length ?? 0), 0),
      questions: questions.length,
      sections: document.test.sections.length,
      sourceVersionId: audit.latestPublishedVersion.version.id,
      sourceVersionNumber: audit.latestPublishedVersion.version.version_number,
      templateId: audit.template.id,
      title: audit.template.title,
    });
  }
  await writeFile(
    resolve(outputDirectory, "manifest.json"),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), imports: manifest }, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2] ? resolve(process.argv[2]) : null;
  const output = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_OUTPUT;
  if (!input) {
    throw new Error(
      "Usage: node scripts/build-scoring-v2-imports.mjs <audit-directory> [output-directory]",
    );
  }
  const manifest = await buildImports(input, output);
  console.log(`Created ${manifest.length} Scoring V2 imports in ${output}`);
  for (const item of manifest) {
    console.log(
      `${item.title}: ${item.sections} sections, ${item.questions} questions, ${item.options} options, ${item.contentBlocks} content blocks`,
    );
  }
}
