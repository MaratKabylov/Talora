import type { ScoreThreshold } from "./types.ts";

export const LEGACY_SCORE_THRESHOLDS: readonly ScoreThreshold[] = [
  { code: "below_expectations", label: "Ниже ожиданий", min: 0, max: 64.99 },
  { code: "meets_expectations", label: "Соответствует ожиданиям", min: 65, max: 84.99 },
  { code: "strong", label: "Высокий результат", min: 85, max: 100 },
];

/** Scores persisted by the engine are rounded to two decimal places. */
export function interpretScore(
  score: number | null,
  thresholds?: readonly ScoreThreshold[] | null,
): ScoreThreshold | null {
  if (score === null || !Number.isFinite(score)) return null;
  const configured = thresholds && thresholds.length > 0
    ? thresholds
    : LEGACY_SCORE_THRESHOLDS;
  const rounded = Math.round(Math.min(Math.max(score, 0), 100) * 100) / 100;
  return configured.find((threshold) => (
    rounded >= threshold.min && rounded <= threshold.max
  )) ?? null;
}
