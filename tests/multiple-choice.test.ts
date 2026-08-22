import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  MULTIPLE_CHOICE_SCORING_VERSION,
  areMultipleChoiceSetsEqual,
  buildMultipleChoiceReportModel,
  getMultipleChoiceOptionPointRange,
  renderMultipleChoiceReportText,
  scoreMultipleChoiceQuestion,
  validateMultipleChoiceAnswer,
  validateMultipleChoiceDefinition,
  type MultipleChoiceOption,
  type MultipleChoiceQuestionSettings,
} from "../lib/answers/multiple-choice.ts";
import { getAllowedImportScoringTypes } from "../lib/tests/import-scoring.ts";

const option = (
  id: string,
  isCorrect: boolean | null,
  points = 0,
): MultipleChoiceOption => ({ id, isCorrect, points });

function definition(input: {
  maxPoints?: number;
  options?: MultipleChoiceOption[];
  required?: boolean;
  settings?: Partial<MultipleChoiceQuestionSettings>;
}) {
  const result = validateMultipleChoiceDefinition({
    maxPoints: input.maxPoints ?? 3,
    options:
      input.options ??
      [option("A", true), option("B", false), option("C", true), option("D", false)],
    required: input.required ?? true,
    settings: {
      correctOptionPoints: 1.5,
      incorrectOptionPenalty: 1,
      maxSelections: 4,
      minPoints: 0,
      minSelections: 1,
      multipleChoiceScoringVersion: MULTIPLE_CHOICE_SCORING_VERSION,
      penaltyMode: "subtract",
      scoringMode: "exact_match",
      ...input.settings,
    },
  });
  assert.equal(result.ok, true, result.ok ? undefined : result.errors.join("; "));
  return result.definition;
}

test("exact_match is order-independent and only the complete set receives full points", () => {
  const exact = definition({});
  for (const ids of [["A", "C"], ["C", "A"]]) {
    const result = scoreMultipleChoiceQuestion({ definition: exact, selectedOptionIds: ids });
    assert.equal(result.isCorrect, true);
    assert.equal(result.rawScore, 3);
    assert.equal(result.pointsAwarded, 3);
  }
  for (const ids of [["A"], ["C"], ["A", "B", "C"], ["A", "C", "D"], []]) {
    const result = scoreMultipleChoiceQuestion({ definition: exact, selectedOptionIds: ids });
    assert.equal(result.isCorrect, false);
    assert.equal(result.rawScore, 0);
    assert.equal(result.pointsAwarded, 0);
  }
});

test("duplicates never increase score and option order has no scoring meaning", () => {
  const exact = definition({});
  const duplicated = scoreMultipleChoiceQuestion({
    definition: exact,
    selectedOptionIds: ["C", "A", "C", "A"],
  });
  assert.deepEqual(duplicated.selectedOptionIds, ["C", "A"]);
  assert.equal(duplicated.pointsAwarded, 3);
  assert.equal(areMultipleChoiceSetsEqual(["A", "C"], ["C", "A"]), true);
});

test("partial_credit supports partial points, subtract penalties, floor and cap", () => {
  const partial = definition({
    settings: { scoringMode: "partial_credit" },
  });
  const part = scoreMultipleChoiceQuestion({ definition: partial, selectedOptionIds: ["A"] });
  assert.equal(part.rawScore, 1.5);
  assert.equal(part.pointsAwarded, 1.5);
  assert.equal(part.isCorrect, false);

  const mixed = scoreMultipleChoiceQuestion({
    definition: partial,
    selectedOptionIds: ["A", "B"],
  });
  assert.equal(mixed.rawScore, 0.5);
  assert.equal(mixed.pointsAwarded, 0.5);

  const negative = scoreMultipleChoiceQuestion({
    definition: partial,
    selectedOptionIds: ["B", "D"],
  });
  assert.equal(negative.rawScore, -2);
  assert.equal(negative.pointsAwarded, 0);

  const full = scoreMultipleChoiceQuestion({
    definition: partial,
    selectedOptionIds: ["C", "A"],
  });
  assert.equal(full.rawScore, 3);
  assert.equal(full.pointsAwarded, 3);
  assert.equal(full.isCorrect, true);
});

test("partial_credit penaltyMode none stores no effective penalty", () => {
  const partial = definition({
    settings: {
      incorrectOptionPenalty: 99,
      penaltyMode: "none",
      scoringMode: "partial_credit",
    },
  });
  assert.equal(partial.incorrectOptionPenalty, 0);
  const result = scoreMultipleChoiceQuestion({
    definition: partial,
    selectedOptionIds: ["A", "B"],
  });
  assert.equal(result.rawScore, 1.5);
});

