import type { LegacyDimensionInput } from "./collect-dimensions";

type MergeLegacyInputs = {
  linkedRows?: readonly LegacyDimensionInput[];
  summaryRows?: readonly LegacyDimensionInput[];
  unlinkedRows?: readonly LegacyDimensionInput[];
};

type LegacyLearningFallbackInput = {
  category: string | null | undefined;
  existingRows: readonly LegacyDimensionInput[];
  maxScore?: number | null;
  minimumScore?: number | null;
  percentage: number | null | undefined;
  score?: number | null;
  sessionId: string;
  testTitle?: string | null;
  testVersionId: string;
};

export function buildLegacyLearningFallback({
  category,
  existingRows,
  maxScore,
  minimumScore,
  percentage,
  score,
  sessionId,
  testTitle,
  testVersionId,
}: LegacyLearningFallbackInput): LegacyDimensionInput | null {
  if (
    category !== "learning_ability" ||
    typeof percentage !== "number" ||
    !Number.isFinite(percentage) ||
    existingRows.some((row) => row.key === "learning_ability" && row.sessionId === sessionId)
  ) {
    return null;
  }

  return {
    isBelowMinimum: false,
    key: "learning_ability",
    maxScore: maxScore ?? null,
    minimumScore: minimumScore ?? null,
    percentage,
    score: score ?? null,
    sessionId,
    testTitle: testTitle ?? null,
    testVersionId,
  };
}

function mergeDirection(
  row: LegacyDimensionInput,
  summary: LegacyDimensionInput | undefined,
) {
  const directions = new Set(
    [row.interpretationDirection, summary?.interpretationDirection].filter(Boolean),
  );
  if (
    directions.has("neutral") ||
    directions.has("target_range") ||
    (directions.has("higher_is_better") && directions.has("lower_is_better"))
  ) {
    return "neutral" as const;
  }
  return row.interpretationDirection ?? summary?.interpretationDirection ?? null;
}

/**
 * Keeps every detailed legacy row, including rows whose result/session is missing.
 * Summary rows fill missing competency keys and provide aggregate fallbacks without
 * duplicating dimensions that already have detailed input.
 */
export function mergeLegacyPresentationInputs({
  linkedRows = [],
  summaryRows = [],
  unlinkedRows = [],
}: MergeLegacyInputs): LegacyDimensionInput[] {
  const summariesByKey = new Map<string, LegacyDimensionInput>();
  for (const summary of summaryRows) {
    if (!summariesByKey.has(summary.key)) summariesByKey.set(summary.key, summary);
  }

  const detailedRows = [...linkedRows, ...unlinkedRows].map((row) => {
    const summary = summariesByKey.get(row.key);
    return {
      ...row,
      interpretationDirection: mergeDirection(row, summary),
      minimumScore: row.minimumScore ?? summary?.minimumScore ?? null,
      summaryPercentage: summary?.percentage ?? null,
    };
  });
  const detailedKeys = new Set(detailedRows.map((row) => row.key));

  return [
    ...detailedRows,
    ...summaryRows
      .filter((summary) => !detailedKeys.has(summary.key))
      .map((summary) => ({ ...summary, summaryPercentage: summary.percentage })),
  ];
}
