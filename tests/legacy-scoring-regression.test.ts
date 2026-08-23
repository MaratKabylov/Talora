import assert from "node:assert/strict";
import test from "node:test";

import {
  scoreLegacySession,
  type LegacyAnswerRecord,
  type LegacyOptionRecord,
  type LegacyPackageTestRecord,
  type LegacyQuestionRecord,
  type LegacySessionRecord,
} from "../lib/scoring/models/legacy-session.ts";

const packageTest: LegacyPackageTestRecord = {
  is_required: true,
  passing_score: 65,
  test_version_id: "version-1",
  weight: 1,
};

function session(scoringType: "points" | "competency_profile" | "manual" | "mixed") {
  return {
    id: "session-1",
    status: "completed",
    test_version_id: "version-1",
    test_versions: { scoring_type: scoringType, title: "Legacy fixture" },
  } satisfies LegacySessionRecord;
}

function option(
  id: string,
  input: Partial<Omit<LegacyOptionRecord, "id">> = {},
): LegacyOptionRecord {
  return {
    competency_effect_json: null,
    id,
    is_correct: null,
    match_target_id: id,
    order_index: 0,
    points: 0,
    ...input,
  };
}

function answer(
  id: string,
  questionId: string,
  input: Partial<Omit<LegacyAnswerRecord, "id" | "question_id" | "session_id">> = {},
): LegacyAnswerRecord {
  return {
    answer_json: null,
    answer_text: null,
    id,
    question_id: questionId,
    selected_option_id: null,
    session_id: "session-1",
    ...input,
  };
}

test("legacy session keeps point, scale and competency arithmetic unchanged", () => {
  const questions: LegacyQuestionRecord[] = [
    {
      answer_options: [
        option("wrong", { is_correct: false, points: 0 }),
        option("correct", { is_correct: true, points: 3 }),
      ],
      competency_key: "logical_reasoning",
      id: "single",
      points: 3,
      question_type: "single_choice",
      settings_json: null,
    },
    {
      answer_options: [],
      competency_key: "attention_to_detail",
      id: "scale",
      points: 0,
      question_type: "scale",
      settings_json: { max: 5, min: 1 },
    },
  ];
  const result = scoreLegacySession(session("points"), packageTest, questions, [
    answer("a-single", "single", { selected_option_id: "correct" }),
    answer("a-scale", "scale", { answer_json: { value: 4 } }),
  ]);

  assert.equal(result.score.rawScore, 7);
  assert.equal(result.score.maxScore, 8);
  assert.equal(result.score.percentage, 87.5);
  assert.equal(result.score.requiresReview, false);
  assert.deepEqual(result.score.competencies.get("logical_reasoning"), {
    maxScore: 3,
    minScore: 0,
    score: 3,
  });
  assert.deepEqual(result.score.competencies.get("attention_to_detail"), {
    maxScore: 5,
    minScore: 0,
    score: 4,
  });
  assert.deepEqual(result.answerScores.get("a-single"), {
    isCorrect: true,
    pointsAwarded: 3,
    rawScore: 3,
  });
});

test("legacy remediation excludes an inactive recovery item from all totals", () => {
  const questions: LegacyQuestionRecord[] = [
    {
      answer_options: [
        option("incorrect", { is_correct: false, points: 0 }),
        option("correct", { is_correct: true, points: 1 }),
      ],
      competency_key: "learning_ability",
      id: "initial",
      points: 1,
      question_type: "single_choice",
      settings_json: {
        incorrectFeedback: "Review the rule.",
        remediationQuestionId: "recovery",
      },
    },
    {
      answer_options: [
        option("retry-wrong", { is_correct: false, points: 0 }),
        option("retry-correct", { is_correct: true, points: 1 }),
      ],
      competency_key: "learning_ability",
      id: "recovery",
      points: 1,
      question_type: "single_choice",
      settings_json: null,
    },
  ];
  const result = scoreLegacySession(session("points"), packageTest, questions, [
    answer("a-initial", "initial", { selected_option_id: "correct" }),
    answer("a-recovery", "recovery", { selected_option_id: "retry-correct" }),
  ]);

  assert.equal(result.score.rawScore, 1);
  assert.equal(result.score.maxScore, 1);
  assert.equal(result.score.percentage, 100);
  assert.deepEqual(result.answerScores.get("a-recovery"), {
    isCorrect: null,
    pointsAwarded: null,
    rawScore: null,
  });
});

test("legacy forced choice remains a profile without a manufactured overall score", () => {
  const question: LegacyQuestionRecord = {
    answer_options: [
      option("most", { competency_effect_json: { communication: 1 } }),
      option("middle", { competency_effect_json: { responsibility: 1 } }),
      option("least", { competency_effect_json: { work_behavior: 1 } }),
    ],
    competency_key: null,
    id: "forced",
    points: 0,
    question_type: "forced_choice",
    settings_json: { mode: "most_least" },
  };
  const result = scoreLegacySession(session("competency_profile"), packageTest, [question], [
    answer("a-forced", "forced", {
      answer_json: { leastOptionId: "least", mostOptionId: "most" },
    }),
  ]);

  assert.equal(result.score.hasForcedChoice, true);
  assert.equal(result.score.rawScore, 0);
  assert.equal(result.score.maxScore, 0);
  assert.equal(result.score.percentage, null);
  assert.deepEqual(result.score.competencies.get("communication"), {
    maxScore: 1,
    minScore: -1,
    score: 1,
  });
  assert.deepEqual(result.score.competencies.get("work_behavior"), {
    maxScore: 1,
    minScore: -1,
    score: -1,
  });
});
