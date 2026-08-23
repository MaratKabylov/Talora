import type { ConfidenceInfo } from "./types.ts";

export function createCoverageConfidence(
  answeredItems: number,
  eligibleItems: number,
): ConfidenceInfo {
  if (
    !Number.isInteger(answeredItems) ||
    !Number.isInteger(eligibleItems) ||
    answeredItems < 0 ||
    eligibleItems < 0 ||
    answeredItems > eligibleItems
  ) {
    throw new Error("Coverage counts must be non-negative integers with answered <= eligible.");
  }

  const ratio = eligibleItems > 0 ? answeredItems / eligibleItems : null;
  const level =
    ratio === null
      ? "not_available"
      : ratio >= 0.9
        ? "high"
        : ratio >= 0.75
          ? "medium"
          : "low";

  return {
    confidence_interval: null,
    coverage: {
      answered_items: answeredItems,
      eligible_items: eligibleItems,
      ratio,
    },
    level,
    reliability: {
      method: "not_available",
      source: null,
      value: null,
    },
    standard_error: null,
  };
}
