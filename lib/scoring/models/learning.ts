import { createCoverageConfidence } from "../confidence.ts";
import { roundOutput } from "../normalization.ts";
import type {
  LearningMetrics,
  LearningScoringConfig,
  ScoreValue,
  ScoringWarning,
} from "../types.ts";

export type LearningItemInput = {
  initial: {
    answered: boolean;
    isCorrect: boolean | null;
    maxPoints: number;
    pointsAwarded: number | null;
  };
  initialQuestionId: string;
  recovery: {
    answered: boolean;
    isCorrect: boolean | null;
    maxPoints: number;
    pointsAwarded: number | null;
  } | null;
  recoveryQuestionId: string | null;
};

export type LearningScoreResult = {
  metrics: LearningMetrics;
  scores: ScoreValue[];
  warnings: ScoringWarning[];
};

/**
 * Scores remediation as a separate learning signal. Recovery questions never
 * inflate the initial-performance denominator and raw answers remain untouched.
 */
export function scoreLearning(
  config: LearningScoringConfig,
  items: readonly LearningItemInput[],
): LearningScoreResult {
  const initialMax = items.reduce((sum, item) => sum + item.initial.maxPoints, 0);
  const initialPoints = items.reduce(
    (sum, item) => sum + boundedPoints(item.initial.pointsAwarded, item.initial.maxPoints),
    0,
  );
  const initialAnswered = items.filter((item) => item.initial.answered).length;
  const initialScore = percentage(initialPoints, initialMax);

  const eligible = items.filter(
    (item) => item.recovery !== null && item.initial.isCorrect === false,
  );
  const recoveredItems = eligible.filter((item) => item.recovery?.isCorrect === true).length;
  const remediationAnsweredItems = eligible.filter((item) => item.recovery?.answered).length;
  const recoveryRate = eligible.length === 0
    ? null
    : roundOutput((recoveredItems / eligible.length) * 100);

  const postFeedbackPoints = items.reduce((sum, item) => {
    const initial = boundedPoints(item.initial.pointsAwarded, item.initial.maxPoints);
    if (item.initial.isCorrect !== false || !item.recovery) return sum + initial;
    const recoveredEquivalent = item.recovery.answered && item.recovery.maxPoints > 0
      ? (boundedPoints(item.recovery.pointsAwarded, item.recovery.maxPoints) /
          item.recovery.maxPoints) * item.initial.maxPoints
      : initial;
    return sum + Math.max(initial, recoveredEquivalent);
  }, 0);
  const postFeedbackScore = percentage(postFeedbackPoints, initialMax);
  const learningGain = initialScore === null || postFeedbackScore === null
    ? null
    : roundOutput(postFeedbackScore - initialScore);
  const finalScore = initialScore === null
    ? null
    : recoveryRate === null
      ? initialScore
      : roundOutput(
          initialScore * config.initialWeight + recoveryRate * config.recoveryWeight,
        );

  const metrics: LearningMetrics = {
    eligible_failed_items: eligible.length,
    final_score: finalScore,
    initial_score: initialScore,
    items: items.map((item) => ({
      initial_correct: item.initial.isCorrect,
      initial_points: item.initial.answered
        ? roundOutput(boundedPoints(item.initial.pointsAwarded, item.initial.maxPoints))
        : null,
      initial_question_id: item.initialQuestionId,
      recovered: item.initial.isCorrect === false && item.recovery
        ? item.recovery.answered
          ? item.recovery.isCorrect === true
          : null
        : null,
      recovery_points: item.initial.isCorrect === false && item.recovery?.answered
        ? roundOutput(boundedPoints(item.recovery.pointsAwarded, item.recovery.maxPoints))
        : null,
      recovery_question_id: item.recoveryQuestionId,
    })),
    learning_gain: learningGain,
    post_feedback_score: postFeedbackScore,
    recovered_items: recoveredItems,
    recovery_rate: recoveryRate,
    remediation_answered_items: remediationAnsweredItems,
  };

  const recoveryComplete = remediationAnsweredItems === eligible.length;
  const warnings: ScoringWarning[] = [];
  if (initialAnswered !== items.length) {
    warnings.push({
      code: "INSUFFICIENT_DATA",
      message: "One or more initial learning items were not answered.",
      scoreId: "learning_initial",
    });
  }
  if (!recoveryComplete) {
    warnings.push({
        code: "INSUFFICIENT_DATA",
        message: "One or more eligible recovery items were not answered.",
        scoreId: "learning_recovery",
    });
  }
  const recoveryScore: ScoreValue = recoveryRate === null
    ? unavailableScore("learning_recovery", "not_applicable", 0, 0)
    : {
        confidence: createCoverageConfidence(remediationAnsweredItems, eligible.length),
        id: "learning_recovery",
        norm_score: null,
        normalized_score: recoveryRate,
        raw_score: recoveredItems,
        status: "ok",
      };

  return {
    metrics,
    scores: [
      initialScore === null
        ? unavailableScore("learning_initial", "insufficient_data", initialAnswered, items.length)
        : {
            confidence: createCoverageConfidence(initialAnswered, items.length),
            id: "learning_initial",
            norm_score: null,
            normalized_score: initialScore,
            raw_score: roundOutput(initialPoints),
            status: "ok",
          },
      recoveryScore,
      finalScore === null
        ? unavailableScore("learning_final", "insufficient_data", initialAnswered, items.length)
        : {
            confidence: createCoverageConfidence(
              initialAnswered + remediationAnsweredItems,
              items.length + eligible.length,
            ),
            id: "learning_final",
            norm_score: null,
            normalized_score: finalScore,
            raw_score: finalScore,
            status: "ok",
          },
    ],
    warnings,
  };
}

function boundedPoints(value: number | null, maximum: number) {
  if (value === null || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), maximum);
}

function percentage(value: number, maximum: number) {
  return maximum > 0 ? roundOutput((value / maximum) * 100) : null;
}

function unavailableScore(
  id: string,
  status: "insufficient_data" | "not_applicable",
  answered: number,
  eligible: number,
): ScoreValue {
  return {
    confidence: createCoverageConfidence(answered, eligible),
    id,
    norm_score: null,
    normalized_score: null,
    raw_score: null,
    status,
  };
}
