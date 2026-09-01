import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  collectAssessmentDimensions,
  extractScoringDefinitionMetadata,
} from "../lib/assessment-results/collect-dimensions.ts";
import { buildAssessmentHighlights } from "../lib/assessment-results/highlights.ts";
import { mergeLegacyPresentationInputs } from "../lib/assessment-results/legacy-inputs.ts";
import { resolveAssessmentReportGroup } from "../lib/assessment-results/report-groups.ts";
import { summarizeAssessmentDimensions } from "../lib/assessment-results/summarize-dimensions.ts";
import { resolveCandidateSessionPassingScore } from "../lib/reports/candidate-session-passing-score.ts";

const confidence = {
  confidence_interval: null,
  coverage: { answered_items: 3, eligible_items: 3, ratio: 1 },
  level: "not_available",
  reliability: { method: "not_available", source: null, value: null },
  standard_error: null,
};

function profileResult() {
  return {
    assessmentDomain: "motivation",
    compositeScores: [],
    criterionScores: [],
    definitionVersionId: "version-1",
    engineVersion: "talvia-scoring/2.0.0",
    forcedChoiceScores: [],
    interpretation: null,
    metrics: { attention: null, learning: null },
    overallScore: null,
    resultShape: "profile",
    scaleScores: [
      {
        confidence,
        id: "autonomy",
        norm_score: null,
        normalized_score: 82,
        raw_score: 4.1,
        status: "ok",
      },
      {
        confidence,
        id: "team",
        norm_score: null,
        normalized_score: 38,
        raw_score: 1.9,
        status: "ok",
      },
    ],
    schemaVersion: "2.0",
    scoredAt: "2026-08-31T12:00:00.000Z",
    status: "complete",
    warnings: [],
  };
}

test("report group resolver covers v2 domains and legacy mappings", () => {
  const v2Cases = [
    ["learning", "cognitive"],
    ["attention", "cognitive"],
    ["motivation", "motivation"],
    ["personality", "personality"],
    ["knowledge", "knowledge_skills"],
    ["skills", "knowledge_skills"],
  ] as const;
  for (const [assessmentDomain, expected] of v2Cases) {
    assert.equal(
      resolveAssessmentReportGroup({
        assessmentDomain,
        resultShape: assessmentDomain === "motivation" || assessmentDomain === "personality"
          ? "profile"
          : "score",
        sourceType: "scale",
      }),
      expected,
    );
  }
  assert.equal(
    resolveAssessmentReportGroup({
      assessmentDomain: "behavior",
      resultShape: "profile",
      sourceType: "forced_choice",
    }),
    "behavior",
  );
  for (const [legacyKey, expected] of [
    ["motivation_result", "motivation"],
    ["responsibility", "work_competencies"],
    ["attention_to_detail", "cognitive"],
    ["learning_ability", "cognitive"],
  ] as const) {
    assert.equal(
      resolveAssessmentReportGroup({
        assessmentDomain: "other",
        legacyKey,
        resultShape: "score",
        sourceType: "legacy_competency",
      }),
      expected,
    );
  }
});

test("legacy dimensions use explicit report groups and neutral profile labels", () => {
  const dimensions = collectAssessmentDimensions({
    legacy: [
      {
        isBelowMinimum: false,
        key: "attention_to_detail",
        minimumScore: null,
        percentage: 75,
      },
      {
        isBelowMinimum: false,
        key: "motivation_autonomy",
        minimumScore: null,
        percentage: 82,
      },
    ],
  });

  assert.deepEqual(
    dimensions.map((dimension) => [dimension.key, dimension.reportGroup]),
    [
      ["attention_to_detail", "cognitive"],
      ["motivation_autonomy", "motivation"],
    ],
  );
  assert.equal(dimensions[0].thresholdStatus, "not_configured");
  assert.equal(dimensions[1].title, "Автономия");
  assert.equal(dimensions[1].interpretationDirection, "neutral");
  assert.equal(dimensions[1].thresholdStatus, "not_applicable");
});

