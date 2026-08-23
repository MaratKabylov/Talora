import assert from "node:assert/strict";
import test from "node:test";

import type {
  LegacyAnswerRecord,
  LegacyOptionRecord,
  LegacyPackageTestRecord,
  LegacyQuestionRecord,
  LegacySessionRecord,
} from "../lib/scoring/models/legacy-session.ts";
import { scoreSession } from "../lib/scoring/session.ts";

const packageTest: LegacyPackageTestRecord = {
  is_required: true,
  passing_score: null,
  test_version_id: "version-v2",
  weight: 1,
};

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
    session_id: "session-v2",
    ...input,
  };
}

function v2Session(input: {
  assessmentDomain: "attention" | "knowledge" | "learning" | "personality" | "sjt";
  definition: Record<string, unknown>;
  resultShape: "score" | "profile" | "hybrid";
  scoringType: "points" | "competency_profile" | "mixed";
}): LegacySessionRecord {
  return {
    id: "session-v2",
    status: "completed",
    test_version_id: "version-v2",
    test_versions: {
      assessment_domain: input.assessmentDomain,
      result_shape: input.resultShape,
      scoring_config_json: { schemaVersion: "2.0", ...input.definition },
      scoring_schema_version: "2.0",
      scoring_type: input.scoringType,
      title: "V2 fixture",
    },
  };
}

test("explicit v2 marker dispatches knowledge scoring and produces a reproducible snapshot", () => {
  const questions: LegacyQuestionRecord[] = ["q1", "q2"].map((id) => ({
    answer_options: [
      option(`${id}-wrong`, { is_correct: false, order_index: 0, points: 0 }),
      option(`${id}-correct`, { is_correct: true, order_index: 1, points: 2 }),
    ],
    competency_key: "logical_reasoning",
    id,
    points: 2,
    question_type: "single_choice",
    scoring_config_json: {
      competencyBindings: [{ competencyId: "logical_reasoning", weight: 1 }],
      maxPoints: 2,
      minPoints: 0,
      strategy: "single_choice_points",
    },
    scoring_model: "criterion",
    settings_json: null,
  }));
  const result = scoreSession(
    v2Session({
      assessmentDomain: "knowledge",
      definition: {
        composites: [],
        normAssignments: [],
        overallScore: { sourceId: "criterion_total", sourceType: "criterion" },
        scales: [],
      },
      resultShape: "score",
      scoringType: "points",
    }),
    packageTest,
    questions,
    [answer("a1", "q1", { selected_option_id: "q1-correct" })],
  );

  assert.equal(result.score.rawScore, 2);
  assert.equal(result.score.maxScore, 4);
  assert.equal(result.score.percentage, 50);
  assert.equal(result.score.scoringResult?.overallScore, 50);
  assert.equal(result.score.scoringResult?.engineVersion, "talvia-scoring/2.0.0");
  assert.equal(result.score.scoringResult?.definitionVersionId, "version-v2");
  assert.equal(result.score.scoringResult?.criterionScores.at(-1)?.id, "criterion_total");
  assert.equal(
    result.score.scoringResult?.criterionScores.at(-1)?.confidence.coverage.ratio,
    0.5,
  );
});

