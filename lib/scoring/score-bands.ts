export type ScoreBand = {
  code: string;
  max: number;
  min: number;
};

const SCORE_MIN = 0;
const SCORE_MAX = 100;
const SCORE_PRECISION = 100;

function scoreUnits(value: number) {
  return Math.round(value * SCORE_PRECISION);
}

/**
 * Validates inclusive score bands for values persisted with two decimal places.
 * Adjacent bands must therefore be exactly 0.01 apart.
 */
export function validateScoreBands(bands: readonly ScoreBand[]) {
  const errors: string[] = [];
  const codes = new Set<string>();

  if (bands.length === 0) {
    return ["At least one score band is required."];
  }

  bands.forEach((band, index) => {
    if (!Number.isFinite(band.min) || !Number.isFinite(band.max)) {
      errors.push(`Band ${index + 1} must have finite min and max values.`);
    } else if (
      band.min < SCORE_MIN ||
      band.max > SCORE_MAX ||
      band.min > band.max
    ) {
      errors.push(`Band ${index + 1} must stay within 0..100 and min must not exceed max.`);
    }

    if (codes.has(band.code)) {
      errors.push(`Duplicate score band code '${band.code}'.`);
    }
    codes.add(band.code);
  });

  const ordered = [...bands].sort((left, right) => left.min - right.min);
  if (scoreUnits(ordered[0]!.min) !== scoreUnits(SCORE_MIN)) {
    errors.push("Score bands must start at 0.");
  }
  if (scoreUnits(ordered.at(-1)!.max) !== scoreUnits(SCORE_MAX)) {
    errors.push("Score bands must end at 100.");
  }

  ordered.slice(1).forEach((band, index) => {
    const previous = ordered[index]!;
    const unitGap = scoreUnits(band.min) - scoreUnits(previous.max);
    if (unitGap <= 0) {
      errors.push("Score bands must not overlap.");
    } else if (unitGap !== 1) {
      errors.push("Score bands must cover every score rounded to two decimals.");
    }
  });

  return [...new Set(errors)];
}

export function findScoreBand<T extends ScoreBand>(
  score: number | null,
  bands: readonly T[],
): T | null {
  if (score === null || !Number.isFinite(score)) return null;
  const rounded = Math.round(Math.min(Math.max(score, SCORE_MIN), SCORE_MAX) * 100) / 100;
  return bands.find((band) => rounded >= band.min && rounded <= band.max) ?? null;
}
