import { z } from "zod";

import {
  ASSESSMENT_DOMAINS,
  RESULT_SHAPES,
  SCORING_SCHEMA_VERSION,
  type ScoringResultV2,
} from "./types.ts";

const metricSchema = z.enum(["percentile", "z", "sten"]);

const normScoreSchema = z
  .object({
    derived: z
      .array(
        z
          .object({ metric: metricSchema, value: z.number().finite() })
          .strict(),
      )
      .optional(),
    norm_set_id: z.string().min(1),
    norm_set_version: z.number().int().min(1),
    population_label: z.string().trim().min(1).max(240),
    primary: z
      .object({ metric: metricSchema, value: z.number().finite() })
      .strict(),
  })
  .strict();

const confidenceSchema = z
  .object({
    confidence_interval: z
      .object({
        level: z.number().finite().gt(0).lt(1),
        lower: z.number().finite(),
        upper: z.number().finite(),
      })
      .strict()
      .nullable(),
    coverage: z
      .object({
        answered_items: z.number().int().min(0),
        eligible_items: z.number().int().min(0),
        ratio: z.number().finite().min(0).max(1).nullable(),
      })
      .strict()
      .superRefine((coverage, context) => {
        if (coverage.answered_items > coverage.eligible_items) {
          context.addIssue({
            code: "custom",
            message: "answered_items cannot exceed eligible_items.",
            path: ["answered_items"],
          });
        }
        const expected =
          coverage.eligible_items > 0
            ? coverage.answered_items / coverage.eligible_items
            : null;
        if (
          (expected === null && coverage.ratio !== null) ||
          (expected !== null &&
            (coverage.ratio === null || Math.abs(coverage.ratio - expected) > 1e-9))
        ) {
          context.addIssue({
            code: "custom",
            message: "coverage.ratio must match answered_items / eligible_items.",
            path: ["ratio"],
          });
        }
      }),
    level: z.enum(["low", "medium", "high", "not_available"]),
    reliability: z
      .object({
        method: z.enum(["alpha", "omega", "test_retest", "configured", "not_available"]),
        source: z.string().min(1).nullable(),
        value: z.number().finite().min(0).max(1).nullable(),
      })
      .strict(),
    standard_error: z.number().finite().min(0).nullable(),
  })
  .strict();

const scoreValueSchema = z
  .object({
    confidence: confidenceSchema,
    id: z.string().min(1),
    norm_score: normScoreSchema.nullable(),
    normalized_score: z.number().finite().min(0).max(100).nullable(),
    raw_score: z.number().finite().nullable(),
    status: z.enum(["ok", "insufficient_data", "not_applicable"]),
  })
  .strict()
  .superRefine((score, context) => {
    if (
      score.status !== "ok" &&
      (score.raw_score !== null ||
        score.normalized_score !== null ||
        score.norm_score !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Non-ok scores cannot contain numeric score values.",
      });
    }
  });

const forcedChoiceScoreSchema = scoreValueSchema.safeExtend({
  comparability: z.literal("within_person_only"),
  method: z.literal("ipsative"),
  norm_score: z.null(),
});

const scoreThresholdSchema = z
  .object({
    code: z.string().min(1),
    label: z.string().min(1),
    max: z.number().finite().min(0).max(100),
    min: z.number().finite().min(0).max(100),
  })
  .strict();

export const scoringResultV2Schema = z
  .object({
    assessmentDomain: z.enum(ASSESSMENT_DOMAINS),
    compositeScores: z.array(scoreValueSchema),
    criterionScores: z.array(scoreValueSchema),
    definitionVersionId: z.string().min(1),
    engineVersion: z.string().min(1),
    forcedChoiceScores: z.array(forcedChoiceScoreSchema),
    interpretation: scoreThresholdSchema.nullable().optional().default(null),
    overallScore: z.number().finite().min(0).max(100).nullable(),
    resultShape: z.enum(RESULT_SHAPES),
    scaleScores: z.array(scoreValueSchema),
    schemaVersion: z.literal(SCORING_SCHEMA_VERSION),
    scoredAt: z.string().datetime({ offset: true }),
    status: z.enum(["complete", "partial", "insufficient_data", "requires_review"]),
    warnings: z.array(
      z
        .object({
          code: z.enum([
            "INSUFFICIENT_DATA",
            "PRORATED_SCORE",
            "NORM_NOT_APPLIED",
            "REQUIRES_REVIEW",
          ]),
          message: z.string().min(1).max(2_000),
          scoreId: z.string().min(1).optional(),
        })
        .strict(),
    ),
  })
  .strict();

export function parseScoringResultV2(value: unknown): ScoringResultV2 {
  return scoringResultV2Schema.parse(value) as ScoringResultV2;
}
