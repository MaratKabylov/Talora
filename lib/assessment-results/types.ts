import type { AssessmentDomain, ResultShape } from "@/lib/scoring/types";

export const ASSESSMENT_REPORT_GROUPS = [
  "cognitive",
  "work_competencies",
  "behavior",
  "motivation",
  "personality",
  "knowledge_skills",
  "other",
] as const;

export type AssessmentReportGroup = (typeof ASSESSMENT_REPORT_GROUPS)[number];

export type AssessmentThreshold = {
  kind: "competency_minimum" | "test_passing_score";
  status: "passed" | "failed";
  value: number;
};

export type AssessmentValueStatus =
  | "available"
  | "insufficient_data"
  | "requires_review"
  | "not_applicable";

export type AssessmentDimensionResult = {
  assessmentDomain: AssessmentDomain;
  id: string;
  interpretation?: {
    code: string;
    label: string;
  } | null;
  interpretationDirection: "higher_better" | "lower_better" | "neutral";
  key: string;
  norm?: {
    metric: "percentile" | "z" | "sten";
    populationLabel?: string;
    value: number;
  } | null;
  normalizedScore: number | null;
  order: number | null;
  reportGroup: AssessmentReportGroup;
  resultShape: ResultShape;
  score: number | null;
  sessionId: string | null;
  sourceType: "criterion" | "scale" | "forced_choice" | "composite" | "legacy_competency";
  testTitle: string | null;
  testVersionId: string | null;
  threshold: AssessmentThreshold | null;
  thresholdStatus: "passed" | "failed" | "not_configured" | "not_applicable";
  title: string;
  valueStatus: AssessmentValueStatus;
};

export type AssessmentDimensionGroup = {
  dimensions: AssessmentDimensionResult[];
  key: AssessmentReportGroup;
  title: string;
};

export type AssessmentHighlight = {
  group: AssessmentReportGroup;
  text: string;
  title: string;
};