test("option_points sums signed weights, applies floor/cap, and uses threshold", () => {
  const weighted = definition({
    maxPoints: 5,
    options: [option("A", null, 4), option("B", null, -3), option("C", null, 2)],
    settings: {
      correctnessThreshold: 4,
      maxSelections: 3,
      minPoints: -2,
      scoringMode: "option_points",
    },
  });
  const positive = scoreMultipleChoiceQuestion({ definition: weighted, selectedOptionIds: ["A"] });
  assert.equal(positive.rawScore, 4);
  assert.equal(positive.pointsAwarded, 4);
  assert.equal(positive.isCorrect, true);

  const mixed = scoreMultipleChoiceQuestion({
    definition: weighted,
    selectedOptionIds: ["A", "B"],
  });
  assert.equal(mixed.rawScore, 1);
  assert.equal(mixed.isCorrect, false);

  const floor = scoreMultipleChoiceQuestion({ definition: weighted, selectedOptionIds: ["B"] });
  assert.equal(floor.rawScore, -3);
  assert.equal(floor.pointsAwarded, -2);

  const cap = scoreMultipleChoiceQuestion({
    definition: weighted,
    selectedOptionIds: ["A", "C"],
  });
  assert.equal(cap.rawScore, 6);
  assert.equal(cap.pointsAwarded, 5);

  const empty = scoreMultipleChoiceQuestion({ definition: weighted, selectedOptionIds: [] });
  assert.equal(empty.rawScore, 0);
  assert.equal(empty.pointsAwarded, 0);
  assert.equal(empty.isCorrect, false);
});

test("option_points reachable range respects min/max selections", () => {
  assert.deepEqual(
    getMultipleChoiceOptionPointRange({
      maxSelections: 2,
      minSelections: 1,
      optionPoints: [-4, -1, 2, 5],
    }),
    { maximum: 7, minimum: -5 },
  );
});

test("definition validation covers selection, correctness and reachability invariants", () => {
  const cases: Array<[string, Parameters<typeof validateMultipleChoiceDefinition>[0]]> = [
    [
      "limits",
      {
        maxPoints: 2,
        options: [option("A", true), option("B", false)],
        required: true,
        settings: {
          maxSelections: 3,
          minSelections: 0,
          multipleChoiceScoringVersion: 1,
          scoringMode: "exact_match",
        },
      },
    ],
    [
      "no correct",
      {
        maxPoints: 2,
        options: [option("A", false), option("B", false)],
        required: true,
        settings: {
          maxSelections: 2,
          minSelections: 1,
          multipleChoiceScoringVersion: 1,
          scoringMode: "exact_match",
        },
      },
    ],
    [
      "partial unreachable full score",
      {
        maxPoints: 3,
        options: [option("A", true), option("B", false)],
        required: true,
        settings: {
          correctOptionPoints: 1,
          maxSelections: 2,
          minSelections: 1,
          multipleChoiceScoringVersion: 1,
          penaltyMode: "none",
          scoringMode: "partial_credit",
        },
      },
    ],
    [
      "option points boolean correctness",
      {
        maxPoints: 5,
        options: [option("A", true, 5), option("B", null, 0)],
        required: true,
        settings: {
          correctnessThreshold: 4,
          maxSelections: 2,
          minPoints: 0,
          minSelections: 1,
          multipleChoiceScoringVersion: 1,
          scoringMode: "option_points",
        },
      },
    ],
    [
      "unreachable threshold",
      {
        maxPoints: 5,
        options: [option("A", null, 1), option("B", null, 1)],
        required: true,
        settings: {
          correctnessThreshold: 4,
          maxSelections: 2,
          minPoints: 0,
          minSelections: 1,
          multipleChoiceScoringVersion: 1,
          scoringMode: "option_points",
        },
      },
    ],
  ];
  for (const [name, input] of cases) {
    assert.equal(validateMultipleChoiceDefinition(input).ok, false, name);
  }
});

