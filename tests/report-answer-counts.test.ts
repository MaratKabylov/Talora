import assert from "node:assert/strict";
import test from "node:test";

import { countAnswerCorrectness } from "../lib/reports/answer-counts.ts";

test("counts only answers with explicit correctness", () => {
  assert.deepEqual(
    countAnswerCorrectness([
      { isCorrect: true },
      { isCorrect: false },
      { isCorrect: null },
      { isCorrect: true },
    ]),
    { correct: 2, incorrect: 1 },
  );
});

test("returns zero counts when no answer is evaluated", () => {
  assert.deepEqual(countAnswerCorrectness([{ isCorrect: null }]), {
    correct: 0,
    incorrect: 0,
  });
});
