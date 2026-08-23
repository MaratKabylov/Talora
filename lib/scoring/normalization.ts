import { ScoringDomainError } from "./types.ts";

export function reverseScore(value: number, minimum: number, maximum: number) {
  assertFinite(value, "value");
  assertFinite(minimum, "minimum");
  assertFinite(maximum, "maximum");
  if (minimum >= maximum) {
    throw new ScoringDomainError(
      "INVALID_SCORING_DEFINITION",
      "Score bounds must have a positive range.",
    );
  }
  if (value < minimum || value > maximum) {
    throw new ScoringDomainError(
      "INVALID_ANSWER_PAYLOAD",
      `Score ${value} is outside the configured range ${minimum}..${maximum}.`,
    );
  }

  return minimum + maximum - value;
}

export function normalizeScore(value: number, minimum: number, maximum: number) {
  assertFinite(value, "value");
  assertFinite(minimum, "minimum");
  assertFinite(maximum, "maximum");
  if (minimum >= maximum) {
    throw new ScoringDomainError(
      "INVALID_SCORING_DEFINITION",
      "Normalization bounds must have a positive range.",
    );
  }
  if (value < minimum || value > maximum) {
    throw new ScoringDomainError(
      "INVALID_SCORING_DEFINITION",
      `Score ${value} is outside the validated theoretical range ${minimum}..${maximum}.`,
    );
  }

  return roundOutput((100 * (value - minimum)) / (maximum - minimum));
}

export function roundOutput(value: number) {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function assertFinite(value: number, label: string) {
  if (!Number.isFinite(value)) {
    throw new ScoringDomainError(
      "INVALID_SCORING_DEFINITION",
      `${label} must be a finite number.`,
    );
  }
}
