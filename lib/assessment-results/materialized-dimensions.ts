import type { AssessmentDimensionResult } from "./types";

export type EmployeeMaterializedDimensionRow = {
  assessment_domain: AssessmentDimensionResult["assessmentDomain"];
  dimension_id: string;
  dimension_key: string;
  display_order: number | null;
  group_key: AssessmentDimensionResult["reportGroup"];
  interpretation_direction: AssessmentDimensionResult["interpretationDirection"];
  participant_id: string;
  percentage: number | null;
  scoring_revision: number;
  session_id: string | null;
  source_type: AssessmentDimensionResult["sourceType"];
  test_version_id: string | null;
  title: string;
};

export function materializeEmployeeDimensions(
  dimensions: readonly AssessmentDimensionResult[],
) {
  return dimensions.map((dimension) => ({
    assessment_domain: dimension.assessmentDomain,
    dimension_id: dimension.id,
    dimension_key: dimension.key,
    display_order: dimension.order,
    group_key: dimension.reportGroup,
    interpretation_direction: dimension.interpretationDirection,
    percentage: dimension.normalizedScore,
    session_id: dimension.sessionId,
    source_type: dimension.sourceType,
    test_version_id: dimension.testVersionId,
    title: dimension.testTitle
      ? `${dimension.testTitle}: ${dimension.title}`
      : dimension.title,
  }));
}

export function materializedEmployeeDimensionValue(
  row: EmployeeMaterializedDimensionRow,
) {
  return {
    domain: row.assessment_domain,
    group: row.group_key,
    value: row.percentage === null ? null : Number(row.percentage),
  };
}
