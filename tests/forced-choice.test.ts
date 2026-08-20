import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeForcedChoiceScore,
  scoreForcedChoiceQuestion,
  validateForcedChoiceAnswer,
  validateForcedChoiceDefinition,
} from "../lib/forced-choice.ts";
import {
  COMPETENCIES,
  MOTIVATION_9_COMPETENCIES,
  isMotivationCompetencyKey,
} from "../lib/jobs/constants.ts";
import { buildMotivation9Profile } from "../lib/reports/motivation-profile.ts";
import { calculateFitScore } from "../lib/scoring/fit-score.ts";
import { TEST_COMPETENCIES } from "../lib/tests/builder-constants.ts";
import { getAllowedImportScoringTypes } from "../lib/tests/import-scoring.ts";
import { validateRemediationLinks } from "../lib/tests/remediation.ts";

const motivation9Keys = [
  "motivation_result",
  "motivation_growth",
  "motivation_autonomy",
  "motivation_influence",
  "motivation_team",
  "motivation_stability",
  "motivation_income",
  "motivation_recognition",
  "motivation_meaning",
] as const;

const importSchema = JSON.parse(
  readFileSync(new URL("../docs/08_TALVIA_TEST_IMPORT_SCHEMA_V1.json", import.meta.url), "utf8"),
) as {
  $defs: {
    competencyKey: { enum: string[] };
    singleChoiceQuestion: {
      allOf: Array<{ properties?: Record<string, unknown> }>;
    };
  };
  properties: { schema_version: { const: string } };
};

for (const key of [
  "motivation_result",
  "motivation_influence",
  "motivation_team",
  "motivation_meaning",
] as const) {
  test(`import: ${key} is accepted by the shared parser list and JSON Schema`, () => {
    assert.equal(TEST_COMPETENCIES.some((competency) => competency.key === key), true);
    assert.equal(importSchema.$defs.competencyKey.enum.includes(key), true);
  });
}

test("import: unknown motivation key is rejected by the supported lists", () => {
  assert.equal(
    TEST_COMPETENCIES.some(
      (competency) => (competency.key as string) === "motivation_unknown",
    ),
    false,
  );
  assert.equal(importSchema.$defs.competencyKey.enum.includes("motivation_unknown"), false);
});

test("import: schema version remains talvia.test.v1", () => {
  assert.equal(importSchema.properties.schema_version.const, "talvia.test.v1");
});

test("import: single_choice schema exposes remediation fields", () => {
  const properties = importSchema.$defs.singleChoiceQuestion.allOf.find(
    (entry) => entry.properties?.options,
  )?.properties;

  assert.ok(properties?.incorrect_feedback);
  assert.ok(properties?.remediation_question_key);
});

const remediationQuestions = [
  {
    id: "q_001",
    incorrectFeedback: "Сначала примените правило приоритета.",
    options: [{ isCorrect: true }, { isCorrect: false }],
    questionType: "single_choice" as const,
    remediationQuestionId: "q_001_retry",
  },
  {
    id: "q_001_retry",
    incorrectFeedback: null,
    options: [{ isCorrect: true }, { isCorrect: false }],
    questionType: "single_choice" as const,
    remediationQuestionId: null,
  },
];

test("import: valid remediation link points to a later question in the same section", () => {
  assert.equal(validateRemediationLinks([{ questions: remediationQuestions }]), null);
});

test("import: remediation link cannot point to an earlier question", () => {
  const reversed = [remediationQuestions[1], remediationQuestions[0]];
  assert.match(validateRemediationLinks([{ questions: reversed }]) ?? "", /ниже исходного/);
});

test("import: remediation link requires feedback", () => {
  const withoutFeedback = remediationQuestions.map((question, index) =>
    index === 0 ? { ...question, incorrectFeedback: null } : question,
  );
  assert.match(validateRemediationLinks([{ questions: withoutFeedback }]) ?? "", /объяснение/);
});