test("v2 dimensions use definition titles and replace overlapping legacy profile rows", () => {
  const definition = extractScoringDefinitionMetadata({
    composites: [],
    scales: [
      { displayOrder: 1, id: "autonomy", title: "Самостоятельность" },
      { displayOrder: 2, id: "team", title: "Командная среда" },
    ],
  });
  const dimensions = collectAssessmentDimensions({
    legacy: [
      {
        isBelowMinimum: false,
        key: "motivation_autonomy",
        minimumScore: null,
        percentage: 70,
        sessionId: "session-v2",
      },
    ],
    sessions: [{ definition, scoringResult: profileResult(), sessionId: "session-v2" }],
  });

  assert.equal(dimensions.length, 2);
  assert.deepEqual(dimensions.map((dimension) => dimension.title), [
    "Самостоятельность",
    "Командная среда",
  ]);
  assert.ok(dimensions.every((dimension) => dimension.reportGroup === "motivation"));
  assert.ok(dimensions.every((dimension) => dimension.interpretationDirection === "neutral"));
});

test("highlights are deterministic, bounded, and do not call motivation a strength", () => {
  const dimensions = collectAssessmentDimensions({
    sessions: [
      {
        definition: extractScoringDefinitionMetadata({
          scales: [
            { displayOrder: 1, id: "autonomy", title: "Автономия" },
            { displayOrder: 2, id: "team", title: "Команда" },
          ],
        }),
        scoringResult: profileResult(),
      },
    ],
  });
  const groups = summarizeAssessmentDimensions(dimensions);
  const highlights = buildAssessmentHighlights(groups, 5);

  assert.ok(highlights.length <= 5);
  assert.match(highlights[0].text, /Ведущие мотиваторы/);
  assert.doesNotMatch(highlights.map((highlight) => highlight.text).join(" "), /сильн/i);
  assert.deepEqual(highlights, buildAssessmentHighlights(groups, 5));
});

test("candidate and employee reports use the same assessment dimension read model", () => {
  const employeeDataSource = readFileSync(
    new URL("../lib/employee-assessments/data.ts", import.meta.url),
    "utf8",
  );
  const candidateDataSource = readFileSync(
    new URL("../lib/reports/data.ts", import.meta.url),
    "utf8",
  );
  const sharedUiSource = readFileSync(
    new URL("../components/reports/assessment-dimensions-report.tsx", import.meta.url),
    "utf8",
  );

  assert.match(employeeDataSource, /collectAssessmentDimensions/);
  assert.match(candidateDataSource, /collectAssessmentDimensions/);
  assert.match(sharedUiSource, /AssessmentDimensionsReport/);
  assert.doesNotMatch(sharedUiSource, /В норме/);
});

function score(id: string, normalizedScore = 75, rawScore = 3) {
  return {
    confidence,
    id,
    norm_score: null,
    normalized_score: normalizedScore,
    raw_score: rawScore,
    status: "ok",
  };
}

function objectiveResult(overrides: Record<string, unknown> = {}) {
  return {
    assessmentDomain: "knowledge",
    compositeScores: [],
    criterionScores: [score("question-a"), score("question-b"), score("criterion_total", 80, 8)],
    definitionVersionId: "version-objective",
    engineVersion: "talvia-scoring/2.0.0",
    forcedChoiceScores: [],
    interpretation: null,
    metrics: { attention: null, learning: null },
    overallScore: 80,
    resultShape: "score",
    scaleScores: [],
    schemaVersion: "2.0",
    scoredAt: "2026-08-31T12:00:00.000Z",
    status: "complete",
    warnings: [],
    ...overrides,
  };
}

test("objective collector hides question criterion IDs and keeps the configured overall", () => {
  const dimensions = collectAssessmentDimensions({
    sessions: [{
      definition: extractScoringDefinitionMetadata({
        overallScore: { sourceId: "criterion_total", sourceType: "criterion" },
      }),
      scoringResult: objectiveResult(),
      testVersionId: "version-objective",
    }],
  });

  assert.deepEqual(dimensions.map((dimension) => dimension.key), ["criterion_total"]);
  assert.equal(dimensions[0].id, "version-objective:criterion:criterion_total");
});

