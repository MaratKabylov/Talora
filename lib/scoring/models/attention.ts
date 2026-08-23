import { createCoverageConfidence } from "../confidence.ts";
import { roundOutput } from "../normalization.ts";
import type {
  AttentionMetrics,
  ScoreValue,
  ScoringWarning,
} from "../types.ts";

export type AttentionItemInput = {
  answered: boolean;
  isCorrect: boolean | null;
  itemId: string;
  timeSpentSeconds: number | null;
};

export type AttentionScoreResult = {
  metrics: AttentionMetrics;
  scores: ScoreValue[];
  warnings: ScoringWarning[];
};

/** Captures observable accuracy and time. Time is never converted into a score. */
export function scoreAttention(
  items: readonly AttentionItemInput[],
): AttentionScoreResult {
  const answered = items.filter((item) => item.answered);
  const correctCount = answered.filter((item) => item.isCorrect === true).length;
  const incorrectCount = answered.length - correctCount;
  const omittedCount = items.length - answered.length;
  const accuracy = answered.length > 0
    ? roundOutput((correctCount / answered.length) * 100)
    : null;
  const completionRate = items.length > 0
    ? roundOutput((answered.length / items.length) * 100)
    : null;
  const responseTimesMs = answered.flatMap((item) =>
    typeof item.timeSpentSeconds === "number" &&
    Number.isFinite(item.timeSpentSeconds) &&
    item.timeSpentSeconds >= 0
      ? [item.timeSpentSeconds * 1_000]
      : [],
  );

  const metrics: AttentionMetrics = {
    accuracy,
    answered_count: answered.length,
    completion_rate: completionRate,
    correct_count: correctCount,
    false_negative_count: null,
    false_positive_count: null,
    incorrect_count: incorrectCount,
    mean_response_time_ms: mean(responseTimesMs),
    median_response_time_ms: median(responseTimesMs),
    omitted_count: omittedCount,
    speed_percentile: null,
    timed_items: responseTimesMs.length,
    total_items: items.length,
  };
  const warnings: ScoringWarning[] = [];
  if (omittedCount > 0) {
    warnings.push({
      code: "INSUFFICIENT_DATA",
      message: "Attention accuracy excludes omitted items; completion is reported separately.",
      scoreId: "attention_accuracy",
    });
  }

  const score: ScoreValue = accuracy === null
    ? {
        confidence: createCoverageConfidence(0, items.length),
        id: "attention_accuracy",
        norm_score: null,
        normalized_score: null,
        raw_score: null,
        status: "insufficient_data",
      }
    : {
        confidence: createCoverageConfidence(answered.length, items.length),
        id: "attention_accuracy",
        norm_score: null,
        normalized_score: accuracy,
        raw_score: correctCount,
        status: "ok",
      };

  return { metrics, scores: [score], warnings };
}

function mean(values: readonly number[]) {
  if (values.length === 0) return null;
  return roundOutput(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function median(values: readonly number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? roundOutput(sorted[middle])
    : roundOutput((sorted[middle - 1] + sorted[middle]) / 2);
}
