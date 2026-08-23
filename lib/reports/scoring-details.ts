import { scoringResultV2Schema } from "../scoring/result.ts";
import type {
  AssessmentDomain,
  AttentionMetrics,
  LearningMetrics,
  ResultShape,
  ScoringResultV2,
} from "../scoring/types.ts";

export type ReportScoringDetails = {
  assessmentDomain: AssessmentDomain;
  attention: AttentionMetrics | null;
  dimensions: Array<{
    answeredItems: number;
    eligibleItems: number;
    id: string;
    normalizedScore: number | null;
    rawScore: number | null;
    status: "ok" | "insufficient_data" | "not_applicable";
  }>;
  interpretation: ScoringResultV2["interpretation"];
  learning: LearningMetrics | null;
  overallScore: number | null;
  resultShape: ResultShape;
  status: ScoringResultV2["status"];
};

export function buildReportScoringDetails(value: unknown): ReportScoringDetails | null {
  const parsed = scoringResultV2Schema.safeParse(value);
  if (!parsed.success) return null;

  return {
    assessmentDomain: parsed.data.assessmentDomain,
    attention: parsed.data.metrics.attention,
    dimensions: parsed.data.scaleScores.map((dimension) => ({
      answeredItems: dimension.confidence.coverage.answered_items,
      eligibleItems: dimension.confidence.coverage.eligible_items,
      id: dimension.id,
      normalizedScore: dimension.normalized_score,
      rawScore: dimension.raw_score,
      status: dimension.status,
    })),
    interpretation: parsed.data.interpretation,
    learning: parsed.data.metrics.learning,
    overallScore: parsed.data.overallScore,
    resultShape: parsed.data.resultShape,
    status: parsed.data.status,
  };
}