test("learning, attention, and SJT expose only domain report scores", () => {
  const learning = collectAssessmentDimensions({
    sessions: [{
      definition: extractScoringDefinitionMetadata({
        overallScore: { sourceId: "learning_final", sourceType: "criterion" },
      }),
      scoringResult: objectiveResult({
        assessmentDomain: "learning",
        criterionScores: [
          score("question-a"),
          score("criterion_total"),
          score("learning_initial", 50),
          score("learning_recovery", 70),
          score("learning_final", 80),
        ],
        definitionVersionId: "learning-version",
      }),
    }],
  });
  assert.deepEqual(learning.map((dimension) => dimension.key), [
    "learning_initial",
    "learning_recovery",
    "learning_final",
  ]);

  const attention = collectAssessmentDimensions({
    sessions: [{
      definition: extractScoringDefinitionMetadata({
        overallScore: { sourceId: "attention_accuracy", sourceType: "criterion" },
      }),
      scoringResult: objectiveResult({
        assessmentDomain: "attention",
        criterionScores: [score("question-a"), score("criterion_total"), score("attention_accuracy", 91)],
      }),
    }],
  });
  assert.deepEqual(attention.map((dimension) => dimension.key), ["attention_accuracy"]);

  const sjt = collectAssessmentDimensions({
    sessions: [{
      definition: extractScoringDefinitionMetadata({
        overallScore: { sourceId: "sjt_total", sourceType: "criterion" },
        scales: [{ displayOrder: 2, id: "collaboration", title: "Сотрудничество" }],
      }),
      scoringResult: objectiveResult({
        assessmentDomain: "sjt",
        criterionScores: [score("situation-a"), score("sjt_total", 78)],
        resultShape: "hybrid",
        scaleScores: [score("collaboration", 84)],
      }),
    }],
  });
  assert.deepEqual(sjt.map((dimension) => dimension.key), ["sjt_total", "collaboration"]);
});

test("composite titles are preserved and duplicate score IDs stay isolated by test version", () => {
  const composite = collectAssessmentDimensions({
    sessions: [{
      definition: extractScoringDefinitionMetadata({
        composites: [{ id: "professional_fit", title: "Профессиональная готовность" }],
        overallScore: { sourceId: "professional_fit", sourceType: "composite" },
      }),
      scoringResult: objectiveResult({
        compositeScores: [score("professional_fit", 88)],
        criterionScores: [score("question-a"), score("criterion_total", 82)],
        overallScore: 88,
      }),
    }],
  });
  assert.deepEqual(composite.map((dimension) => dimension.title), ["Профессиональная готовность"]);

  const collision = collectAssessmentDimensions({
    sessions: ["version-a", "version-b"].map((testVersionId, index) => ({
      definition: extractScoringDefinitionMetadata({
        overallScore: { sourceId: "criterion_total", sourceType: "criterion" },
      }),
      scoringResult: objectiveResult({
        criterionScores: [score("criterion_total", 80 + index, 8 + index)],
        definitionVersionId: testVersionId,
        overallScore: 80 + index,
      }),
      testTitle: testVersionId === "version-a" ? "Test A" : "Test B",
      testVersionId,
    })),
  });
  assert.equal(collision.length, 2);
  assert.notEqual(collision[0].id, collision[1].id);
  assert.deepEqual(collision.map((dimension) => dimension.testTitle), ["Test A", "Test B"]);
  assert.deepEqual(
    Object.fromEntries(collision.map((dimension) => [dimension.id, dimension.normalizedScore])),
    {
      "version-a:criterion:criterion_total": 80,
      "version-b:criterion:criterion_total": 81,
    },
  );
});

test("mixed legacy/v2 deduplicates only the matching session and aggregates legacy raw totals", () => {
  const dimensions = collectAssessmentDimensions({
    legacy: [
      {
        isBelowMinimum: false,
        key: "motivation_autonomy",
        maxScore: 10,
        percentage: 80,
        score: 8,
        sessionId: "legacy-a",
        testVersionId: "legacy-version",
      },
      {
        isBelowMinimum: false,
        key: "motivation_autonomy",
        maxScore: 5,
        percentage: 40,
        score: 2,
        sessionId: "legacy-b",
        testVersionId: "legacy-version-2",
      },
      {
        isBelowMinimum: false,
        key: "motivation_autonomy",
        maxScore: 5,
        percentage: 100,
        score: 5,
        sessionId: "v2-session",
        testVersionId: "v2-version",
      },
    ],
    sessions: [{
      definition: extractScoringDefinitionMetadata({
        scales: [{ displayOrder: 1, id: "autonomy", title: "Автономия v2" }],
      }),
      scoringResult: profileResult(),
      sessionId: "v2-session",
      testVersionId: "v2-version",
    }],
  });
  const legacy = dimensions.find((dimension) => dimension.sourceType === "legacy_competency");
  assert.equal(dimensions.length, 3);
  assert.equal(legacy?.normalizedScore, 66.67);
});

