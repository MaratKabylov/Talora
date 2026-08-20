export type ImportQuestionType =
  | "single_choice"
  | "scale"
  | "open_text"
  | "forced_choice";

export type ImportScoringType = "points" | "competency_profile" | "manual" | "mixed";

export function getAllowedImportScoringTypes(
  questionTypes: readonly ImportQuestionType[],
): readonly ImportScoringType[] {
  const hasSingleChoice = questionTypes.includes("single_choice");
  const hasScale = questionTypes.includes("scale");
  const hasOpenText = questionTypes.includes("open_text");
  const hasForcedChoice = questionTypes.includes("forced_choice");

  if (hasOpenText) {
    return hasSingleChoice || hasScale || hasForcedChoice
      ? ["mixed"]
      : ["manual"];
  }
  if (hasForcedChoice && hasSingleChoice) return ["mixed"];
  if (hasScale || hasForcedChoice) return ["competency_profile"];
  return ["points", "competency_profile"];
}