test("v2 profile uses direct and reverse scale bindings without manufacturing overall score", () => {
  const questions: LegacyQuestionRecord[] = [
    {
      answer_options: [],
      competency_key: null,
      id: "direct",
      points: 0,
      question_type: "scale",
      scoring_config_json: {
        bindings: [{ direction: 1, scaleId: "communication", weight: 1 }],
        responseMax: 5,
        responseMin: 1,
      },
      scoring_model: "scale",
      settings_json: { max: 5, min: 1 },
    },
    {
      answer_options: [],
      competency_key: null,
      id: "reverse",
      points: 0,
      question_type: "scale",
      scoring_config_json: {
        bindings: [{ direction: -1, scaleId: "communication", weight: 1 }],
        responseMax: 5,
        responseMin: 1,
      },
      scoring_model: "scale",
      settings_json: { max: 5, min: 1 },
    },
  ];
  const result = scoreSession(
    v2Session({
      assessmentDomain: "personality",
      definition: {
        composites: [],
        normAssignments: [],
        overallScore: null,
        scales: [
          {
            aggregation: "mean",
            code: "communication",
            displayOrder: 0,
            id: "communication",
            missingPolicy: "insufficient",
            theoreticalMax: 5,
            theoreticalMin: 1,
            title: "Communication",
          },
        ],
      },
      resultShape: "profile",
      scoringType: "competency_profile",
    }),
    packageTest,
    questions,
    [
      answer("a-direct", "direct", { answer_json: { value: 5 } }),
      answer("a-reverse", "reverse", { answer_json: { value: 1 } }),
    ],
  );

  assert.equal(result.score.percentage, null);
  assert.equal(result.score.scoringResult?.overallScore, null);
  assert.equal(result.score.scoringResult?.scaleScores[0].raw_score, 5);
  assert.equal(result.score.scoringResult?.scaleScores[0].normalized_score, 100);
  assert.deepEqual(result.score.competencies.get("communication"), {
    maxScore: 5,
    minScore: 1,
    score: 5,
  });
});

test("v2 learning keeps initial and recovery performance separate", () => {
  const question = (
    id: string,
    remediationQuestionId: string | null = null,
  ): LegacyQuestionRecord => ({
    answer_options: [
      option(`${id}-wrong`, { is_correct: false, points: 0 }),
      option(`${id}-correct`, { is_correct: true, points: 1 }),
    ],
    competency_key: "learning_ability",
    id,
    points: 1,
    question_type: "single_choice",
    scoring_config_json: {
      maxPoints: 1,
      minPoints: 0,
      strategy: "single_choice_points",
    },
    scoring_model: "criterion",
    settings_json: remediationQuestionId
      ? { incorrectFeedback: "Review the rule.", remediationQuestionId }
      : null,
  });
  const result = scoreSession(
    v2Session({
      assessmentDomain: "learning",
      definition: {
        composites: [],
        learningScoring: { initialWeight: 0.4, recoveryWeight: 0.6 },
        normAssignments: [],
        overallScore: { sourceId: "learning_final", sourceType: "criterion" },
        scales: [],
      },
      resultShape: "score",
      scoringType: "points",
    }),
    packageTest,
    [question("initial", "recovery"), question("recovery"), question("initial_2")],
    [
      answer("a-initial", "initial", { selected_option_id: "initial-wrong" }),
      answer("a-recovery", "recovery", { selected_option_id: "recovery-correct" }),
      answer("a-initial-2", "initial_2", { selected_option_id: "initial_2-correct" }),
    ],
  );

  const metrics = result.score.scoringResult?.metrics.learning;
  assert.equal(metrics?.initial_score, 50);
  assert.equal(metrics?.recovery_rate, 100);
  assert.equal(metrics?.learning_gain, 50);
  assert.equal(metrics?.final_score, 80);
  assert.equal(result.score.percentage, 80);
  assert.equal(result.score.rawScore, 80);
  assert.equal(result.score.maxScore, 100);
});