test("one correct option is valid but produces a single_choice warning", () => {
  const result = validateMultipleChoiceDefinition({
    maxPoints: 1,
    options: [option("A", true), option("B", false)],
    required: true,
    settings: {
      maxSelections: 2,
      minPoints: 0,
      minSelections: 1,
      multipleChoiceScoringVersion: 1,
      scoringMode: "exact_match",
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.warnings.length, 1);
});

test("answer validator canonicalizes at the application boundary and can reject DB duplicates", () => {
  const limits = { maxSelections: 2, minSelections: 1, required: true };
  const canonical = validateMultipleChoiceAnswer(
    { selectedOptionIds: ["A", "A", "B"] },
    ["A", "B"],
    limits,
  );
  assert.equal(canonical.ok, true);
  if (canonical.ok) {
    assert.deepEqual(canonical.answer, { selectedOptionIds: ["A", "B"] });
    assert.equal(canonical.canonicalizedDuplicates, true);
  }
  assert.equal(
    validateMultipleChoiceAnswer(
      { selectedOptionIds: ["A", "A"] },
      ["A", "B"],
      limits,
      { rejectDuplicates: true },
    ).ok,
    false,
  );
});

test("answer validator rejects foreign IDs, controlled fields, invalid counts, and required skip", () => {
  const limits = { maxSelections: 2, minSelections: 1, required: true };
  assert.equal(validateMultipleChoiceAnswer({ selectedOptionIds: ["X"] }, ["A"], limits).ok, false);
  assert.equal(
    validateMultipleChoiceAnswer({ pointsAwarded: 5, selectedOptionIds: ["A"] }, ["A"], limits).ok,
    false,
  );
  assert.equal(validateMultipleChoiceAnswer({ selectedOptionIds: [] }, ["A"], limits).ok, false);
  assert.equal(validateMultipleChoiceAnswer({ skipped: true }, ["A"], limits).ok, false);
  assert.equal(
    validateMultipleChoiceAnswer({ selectedOptionIds: ["A"], skipped: true }, ["A"], limits).ok,
    false,
  );
});

test("report model classifies exact/partial choices and hides correct-set language for option_points", () => {
  const options = [
    { ...option("A", true), orderIndex: 0, text: "Alpha" },
    { ...option("B", false), orderIndex: 1, text: "Beta" },
    { ...option("C", true), orderIndex: 2, text: "Gamma" },
  ];
  const model = buildMultipleChoiceReportModel({
    isCorrect: false,
    maxPoints: 3,
    options,
    pointsAwarded: 1.5,
    rawScore: 1.5,
    scoringMode: "partial_credit",
    selectedOptionIds: ["A", "B"],
  });
  assert.equal(model.status, "partial");
  assert.deepEqual(model.selectedIncorrectOptions.map((item) => item.id), ["B"]);
  assert.deepEqual(model.missedCorrectOptions.map((item) => item.id), ["C"]);
  assert.match(renderMultipleChoiceReportText(model), /Пропущено: Gamma/);

  const weighted = buildMultipleChoiceReportModel({
    isCorrect: true,
    maxPoints: 5,
    options: [{ ...option("A", null, 4), orderIndex: 0, text: "Alpha" }],
    pointsAwarded: 4,
    rawScore: 4,
    scoringMode: "option_points",
    selectedOptionIds: ["A"],
  });
  const text = renderMultipleChoiceReportText(weighted);
  assert.match(text, /Вклад вариантов: Alpha: 4/);
  assert.doesNotMatch(text, /Пропущено/);
});

test("talvia.test.v1 schema exposes multiple_choice and all three scoring modes", () => {
  const schema = JSON.parse(
    readFileSync(
      new URL("../docs/08_TALVIA_TEST_IMPORT_SCHEMA_V1.json", import.meta.url),
      "utf8",
    ),
  ) as {
    $defs: Record<string, unknown>;
    properties: { schema_version: { const: string } };
  };
  assert.equal(schema.properties.schema_version.const, "talvia.test.v1");
  assert.ok(schema.$defs.multipleChoiceQuestion);
  assert.ok(schema.$defs.multipleChoiceExactScoring);
  assert.ok(schema.$defs.multipleChoicePartialScoring);
  assert.ok(schema.$defs.multipleChoiceOptionPointsScoring);
  assert.deepEqual(getAllowedImportScoringTypes(["multiple_choice"]), [
    "points",
    "competency_profile",
  ]);
});

test("the documented import fixture contains one example of every strategy", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../docs/11_MULTIPLE_CHOICE_EXAMPLES.json", import.meta.url),
      "utf8",
    ),
  ) as {
    schema_version: string;
    test: { sections: Array<{ questions: Array<{ scoring: { mode: string } }> }> };
  };
  assert.equal(fixture.schema_version, "talvia.test.v1");
  assert.deepEqual(
    fixture.test.sections.flatMap((section) =>
      section.questions.map((question) => question.scoring.mode),
    ),
    ["exact_match", "partial_credit", "option_points"],
  );
});