test("legacy aggregation uses persisted percentages instead of reconstructing them from raw scores", () => {
  const single = collectAssessmentDimensions({
    legacy: [{
      isBelowMinimum: false,
      key: "responsibility",
      maxScore: 1,
      percentage: 0,
      score: -1,
    }],
  });
  assert.equal(single[0].normalizedScore, 0);

  const weighted = collectAssessmentDimensions({
    legacy: [
      { isBelowMinimum: false, key: "responsibility", maxScore: 1, percentage: 0, score: -1 },
      { isBelowMinimum: false, key: "responsibility", maxScore: 1, percentage: 50, score: 0 },
      { isBelowMinimum: false, key: "responsibility", maxScore: 1, percentage: 100, score: 1 },
    ],
  });
  assert.equal(weighted[0].normalizedScore, 50);

  const summaryFallback = collectAssessmentDimensions({
    legacy: [
      { isBelowMinimum: false, key: "responsibility", percentage: 10, summaryPercentage: 67 },
      { isBelowMinimum: false, key: "responsibility", percentage: 90, summaryPercentage: 67 },
    ],
  });
  assert.equal(summaryFallback[0].normalizedScore, 67);
});

test("legacy input merge preserves unlinked rows, fills missing summary keys, and keeps v2 compatibility", () => {
  const summaryRows = [
    {
      interpretationDirection: "lower_is_better" as const,
      isBelowMinimum: false,
      key: "responsibility",
      percentage: 64,
    },
    {
      interpretationDirection: "neutral" as const,
      isBelowMinimum: false,
      key: "motivation_autonomy",
      percentage: 72,
    },
  ];
  const merged = mergeLegacyPresentationInputs({
    linkedRows: [{
      isBelowMinimum: false,
      key: "responsibility",
      percentage: 70,
      sessionId: "legacy-session",
    }],
    summaryRows,
    unlinkedRows: [{
      isBelowMinimum: false,
      key: "responsibility",
      percentage: 50,
    }],
  });
  assert.equal(merged.length, 3);
  assert.equal(merged.filter((row) => row.key === "responsibility").length, 2);
  assert.ok(merged.filter((row) => row.key === "responsibility").every(
    (row) => row.interpretationDirection === "lower_is_better" && row.summaryPercentage === 64,
  ));
  const [conflict] = mergeLegacyPresentationInputs({
    linkedRows: [{
      interpretationDirection: "higher_is_better",
      isBelowMinimum: false,
      key: "responsibility",
      percentage: 70,
    }],
    summaryRows: [{
      interpretationDirection: "lower_is_better",
      isBelowMinimum: false,
      key: "responsibility",
      percentage: 70,
    }],
  });
  assert.equal(conflict.interpretationDirection, "neutral");

  const dimensions = collectAssessmentDimensions({
    legacy: mergeLegacyPresentationInputs({
      linkedRows: [
        { isBelowMinimum: false, key: "responsibility", percentage: 30, sessionId: "v2-session" },
        { isBelowMinimum: false, key: "communication", percentage: 55, sessionId: "legacy-session" },
      ],
      unlinkedRows: [
        { isBelowMinimum: false, key: "responsibility", percentage: 45 },
        { isBelowMinimum: false, key: "learning_ability", percentage: 60 },
      ],
    }),
    sessions: [{
      definition: extractScoringDefinitionMetadata({
        scales: [{ displayOrder: 1, id: "responsibility", title: "Responsibility v2" }],
      }),
      scoringResult: objectiveResult({
        assessmentDomain: "behavior",
        criterionScores: [],
        resultShape: "profile",
        scaleScores: [score("responsibility", 76)],
      }),
      sessionId: "v2-session",
    }],
  });
  assert.ok(dimensions.some((dimension) => dimension.sourceType === "scale" && dimension.key === "responsibility"));
  assert.ok(dimensions.some((dimension) => dimension.sourceType === "legacy_competency" && dimension.key === "responsibility"));
  assert.ok(dimensions.some((dimension) => dimension.key === "communication"));
  assert.ok(dimensions.some((dimension) => dimension.key === "learning_ability"));
});