test("v2 attention uses accuracy as overall and preserves observed time", () => {
  const questions: LegacyQuestionRecord[] = ["q1", "q2", "q3"].map((id) => ({
    answer_options: [
      option(`${id}-wrong`, { is_correct: false, points: 0 }),
      option(`${id}-correct`, { is_correct: true, points: 1 }),
    ],
    competency_key: "attention_to_detail",
    id,
    points: 1,
    question_type: "single_choice",
    scoring_config_json: {
      maxPoints: 1,
      minPoints: 0,
      strategy: "single_choice_points",
    },
    scoring_model: "criterion",
    settings_json: null,
  }));
  const result = scoreSession(
    v2Session({
      assessmentDomain: "attention",
      definition: {
        composites: [],
        normAssignments: [],
        overallScore: { sourceId: "attention_accuracy", sourceType: "criterion" },
        scales: [],
      },
      resultShape: "score",
      scoringType: "points",
    }),
    packageTest,
    questions,
    [
      answer("a1", "q1", { selected_option_id: "q1-correct", time_spent_seconds: 2 }),
      answer("a2", "q2", { selected_option_id: "q2-wrong", time_spent_seconds: 6 }),
    ],
  );

  const metrics = result.score.scoringResult?.metrics.attention;
  assert.equal(metrics?.accuracy, 50);
  assert.equal(metrics?.completion_rate, 66.666667);
  assert.equal(metrics?.omitted_count, 1);
  assert.equal(metrics?.mean_response_time_ms, 4_000);
  assert.equal(metrics?.speed_percentile, null);
  assert.equal(result.score.percentage, 50);
  assert.equal(result.score.scoringResult?.status, "partial");
});

test("v2 SJT produces situational overall and dimensions without correctness", () => {
  const questions: LegacyQuestionRecord[] = [{
    answer_options: [
      option("avoid", { is_correct: false, points: 0 }),
      option("coach", { is_correct: true, points: 3 }),
    ],
    competency_key: "work_behavior",
    id: "situation",
    points: 3,
    question_type: "single_choice",
    scoring_config_json: {
      maxPoints: 3,
      minPoints: 0,
      options: [
        { dimensionEffects: [], optionId: "avoid", points: 0 },
        {
          dimensionEffects: [
            { effect: 2, scaleId: "leadership" },
            { effect: 1, scaleId: "communication" },
          ],
          optionId: "coach",
          points: 3,
        },
      ],
    },
    scoring_model: "sjt",
    settings_json: null,
  }];
  const result = scoreSession(
    v2Session({
      assessmentDomain: "sjt",
      definition: {
        composites: [],
        normAssignments: [],
        overallScore: { sourceId: "sjt_total", sourceType: "criterion" },
        scales: [
          {
            aggregation: "sum",
            code: "leadership",
            displayOrder: 0,
            id: "leadership",
            missingPolicy: "insufficient",
            theoreticalMax: 2,
            theoreticalMin: 0,
            title: "Leadership",
          },
          {
            aggregation: "sum",
            code: "communication",
            displayOrder: 1,
            id: "communication",
            missingPolicy: "insufficient",
            theoreticalMax: 2,
            theoreticalMin: 0,
            title: "Communication",
          },
        ],
      },
      resultShape: "hybrid",
      scoringType: "mixed",
    }),
    packageTest,
    questions,
    [answer("sjt-answer", "situation", { selected_option_id: "coach" })],
  );

  assert.equal(result.score.percentage, 100);
  assert.equal(result.score.rawScore, 3);
  assert.equal(result.score.maxScore, 3);
  assert.equal(result.answerScores.get("sjt-answer")?.isCorrect, null);
  assert.equal(result.answerScores.get("sjt-answer")?.pointsAwarded, 3);
  assert.equal(
    result.score.scoringResult?.scaleScores.find((score) => score.id === "leadership")?.normalized_score,
    100,
  );
  assert.equal(
    result.score.scoringResult?.scaleScores.find((score) => score.id === "communication")?.normalized_score,
    50,
  );
});

test("versions without the v2 marker always stay on the frozen legacy path", () => {
  const result = scoreSession(
    {
      id: "legacy-session",
      status: "completed",
      test_version_id: "legacy-version",
      test_versions: { scoring_type: "points", title: "Legacy" },
    },
    { ...packageTest, test_version_id: "legacy-version" },
    [],
    [],
  );
  assert.equal(result.score.scoringResult, null);
  assert.equal(result.score.percentage, null);
});