test("import: remediation feedback requires a target question", () => {
  const withoutTarget = remediationQuestions.map((question, index) =>
    index === 0 ? { ...question, remediationQuestionId: null } : question,
  );
  assert.match(
    validateRemediationLinks([{ questions: withoutTarget }]) ?? "",
    /выберите повторный вопрос/,
  );
});

test("import: remediation target cannot be reused", () => {
  const duplicateSource = {
    ...remediationQuestions[0],
    id: "q_002",
  };
  assert.match(
    validateRemediationLinks([
      { questions: [remediationQuestions[0], duplicateSource, remediationQuestions[1]] },
    ]) ?? "",
    /нельзя привязать к нескольким/,
  );
});

test("import: remediation target cannot open another remediation branch", () => {
  const chainedTarget = {
    ...remediationQuestions[1],
    incorrectFeedback: "Попробуйте еще раз.",
    remediationQuestionId: "q_002_retry",
  };
  const finalTarget = {
    ...remediationQuestions[1],
    id: "q_002_retry",
  };
  assert.match(
    validateRemediationLinks([
      { questions: [remediationQuestions[0], chainedTarget, finalTarget] },
    ]) ?? "",
    /не может одновременно открывать/,
  );
});

const options: Array<{ competencyEffects: Record<string, number>; id: string }> = [
  { competencyEffects: { work_initiative: 1 }, id: "option-a" },
  { competencyEffects: { work_collaboration: 1 }, id: "option-b" },
  { competencyEffects: { work_organization: 1 }, id: "option-c" },
];

test("import: valid most_least definition with three options", () => {
  assert.deepEqual(
    validateForcedChoiceDefinition({ mode: "most_least", options }),
    { ok: true },
  );
});

test("import: Motivation-9 Forced Choice definition with three options", () => {
  assert.deepEqual(
    validateForcedChoiceDefinition({
      mode: "most_least",
      options: [
        { competencyEffects: { motivation_result: 1 } },
        { competencyEffects: { motivation_growth: 1 } },
        { competencyEffects: { motivation_influence: 1 } },
      ],
    }),
    { ok: true },
  );
});

test("import: a pure Forced Choice test requires competency_profile scoring", () => {
  assert.deepEqual(getAllowedImportScoringTypes(["forced_choice"]), ["competency_profile"]);
  assert.equal(getAllowedImportScoringTypes(["forced_choice"]).includes("points"), false);
});

test("import: legacy motivation_structure remains supported", () => {
  assert.equal(
    TEST_COMPETENCIES.some((competency) => competency.key === "motivation_structure"),
    true,
  );
  assert.equal(importSchema.$defs.competencyKey.enum.includes("motivation_structure"), true);
});

test("import: mode is required", () => {
  const result = validateForcedChoiceDefinition({ mode: undefined, options });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /mode = most_least/);
});

test("import: unknown mode is rejected", () => {
  const result = validateForcedChoiceDefinition({ mode: "ranking", options });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Поддерживается только/);
});

