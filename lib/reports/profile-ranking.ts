export type RankedProfileValue<T> = {
  rank: number | null;
  value: T;
};

/**
 * Assigns competition ranks to values that are already ordered from highest to lowest.
 * Equal numeric values receive the same rank and the next rank skips the tied positions.
 */
export function assignCompetitionRanks<T>(
  values: readonly T[],
  scoreOf: (value: T) => number | null,
): RankedProfileValue<T>[] {
  let previousScore: number | null = null;
  let previousRank: number | null = null;

  return values.map((value, index) => {
    const score = scoreOf(value);
    const rank = score === null
      ? null
      : previousScore !== null && score === previousScore
        ? previousRank
        : index + 1;

    if (score !== null) {
      previousScore = score;
      previousRank = rank;
    }

    return { rank, value };
  });
}
