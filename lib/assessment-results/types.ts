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

export type AssessmentDimensionResult = {
  assessmentDomain: AssessmentDomain;
  interpretationDirection: "higher_better" | "lower_better" | "neutral";
  key: string;
  norm?: {
    metric: "percentile" | "z" | "sten";
    populationLabel?: string;
    value: number;
  } | null;
  normalizedScore: number | null;
  reportGroup: AssessmentReportGroup;
  resultShape: ResultShape;
  score: number | null;
  sourceType: "criterion" | "scale" | "forced_choice" | "composite" | "legacy_competency";
  thresholdStatus: "passed" | "failed" | "not_configured" | "not_applicable";
  title: string;
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