test("legacy interpretation direction conflicts resolve to neutral", () => {
  const [dimension] = collectAssessmentDimensions({
    legacy: [
      { interpretationDirection: "higher_is_better", isBelowMinimum: false, key: "responsibility", percentage: 70 },
      { interpretationDirection: "lower_is_better", isBelowMinimum: false, key: "responsibility", percentage: 60 },
    ],
  });
  assert.equal(dimension.interpretationDirection, "neutral");
});

test("matching legacy competency and v2 scale keys do not duplicate within a behavior session", () => {
  const dimensions = collectAssessmentDimensions({
    legacy: [
      {
        isBelowMinimum: false,
        key: "responsibility",
        maxScore: 10,
        percentage: 70,
        score: 7,
        sessionId: "behavior-v2",
      },
      {
        isBelowMinimum: false,
        key: "communication",
        maxScore: 10,
        percentage: 60,
        score: 6,
        sessionId: "behavior-legacy",
      },
    ],
    sessions: [{
      definition: extractScoringDefinitionMetadata({
        scales: [{ displayOrder: 1, id: "responsibility", title: "Ответственность v2" }],
      }),
      scoringResult: objectiveResult({
        assessmentDomain: "behavior",
        criterionScores: [],
        resultShape: "profile",
        scaleScores: [score("responsibility", 76)],
      }),
      sessionId: "behavior-v2",
      testVersionId: "behavior-version",
    }],
  });
  assert.deepEqual(
    dimensions.map((dimension) => [dimension.sourceType, dimension.key]),
    [["scale", "responsibility"], ["legacy_competency", "communication"]],
  );
});

test("threshold, interpretation, norm, and definition order remain distinct", () => {
  const result = objectiveResult({
    criterionScores: [{
      ...score("criterion_total", 72, 7.2),
      norm_score: {
        norm_set_id: "norm-1",
        norm_set_version: 1,
        population_label: "Специалисты продаж",
        primary: { metric: "percentile", value: 81 },
      },
    }],
    interpretation: { code: "above_average", label: "Выше среднего", min: 70, max: 84.99 },
    overallScore: 72,
  });
  const [dimension] = collectAssessmentDimensions({
    sessions: [{
      definition: extractScoringDefinitionMetadata({
        overallScore: { sourceId: "criterion_total", sourceType: "criterion" },
      }),
      passingScore: 75,
      scoringResult: result,
    }],
  });
  assert.equal(dimension.thresholdStatus, "failed");
  assert.deepEqual(dimension.threshold, {
    kind: "test_passing_score",
    status: "failed",
    value: 75,
  });
  assert.equal(dimension.interpretation?.label, "Выше среднего");
  assert.deepEqual(dimension.norm, {
    metric: "percentile",
    populationLabel: "Специалисты продаж",
    value: 81,
  });
});

test("thresholds are typed and unavailable values are never failed", () => {
  const [legacy] = collectAssessmentDimensions({
    legacy: [{
      isBelowMinimum: false,
      key: "responsibility",
      minimumScore: 70,
      percentage: 72,
    }],
  });
  assert.deepEqual(legacy.threshold, {
    kind: "competency_minimum",
    status: "passed",
    value: 70,
  });

  const unavailableResult = objectiveResult({
    criterionScores: [{
      ...score("criterion_total"),
      normalized_score: null,
      raw_score: null,
      status: "insufficient_data",
    }],
    overallScore: null,
    status: "insufficient_data",
  });
  const [unavailable] = collectAssessmentDimensions({
    sessions: [{
      definition: extractScoringDefinitionMetadata({
        overallScore: { sourceId: "criterion_total", sourceType: "criterion" },
      }),
      passingScore: 70,
      scoringResult: unavailableResult,
    }],
  });
  assert.equal(unavailable.valueStatus, "insufficient_data");
  assert.equal(unavailable.threshold, null);
  assert.notEqual(unavailable.thresholdStatus, "failed");
});