test("import: two options are rejected", () => {
  const result = validateForcedChoiceDefinition({
    mode: "most_least",
    options: options.slice(0, 2),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /минимум три/);
});

test("answer: distinct MOST and LEAST from the current question are accepted", () => {
  const result = validateForcedChoiceAnswer(
    { leastOptionId: "option-b", mostOptionId: "option-a" },
    options.map((option) => option.id),
    "most_least",
  );
  assert.deepEqual(result, {
    answer: { leastOptionId: "option-b", mostOptionId: "option-a" },
    ok: true,
  });
});

test("answer: missing MOST is rejected", () => {
  const result = validateForcedChoiceAnswer(
    { leastOptionId: "option-b" },
    options.map((option) => option.id),
    "most_least",
  );
  assert.equal(result.ok, false);
});

test("answer: missing LEAST is rejected", () => {
  const result = validateForcedChoiceAnswer(
    { mostOptionId: "option-a" },
    options.map((option) => option.id),
    "most_least",
  );
  assert.equal(result.ok, false);
});

test("answer: the same option cannot be MOST and LEAST", () => {
  const result = validateForcedChoiceAnswer(
    { leastOptionId: "option-a", mostOptionId: "option-a" },
    options.map((option) => option.id),
    "most_least",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /одновременно/);
});

test("answer: option from another question is rejected", () => {
  const result = validateForcedChoiceAnswer(
    { leastOptionId: "another-question-option", mostOptionId: "option-a" },
    options.map((option) => option.id),
    "most_least",
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /текущему вопросу/);
});

test("scoring: MOST adds and LEAST subtracts competency effects", () => {
  const result = scoreForcedChoiceQuestion(options, {
    leastOptionId: "option-b",
    mostOptionId: "option-a",
  });

  assert.equal(result.work_initiative.rawScore, 1);
  assert.equal(result.work_collaboration.rawScore, -1);
  assert.equal(normalizeForcedChoiceScore(result.work_initiative), 100);
  assert.equal(normalizeForcedChoiceScore(result.work_collaboration), 0);
});

test("scoring: Motivation-9 gives MOST +1, LEAST -1 and the middle scale 0", () => {
  const result = scoreForcedChoiceQuestion(
    [
      { competencyEffects: { motivation_growth: 1 }, id: "growth" },
      { competencyEffects: { motivation_income: 1 }, id: "income" },
      { competencyEffects: { motivation_team: 1 }, id: "team" },
    ],
    { leastOptionId: "income", mostOptionId: "growth" },
  );

  assert.equal(result.motivation_growth.rawScore, 1);
  assert.equal(result.motivation_income.rawScore, -1);
  assert.equal(result.motivation_team.rawScore, 0);
});

test("fit score: all Motivation-9 keys are excluded even if weights are configured", () => {
  const competencies = [
    { competency_key: "learning_ability", percentage: 64 },
    ...motivation9Keys.map((key) => ({ competency_key: key, percentage: 100 })),
  ];
  const weights = [
    { competency_key: "learning_ability", weight: 1 },
    ...motivation9Keys.map((key) => ({ competency_key: key, weight: 10 })),
  ];

  assert.equal(calculateFitScore(competencies, weights), 64);
  assert.equal(
    calculateFitScore(
      competencies.filter((competency) => isMotivationCompetencyKey(competency.competency_key)),
      weights,
    ),
    null,
  );
  assert.equal(motivation9Keys.every(isMotivationCompetencyKey), true);
  assert.equal(
    COMPETENCIES.filter((competency) => motivation9Keys.includes(competency.key as never)).every(
      (competency) => competency.defaultWeight === 0,
    ),
    true,
  );
});

test("report: complete Motivation-9 profile is ranked into the requested groups", () => {
  const percentages = [67, 83, 94, 56, 44, 17, 28, 39, 61];
  const profile = buildMotivation9Profile(
    MOTIVATION_9_COMPETENCIES.map((competency, index) => ({
      key: competency.key,
      label: competency.label,
      percentage: percentages[index],
    })),
  );

  assert.ok(profile);
  assert.deepEqual(
    profile.core.map((competency) => competency.key),
    ["motivation_autonomy", "motivation_growth"],
  );
  assert.deepEqual(
    profile.groups.map((group) => group.competencies.length),
    [2, 2, 3, 2],
  );
});

test("report: legacy six-scale profile keeps the backward-compatible fallback", () => {
  assert.equal(
    buildMotivation9Profile([
      { key: "motivation_structure", label: "Мотивация: структура", percentage: 80 },
    ]),
    null,
  );
});

test("mixed assessment: Forced Choice scoring does not alter SJT points", () => {
  const sjtPoints = 3;
  const forcedChoice = scoreForcedChoiceQuestion(options, {
    leastOptionId: "option-b",
    mostOptionId: "option-a",
  });

  assert.equal(sjtPoints, 3);
  assert.equal(forcedChoice.work_initiative.rawScore, 1);
  assert.equal(forcedChoice.work_collaboration.rawScore, -1);
});
