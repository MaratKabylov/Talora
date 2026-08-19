import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeForcedChoiceScore,
  scoreForcedChoiceQuestion,
  validateForcedChoiceAnswer,
  validateForcedChoiceDefinition,
} from "../lib/forced-choice.ts";

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
