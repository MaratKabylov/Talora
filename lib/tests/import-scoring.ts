export type ImportQuestionType =
  | "single_choice"
  | "multiple_choice"
  | "scale"
  | "open_text"
  | "forced_choice"
  | "ordering"
  | "matching";

export type ImportScoringType = "points" | "competency_profile" | "manual" | "mixed";

export function getAllowedImportScoringTypes(
  questionTypes: readonly ImportQuestionType[],
): readonly ImportScoringType[] {
  const hasSingleChoice = questionTypes.includes("single_choice");
  const hasMultipleChoice = questionTypes.includes("multiple_choice");
  const hasScale = questionTypes.includes("scale");
  const hasOpenText = questionTypes.includes("open_text");
  const hasForcedChoice = questionTypes.includes("forced_choice");
  const hasPointQuestion =
    hasSingleChoice || hasMultipleChoice || questionTypes.includes("ordering") || questionTypes.includes("matching");

  if (hasOpenText) {
    return hasPointQuestion || hasScale || hasForcedChoice
      ? ["mixed"]
      : ["manual"];
  }
  if (hasForcedChoice && hasPointQuestion) return ["mixed"];
  if (hasScale || hasForcedChoice) return ["competency_profile"];
  return ["points", "competency_profile"];
}
