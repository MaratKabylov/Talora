export const SCORING_ENGINE_VERSION = "talvia-scoring/2.0.0" as const;
export const SCORING_SCHEMA_VERSION = "2.0" as const;

export const ASSESSMENT_DOMAINS = [
  "knowledge",
  "skills",
  "personality",
  "motivation",
  "behavior",
  "learning",
  "attention",
  "sjt",
  "mixed",
  "other",
] as const;

export const RESULT_SHAPES = ["score", "profile", "hybrid"] as const;
export const SCORING_MODELS = ["criterion", "scale", "sjt", "forced_choice", "composite"] as const;
export const FORCED_CHOICE_METHODS = ["ipsative", "thurstonian_irt"] as const;
export const CRITERION_STRATEGIES = [
  "single_choice_points",
  "multiple_choice_v1",
  "scale_value",
  "ordering",
  "matching",
] as const;
export const DERIVED_CRITERION_SCORE_IDS = [
  "criterion_total",
  "learning_initial",
  "learning_recovery",
  "learning_final",
  "attention_accuracy",
  "sjt_total",
] as const;

export type AssessmentDomain = (typeof ASSESSMENT_DOMAINS)[number];
export type ResultShape = (typeof RESULT_SHAPES)[number];
export type ScoringModel = (typeof SCORING_MODELS)[number];
export type PrimaryScoringModel = Exclude<ScoringModel, "composite">;
export type ForcedChoiceMethod = (typeof FORCED_CHOICE_METHODS)[number];
export type CriterionStrategy = (typeof CRITERION_STRATEGIES)[number];

export type ScaleDefinition = {
  aggregation: "sum" | "mean";
  code: string;
  description?: string | null;
  displayOrder: number;
  id: string;
  interpretationKey?: string | null;
  minAnsweredItems?: number | null;
  minAnsweredRatio?: number | null;
  missingPolicy: "insufficient" | "prorate";
  theoreticalMax: number;
  theoreticalMin: number;
  title: string;
};

export type ScaleScoringConfig = {
  bindings: Array<{
    direction: 1 | -1;
    scaleId: string;
    weight: number;
  }>;
  responseMax: number;
  responseMin: number;
};

export type CriterionScoringConfig = {
  competencyBindings?: Array<{
    competencyId: string;
    weight: number;
  }>;
  maxPoints: number;
  minPoints?: number;
  signalClassification?: {
    targetPresent: boolean;
  };
  strategy: CriterionStrategy;
};

export type ForcedChoiceScoringConfig = {
  centering: "none" | "person_mean";
  method: ForcedChoiceMethod;
  roleWeights: {
    least: number;
    most: number;
  };
  statements: Array<{
    keyedDirection?: 1 | -1;
    scaleId: string;
    statementId: string;
  }>;
};

export type SjtScoringConfig = {
  maxPoints: number;
  minPoints: number;
  options: Array<{
    dimensionEffects: Array<{
      effect: number;
      scaleId: string;
    }>;
    optionId: string;
    points: number;
  }>;
};

export type ScoringItemDefinition =
  | {
      config: CriterionScoringConfig;
      id: string;
      questionType:
        | "single_choice"
        | "multiple_choice"
        | "scale"
        | "ordering"
        | "matching";
      scoringModel: "criterion";
    }
  | {
      config: ScaleScoringConfig;
      id: string;
      questionType: "scale";
      scoringModel: "scale";
    }
  | {
      config: SjtScoringConfig;
      id: string;
      questionType: "single_choice" | "multiple_choice";
      scoringModel: "sjt";
    }
  | {
      config: ForcedChoiceScoringConfig;
      id: string;
      questionType: "forced_choice";
      scoringModel: "forced_choice";
    }
  | {
      config: null;
      id: string;
      questionType: "open_text";
      scoringModel: null;
    };

export type CompositeInput = {
  scoreId: string;
  source: "criterion" | "scale" | "composite";
  value: "raw_score" | "normalized_score" | "norm_score";
  weight: number;
};

export type CompositeDefinition = {
  aggregation: "weighted_mean" | "sum";
  code: string;
  id: string;
  inputs: CompositeInput[];
  interpretationKey?: string | null;
  minRequiredInputs?: number;
  missingPolicy: "fail" | "renormalize";
  outputRange?: { max: number; min: number } | null;
  title: string;
};

export type NormAssignment = {
  normScaleCode: string;
  normSetId: string;
  normSetVersion: number;
  primaryMetric: "percentile" | "z" | "sten";
  scaleId: string;
};

export type OverallScoreMapping = {
  sourceId: string;
  sourceType: "criterion" | "composite";
};

export type ScoreThreshold = {
  code: string;
  label: string;
  max: number;
  min: number;
};

