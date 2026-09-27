import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReportAnswerSummary,
  countAnswerCorrectness,
  formatReportAnswerSummary,
  usesCorrectnessSummary,
} from "../lib/reports/answer-counts.ts";

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

test("profile and ipsative domains use completion instead of correctness", () => {
  assert.equal(usesCorrectnessSummary({ resultShape: "profile" }), false);
  assert.equal(usesCorrectnessSummary({ scoringType: "competency_profile" }), false);
  assert.equal(usesCorrectnessSummary({ assessmentDomain: "behavior", resultShape: "hybrid" }), false);
  assert.equal(usesCorrectnessSummary({ assessmentDomain: "sjt", resultShape: "hybrid" }), false);
  assert.equal(usesCorrectnessSummary({ assessmentDomain: "attention", resultShape: "score" }), true);
});

test("completion summary uses total counts independently of the current answer page", () => {
  assert.deepEqual(
    buildReportAnswerSummary({
      answeredCount: 27,
      answers: [{ isCorrect: null }],
      eligibleCount: 27,
      usesCorrectness: false,
    }),
    { answered: 27, completionRate: 100, eligible: 27, kind: "completion" },
  );
  assert.deepEqual(
    buildReportAnswerSummary({
      answeredCount: 2,
      answers: [{ isCorrect: true }, { isCorrect: false }],
      eligibleCount: 32,
      usesCorrectness: true,
    }),
    { correct: 1, incorrect: 1, kind: "correctness" },
  );
});

test("answer summary wording never uses correctness for a profile", () => {
  assert.equal(
    formatReportAnswerSummary({ answered: 27, completionRate: 100, eligible: 27, kind: "completion" }),
    "Ответов: 27 / 27 / Полнота: 100%",
  );
  assert.equal(
    formatReportAnswerSummary({ correct: 3, incorrect: 1, kind: "correctness" }),
    "Верных: 3 / Неверных: 1",
  );
});