test("candidate report passing score preserves an explicit null in a frozen snapshot", () => {
  assert.equal(resolveCandidateSessionPassingScore({
    currentPackagePassingScore: 70,
    snapshotPackageId: "package-snapshot",
    snapshotPassingScore: null,
  }), null);
  assert.equal(resolveCandidateSessionPassingScore({
    currentPackagePassingScore: 70,
    snapshotPackageId: "package-snapshot",
    snapshotPassingScore: 60,
  }), 60);
  assert.equal(resolveCandidateSessionPassingScore({
    currentPackagePassingScore: 70,
    snapshotPackageId: null,
    snapshotPassingScore: null,
  }), 70);
});

test("v2 overall threshold uses overallScore when normalized score is absent", () => {
  const collectComposite = (overallScore: number | null) => collectAssessmentDimensions({
    sessions: [{
      definition: extractScoringDefinitionMetadata({
        composites: [
          { id: "overall-composite", title: "Overall", displayOrder: 0 },
          { id: "supporting-composite", title: "Supporting", displayOrder: 1 },
        ],
        overallScore: { sourceId: "overall-composite", sourceType: "composite" },
      }),
      passingScore: 75,
      scoringResult: objectiveResult({
        compositeScores: [
          {
            ...score("overall-composite", 72, 72),
            normalized_score: null,
          },
          score("supporting-composite", 90, 90),
        ],
        criterionScores: [],
        overallScore,
      }),
    }],
  });

  const failed = collectComposite(72);
  assert.equal(failed[0].valueStatus, "available");
  assert.equal(failed[0].normalizedScore, 72);
  assert.deepEqual(failed[0].threshold, {
    kind: "test_passing_score",
    status: "failed",
    value: 75,
  });
  assert.equal(failed[1].threshold, null);

  const passed = collectComposite(80);
  assert.equal(passed[0].normalizedScore, 80);
  assert.deepEqual(passed[0].threshold, {
    kind: "test_passing_score",
    status: "passed",
    value: 75,
  });

  const missing = collectComposite(null);
  assert.equal(missing[0].threshold, null);
  assert.notEqual(missing[0].thresholdStatus, "failed");
});

test("candidate and employee paths merge all legacy inputs and expose direction and threshold semantics", () => {
  const employeeDataSource = readFileSync(new URL("../lib/employee-assessments/data.ts", import.meta.url), "utf8");
  const candidateDataSource = readFileSync(new URL("../lib/reports/data.ts", import.meta.url), "utf8");
  const sharedUiSource = readFileSync(
    new URL("../components/reports/assessment-dimensions-report.tsx", import.meta.url),
    "utf8",
  );

  for (const source of [employeeDataSource, candidateDataSource]) {
    assert.match(source, /mergeLegacyPresentationInputs/);
    assert.doesNotMatch(source, /sessionLegacy\.length\s*>\s*0/);
    assert.match(source, /interpretation_direction/);
  }
  assert.match(sharedUiSource, /Обязательный минимум выполнен/);
  assert.match(sharedUiSource, /Проходной балл достигнут/);
  assert.match(sharedUiSource, /Недостаточно данных/);
  assert.match(sharedUiSource, /dimension\.threshold !== null/);
});

test("candidate sessions freeze package scoring configuration with a legacy fallback", () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/20260901120000_freeze_candidate_assessment_package_sessions.sql", import.meta.url),
    "utf8",
  );
  const scoringSource = readFileSync(new URL("../lib/scoring/service.ts", import.meta.url), "utf8");
  assert.match(migration, /package_passing_score/);
  assert.match(migration, /package_contributes_to_overall/);
  assert.match(migration, /freeze_test_session_package_configuration/);
  assert.match(scoringSource, /hasFrozenPackageConfiguration/);
});

test("business code does not infer motivation semantics from a string prefix", () => {
  const roots = ["../app", "../components", "../lib"].map((path) =>
    fileURLToPath(new URL(path, import.meta.url))
  );
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(path);
    }
  };
  roots.forEach(visit);
  const offenders = files.filter((path) =>
    /startsWith\(["']motivation_/.test(readFileSync(path, "utf8"))
  );
  assert.deepEqual(offenders, []);
  assert.match(
    readFileSync(new URL("../lib/tests/import-parser.ts", import.meta.url), "utf8"),
    /isLegacyMotivationDimension/,
  );
});