export type LearningScoringConfig = {
  initialWeight: number;
  recoveryWeight: number;
};

export type LearningItemResult = {
  initial_correct: boolean | null;
  initial_points: number | null;
  initial_question_id: string;
  recovered: boolean | null;
  recovery_points: number | null;
  recovery_question_id: string | null;
};

export type LearningMetrics = {
  eligible_failed_items: number;
  final_score: number | null;
  initial_score: number | null;
  learning_gain: number | null;
  post_feedback_score: number | null;
  recovered_items: number;
  recovery_rate: number | null;
  remediation_answered_items: number;
  items: LearningItemResult[];
};

export type AttentionMetrics = {
  accuracy: number | null;
  answered_count: number;
  completion_rate: number | null;
  correct_count: number;
  false_alarm_rate: number | null;
  false_negative_count: number | null;
  false_positive_count: number | null;
  hit_rate: number | null;
  incorrect_count: number;
  mean_response_time_ms: number | null;
  median_response_time_ms: number | null;
  omitted_count: number;
  speed_percentile: null;
  timed_items: number;
  total_items: number;
  true_negative_count: number | null;
  true_positive_count: number | null;
};

export type ScoringDefinitionV2 = {
  assessmentDomain: AssessmentDomain;
  composites: CompositeDefinition[];
  learningScoring?: LearningScoringConfig | null;
  normAssignments: NormAssignment[];
  overallScore?: OverallScoreMapping | null;
  resultShape: ResultShape;
  scales: ScaleDefinition[];
  schemaVersion: typeof SCORING_SCHEMA_VERSION;
  thresholds?: ScoreThreshold[];
};

export type ConfidenceInfo = {
  confidence_interval: { level: number; lower: number; upper: number } | null;
  coverage: {
    answered_items: number;
    eligible_items: number;
    ratio: number | null;
  };
  level: "low" | "medium" | "high" | "not_available";
  reliability: {
    method: "alpha" | "omega" | "test_retest" | "configured" | "not_available";
    source: string | null;
    value: number | null;
  };
  standard_error: number | null;
};

export type NormScore = {
  derived?: Array<{
    metric: "percentile" | "z" | "sten";
    value: number;
  }>;
  norm_set_id: string;
  norm_set_version: number;
  population_label: string;
  primary: {
    metric: "percentile" | "z" | "sten";
    value: number;
  };
};

export type ScoreValue = {
  confidence: ConfidenceInfo;
  id: string;
  norm_score: NormScore | null;
  normalized_score: number | null;
  raw_score: number | null;
  status: "ok" | "insufficient_data" | "not_applicable";
};

export type ScaleScoreValue = ScoreValue;

export type ForcedChoiceScoreValue = ScoreValue & {
  comparability: "within_person_only";
  method: "ipsative";
};

export type ScoringWarningCode =
  | "INSUFFICIENT_DATA"
  | "PRORATED_SCORE"
  | "NORM_NOT_APPLIED"
  | "REQUIRES_REVIEW";

export type ScoringWarning = {
  code: ScoringWarningCode;
  message: string;
  scoreId?: string;
};

export type ScoringResultV2 = {
  assessmentDomain: AssessmentDomain;
  compositeScores: ScoreValue[];
  criterionScores: ScoreValue[];
  definitionVersionId: string;
  engineVersion: string;
  forcedChoiceScores: ForcedChoiceScoreValue[];
  interpretation: ScoreThreshold | null;
  metrics: {
    attention: AttentionMetrics | null;
    learning: LearningMetrics | null;
  };
  overallScore: number | null;
  resultShape: ResultShape;
  scaleScores: ScaleScoreValue[];
  schemaVersion: typeof SCORING_SCHEMA_VERSION;
  scoredAt: string;
  status: "complete" | "partial" | "insufficient_data" | "requires_review";
  warnings: ScoringWarning[];
};

export type ScoringErrorCode =
  | "INVALID_SCORING_DEFINITION"
  | "UNSUPPORTED_SCORING_METHOD"
  | "INVALID_ANSWER_PAYLOAD"
  | "INSUFFICIENT_DATA"
  | "NORM_SET_NOT_FOUND"
  | "NORM_SCALE_NOT_FOUND"
  | "NORM_VERSION_MISMATCH"
  | "COMPOSITE_CYCLE"
  | "COMPOSITE_INPUT_MISSING"
  | "OVERALL_MAPPING_INVALID";

export class ScoringDomainError extends Error {
  readonly code: ScoringErrorCode;
  readonly path?: string;

  constructor(
    code: ScoringErrorCode,
    message: string,
    path?: string,
  ) {
    super(message);
    this.name = "ScoringDomainError";
    this.code = code;
    this.path = path;
  }
}
