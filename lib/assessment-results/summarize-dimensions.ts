import { ASSESSMENT_REPORT_GROUPS, type AssessmentDimensionGroup, type AssessmentDimensionResult } from "./types.ts";
import { ASSESSMENT_REPORT_GROUP_TITLES } from "./report-groups.ts";

export function summarizeAssessmentDimensions(
  dimensions: readonly AssessmentDimensionResult[],
): AssessmentDimensionGroup[] {
  return ASSESSMENT_REPORT_GROUPS.flatMap((key) => {
    const groupDimensions = dimensions
      .filter((dimension) => dimension.reportGroup === key)
      .slice()
      .sort((left, right) => {
        if (key === "motivation") {
          return (right.normalizedScore ?? -Infinity) - (left.normalizedScore ?? -Infinity) ||
            (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
            left.title.localeCompare(right.title, "ru") ||
            left.id.localeCompare(right.id);
        }
        return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER) ||
          left.title.localeCompare(right.title, "ru") ||
          left.id.localeCompare(right.id);
      });
    return groupDimensions.length > 0
      ? [{ dimensions: groupDimensions, key, title: ASSESSMENT_REPORT_GROUP_TITLES[key] }]
      : [];
  });
}
