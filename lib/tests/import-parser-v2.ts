import "server-only";

import { z } from "zod";

import { validateScoringDefinitionV2 } from "@/lib/scoring/definition";
import {
  ASSESSMENT_DOMAINS,
  CRITERION_STRATEGIES,
  DERIVED_CRITERION_SCORE_IDS,
  FORCED_CHOICE_METHODS,
  RESULT_SHAPES,
  type ScoringDefinitionV2,
  type ScoringItemDefinition,
} from "@/lib/scoring/types";
import {
  JsonDocumentError,
  formatImportValidationError,
  parseStrictJsonDocument,
  parseTalviaTestImport,
  talviaTestImportDocumentSchema,
  type TalviaTestImportDocument,
} from "@/lib/tests/import-parser";
import type { TalviaTestImportSummary } from "@/lib/tests/import-types";
import { summarizeTalviaTestImport } from "@/lib/tests/import-parser";

const stableKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z][a-z0-9_.-]*$/i, "Use a stable machine-readable key.");
const positiveWeightSchema = z.number().finite().gt(0);
const nullableTextSchema = z.string().trim().min(1).max(4_000).nullable().optional();

const dimensionSchema = z
  .object({
    aggregation: z.enum(["sum", "mean"]),
    description: nullableTextSchema,
    interpretation_key: stableKeySchema.nullable().optional(),
    key: stableKeySchema,
    min_answered_items: z.number().int().min(1).nullable().optional(),
    min_answered_ratio: z.number().finite().gt(0).max(1).nullable().optional(),
    missing_policy: z.enum(["insufficient", "prorate"]),
    order: z.number().int().min(0),
    theoretical_max: z.number().finite(),
    theoretical_min: z.number().finite(),
    title: z.string().trim().min(1).max(240),
  })
  .strict()
  .superRefine((dimension, context) => {
    if (dimension.theoretical_min >= dimension.theoretical_max) {
      context.addIssue({
        code: "custom",
        message: "theoretical_max must be greater than theoretical_min.",
        path: ["theoretical_max"],
      });
    }
  });

const criterionItemSchema = z
  .object({
    competency_bindings: z
      .array(
        z
          .object({ competency_key: stableKeySchema, weight: positiveWeightSchema })
          .strict(),
      )
      .optional()
      .default([]),
    max_points: z.number().finite(),
    min_points: z.number().finite().optional().default(0),
    question_key: stableKeySchema,
    scoring_model: z.literal("criterion"),
    strategy: z.enum(CRITERION_STRATEGIES),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.min_points >= item.max_points) {
      context.addIssue({
        code: "custom",
        message: "max_points must be greater than min_points.",
        path: ["max_points"],
      });
    }
  });

const scaleItemSchema = z
  .object({
    dimension_effects: z
      .array(
        z
          .object({
            dimension_key: stableKeySchema,
            item_weight: positiveWeightSchema.optional().default(1),
            reverse_scored: z.boolean().optional().default(false),
          })
          .strict(),
      )
      .min(1),
    question_key: stableKeySchema,
    response_max: z.number().finite(),
    response_min: z.number().finite(),
    scoring_model: z.literal("scale"),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.response_min >= item.response_max) {
      context.addIssue({
        code: "custom",
        message: "response_max must be greater than response_min.",
        path: ["response_max"],
      });
    }
  });

const forcedChoiceItemSchema = z
  .object({
    centering: z.enum(["none", "person_mean"]),
    method: z.enum(FORCED_CHOICE_METHODS),
    question_key: stableKeySchema,
    role_weights: z
      .object({ least: z.number().finite(), most: z.number().finite() })
      .strict(),
    scoring_model: z.literal("forced_choice"),
    statements: z
      .array(
        z
          .object({
            dimension_key: stableKeySchema,
            keyed_direction: z.union([z.literal(1), z.literal(-1)]).optional().default(1),
            option_key: stableKeySchema,
          })
          .strict(),
      )
      .min(2),
  })
  .strict();

const sjtItemSchema = z
  .object({
    max_points: z.number().finite(),
    min_points: z.number().finite(),
    options: z.array(z.object({
      dimension_effects: z.array(z.object({
        dimension_key: stableKeySchema,
        effect: z.number().finite(),
      }).strict()),
      option_key: stableKeySchema,
      points: z.number().finite(),
    }).strict()).min(2),
    question_key: stableKeySchema,
    scoring_model: z.literal("sjt"),
  })
  .strict()
  .superRefine((item, context) => {
    if (item.min_points >= item.max_points) {
      context.addIssue({
        code: "custom",
        message: "max_points must be greater than min_points.",
        path: ["max_points"],
      });
    }
  });

const scoringItemSchema = z.discriminatedUnion("scoring_model", [
  criterionItemSchema,
  scaleItemSchema,
  sjtItemSchema,
  forcedChoiceItemSchema,
]);

const compositeSchema = z
  .object({
    aggregation: z.enum(["weighted_mean", "sum"]),
    inputs: z
      .array(
        z
          .object({
            score_key: stableKeySchema,
            source: z.enum(["criterion", "scale", "composite"]),
            value: z.enum(["raw_score", "normalized_score", "norm_score"]),
            weight: positiveWeightSchema,
          })
          .strict(),
      )
      .min(1),
    interpretation_key: stableKeySchema.nullable().optional(),
    key: stableKeySchema,
    min_required_inputs: z.number().int().min(1).optional(),
    missing_policy: z.enum(["fail", "renormalize"]),
    output_range: z
      .object({ max: z.number().finite(), min: z.number().finite() })
      .strict()
      .nullable()
      .optional(),
    title: z.string().trim().min(1).max(240),
  })
  .strict();

const normAssignmentSchema = z
  .object({
    dimension_key: stableKeySchema,
    norm_scale_code: stableKeySchema,
    norm_set_id: z.string().uuid(),
    norm_set_version: z.number().int().min(1),
    primary_metric: z.enum(["percentile", "z", "sten"]),
  })
  .strict();

const thresholdSchema = z
  .object({
    code: stableKeySchema,
    label: z.string().trim().min(1).max(240),
    max: z.number().finite().min(0).max(100),
    min: z.number().finite().min(0).max(100),
  })
  .strict();

const learningScoringSchema = z
  .object({
    initial_weight: z.number().finite().min(0).max(1),
    recovery_weight: z.number().finite().min(0).max(1),
  })
  .strict()
  .superRefine((config, context) => {
    if (Math.abs(config.initial_weight + config.recovery_weight - 1) > 1e-9) {
      context.addIssue({
        code: "custom",
        message: "initial_weight and recovery_weight must sum to 1.",
        path: ["recovery_weight"],
      });
    }
  });

const scoringSchema = z
  .object({
    assessment_domain: z.enum(ASSESSMENT_DOMAINS),
    composites: z.array(compositeSchema).optional().default([]),
    dimensions: z.array(dimensionSchema).max(200).optional().default([]),
    items: z.array(scoringItemSchema).max(300),
    learning_scoring: learningScoringSchema.nullable().optional().default(null),
    norm_assignments: z.array(normAssignmentSchema).optional().default([]),
    overall_score: z
      .object({
        source_key: stableKeySchema,
        source_type: z.enum(["criterion", "composite"]),
      })
      .strict()
      .nullable()
      .optional()
      .default(null),
    result_shape: z.enum(RESULT_SHAPES),
    scoring_version: z.literal("2.0"),
    thresholds: z.array(thresholdSchema).optional().default([]),
  })
  .strict()
  .superRefine((scoring, context) => {
    if (scoring.assessment_domain === "learning" && !scoring.learning_scoring) {
      context.addIssue({
        code: "custom",
        message: "learning_scoring is required for the learning domain.",
        path: ["learning_scoring"],
      });
    }
    if (scoring.assessment_domain !== "learning" && scoring.learning_scoring) {
      context.addIssue({
        code: "custom",
        message: "learning_scoring is only valid for the learning domain.",
        path: ["learning_scoring"],
      });
    }
  });

const v2EnvelopeSchema = z
  .object({
    schema_version: z.literal("talvia.test.v2"),
    scoring: scoringSchema,
    test: z.unknown(),
  })
  .strict();

export type TalviaTestImportDocumentV2 = {
  schema_version: "talvia.test.v2";
  scoring: z.infer<typeof scoringSchema>;
  test: TalviaTestImportDocument["test"];
};

export type TalviaTestImportAnyDocument =
  | TalviaTestImportDocument
  | TalviaTestImportDocumentV2;

export function parseTalviaTestImportV2(source: string): TalviaTestImportDocumentV2 {
  const raw = parseStrictJsonDocument(source);
  const envelope = v2EnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    throw new JsonDocumentError(formatImportValidationError(envelope.error));
  }

  let legacy: TalviaTestImportDocument;
  try {
    legacy = parseTalviaTestImport(JSON.stringify({
      schema_version: "talvia.test.v1",
      test: envelope.data.test,
    }));
  } catch (error) {
    throw new JsonDocumentError(
      error instanceof Error ? error.message : "Invalid test content in talvia.test.v2.",
    );
  }

  const document: TalviaTestImportDocumentV2 = {
    schema_version: "talvia.test.v2",
    scoring: envelope.data.scoring,
    test: legacy.test,
  };
  validateV2CrossReferences(document);
  return document;
}

export function parseTalviaTestImportAny(source: string): TalviaTestImportAnyDocument {
  const raw = parseStrictJsonDocument(source);
  if (
    typeof raw === "object" &&
    raw !== null &&
    "schema_version" in raw &&
    raw.schema_version === "talvia.test.v2"
  ) {
    return parseTalviaTestImportV2(source);
  }
  return parseTalviaTestImport(source);
}

export function buildScoringDefinitionFromImportV2(
  document: TalviaTestImportDocumentV2,
): ScoringDefinitionV2 {
  return {
    assessmentDomain: document.scoring.assessment_domain,
    composites: document.scoring.composites.map((composite) => ({
      aggregation: composite.aggregation,
      code: composite.key,
      id: composite.key,
      inputs: composite.inputs.map((input) => ({
        scoreId: input.score_key,
        source: input.source,
        value: input.value,
        weight: input.weight,
      })),
      interpretationKey: composite.interpretation_key,
      minRequiredInputs: composite.min_required_inputs,
      missingPolicy: composite.missing_policy,
      outputRange: composite.output_range,
      title: composite.title,
    })),
    learningScoring: document.scoring.learning_scoring
      ? {
          initialWeight: document.scoring.learning_scoring.initial_weight,
          recoveryWeight: document.scoring.learning_scoring.recovery_weight,
        }
      : null,
    normAssignments: document.scoring.norm_assignments.map((assignment) => ({
      normScaleCode: assignment.norm_scale_code,
      normSetId: assignment.norm_set_id,
      normSetVersion: assignment.norm_set_version,
      primaryMetric: assignment.primary_metric,
      scaleId: assignment.dimension_key,
    })),
    overallScore: document.scoring.overall_score
      ? {
          sourceId: document.scoring.overall_score.source_key,
          sourceType: document.scoring.overall_score.source_type,
        }
      : null,
    resultShape: document.scoring.result_shape,
    scales: document.scoring.dimensions.map((dimension) => ({
      aggregation: dimension.aggregation,
      code: dimension.key,
      description: dimension.description,
      displayOrder: dimension.order,
      id: dimension.key,
      interpretationKey: dimension.interpretation_key,
      minAnsweredItems: dimension.min_answered_items,
      minAnsweredRatio: dimension.min_answered_ratio,
      missingPolicy: dimension.missing_policy,
      theoreticalMax: dimension.theoretical_max,
      theoreticalMin: dimension.theoretical_min,
      title: dimension.title,
    })),
    schemaVersion: "2.0",
    thresholds: document.scoring.thresholds,
  };
}

export function buildScoringItemsFromImportV2(
  document: TalviaTestImportDocumentV2,
): ScoringItemDefinition[] {
  const questionTypeByKey = new Map(
    document.test.sections.flatMap((section) =>
      section.questions.map((question) => [question.key, question.type] as const),
    ),
  );
  return document.scoring.items.map((item): ScoringItemDefinition => {
    const questionType = questionTypeByKey.get(item.question_key);
    if (!questionType) {
      throw new JsonDocumentError(`Unknown scoring question_key '${item.question_key}'.`);
    }
    if (item.scoring_model === "criterion") {
      return {
        config: {
          competencyBindings: item.competency_bindings.map((binding) => ({
            competencyId: binding.competency_key,
            weight: binding.weight,
          })),
          maxPoints: item.max_points,
          minPoints: item.min_points,
          strategy: item.strategy,
        },
        id: item.question_key,
        questionType: questionType as Extract<ScoringItemDefinition, { scoringModel: "criterion" }>["questionType"],
        scoringModel: "criterion",
      };
    }
    if (item.scoring_model === "scale") {
      return {
        config: {
          bindings: item.dimension_effects.map((effect) => ({
            direction: effect.reverse_scored ? -1 : 1,
            scaleId: effect.dimension_key,
            weight: effect.item_weight,
          })),
          responseMax: item.response_max,
          responseMin: item.response_min,
        },
        id: item.question_key,
        questionType: "scale",
        scoringModel: "scale",
      };
    }
    if (item.scoring_model === "sjt") {
      return {
        config: {
          maxPoints: item.max_points,
          minPoints: item.min_points,
          options: item.options.map((option) => ({
            dimensionEffects: option.dimension_effects.map((effect) => ({
              effect: effect.effect,
              scaleId: effect.dimension_key,
            })),
            optionId: option.option_key,
            points: option.points,
          })),
        },
        id: item.question_key,
        questionType: questionType as "single_choice" | "multiple_choice",
        scoringModel: "sjt",
      };
    }
    return {
      config: {
        centering: item.centering,
        method: item.method,
        roleWeights: item.role_weights,
        statements: item.statements.map((statement) => ({
          keyedDirection: statement.keyed_direction,
          scaleId: statement.dimension_key,
          statementId: statement.option_key,
        })),
      },
      id: item.question_key,
      questionType: "forced_choice",
      scoringModel: "forced_choice",
    };
  });
}

export function summarizeTalviaTestImportAny(
  document: TalviaTestImportAnyDocument,
): TalviaTestImportSummary {
  const legacy = document.schema_version === "talvia.test.v1"
    ? document
    : { schema_version: "talvia.test.v1" as const, test: document.test };
  return {
    ...summarizeTalviaTestImport(legacy),
    schemaVersion: document.schema_version,
  };
}

function validateV2CrossReferences(document: TalviaTestImportDocumentV2) {
  const questions = document.test.sections.flatMap((section) => section.questions);
  const questionByKey = new Map(questions.map((question) => [question.key, question]));
  const itemsByQuestion = new Map<string, number>();
  for (const item of document.scoring.items) {
    itemsByQuestion.set(item.question_key, (itemsByQuestion.get(item.question_key) ?? 0) + 1);
    const question = questionByKey.get(item.question_key);
    if (!question) {
      throw new JsonDocumentError(`scoring.items references unknown question '${item.question_key}'.`);
    }
    const compatible =
      (item.scoring_model === "criterion" &&
        ["single_choice", "multiple_choice", "scale", "ordering", "matching"].includes(question.type)) ||
      (item.scoring_model === "scale" && question.type === "scale") ||
      (item.scoring_model === "sjt" && ["single_choice", "multiple_choice"].includes(question.type)) ||
      (item.scoring_model === "forced_choice" && question.type === "forced_choice");
    if (!compatible) {
      throw new JsonDocumentError(
        `Scoring model '${item.scoring_model}' is incompatible with question '${item.question_key}' (${question.type}).`,
      );
    }
    if (item.scoring_model === "forced_choice") {
      const optionKeys = new Set(question.type === "forced_choice"
        ? question.options.map((option) => option.key)
        : []);
      const statementKeys = item.statements.map((statement) => statement.option_key);
      if (
        statementKeys.length !== optionKeys.size ||
        new Set(statementKeys).size !== statementKeys.length ||
        statementKeys.some((key) => !optionKeys.has(key))
      ) {
        throw new JsonDocumentError(
          `Forced-choice scoring for '${item.question_key}' must map every option exactly once.`,
        );
      }
    }
    if (item.scoring_model === "sjt") {
      const optionKeys = new Set(
        question.type === "single_choice" || question.type === "multiple_choice"
          ? question.options.map((option) => option.key)
          : [],
      );
      const configuredKeys = item.options.map((option) => option.option_key);
      if (
        configuredKeys.length !== optionKeys.size ||
        new Set(configuredKeys).size !== configuredKeys.length ||
        configuredKeys.some((key) => !optionKeys.has(key))
      ) {
        throw new JsonDocumentError(
          `SJT scoring for '${item.question_key}' must map every option exactly once.`,
        );
      }
    }
  }
  for (const question of questions) {
    const count = itemsByQuestion.get(question.key) ?? 0;
    if (question.type === "open_text" ? count !== 0 : count !== 1) {
      throw new JsonDocumentError(
        question.type === "open_text"
          ? `Open-text question '${question.key}' cannot have automatic scoring.`
          : `Question '${question.key}' must have exactly one scoring item.`,
      );
    }
  }

  const expectedScoringType = document.scoring.result_shape === "profile"
    ? "competency_profile"
    : document.scoring.result_shape === "hybrid"
      ? "mixed"
      : "points";
  if (document.test.scoring_type !== expectedScoringType) {
    throw new JsonDocumentError(
      `test.scoring_type must be '${expectedScoringType}' for result_shape '${document.scoring.result_shape}'.`,
    );
  }
  for (const composite of document.scoring.composites) {
    if (
      composite.inputs.some(
        (input) =>
          input.source === "criterion" &&
          !DERIVED_CRITERION_SCORE_IDS.includes(
            input.score_key as (typeof DERIVED_CRITERION_SCORE_IDS)[number],
          ),
      )
    ) {
      throw new JsonDocumentError(
        "Imported composites may reference derived criterion totals, dimensions, or other composites; per-question criterion IDs are assigned by the database.",
      );
    }
  }
  if (
    document.scoring.overall_score?.source_type === "criterion" &&
      !DERIVED_CRITERION_SCORE_IDS.includes(
        document.scoring.overall_score.source_key as (typeof DERIVED_CRITERION_SCORE_IDS)[number],
      )
  ) {
    throw new JsonDocumentError("Criterion overall_score must reference a supported derived criterion score.");
  }

  if (document.scoring.assessment_domain === "learning") {
    const remediationParents = questions.filter(
      (question) =>
        question.type === "single_choice" && Boolean(question.remediation_question_key),
    );
    if (remediationParents.length === 0) {
      throw new JsonDocumentError(
        "A learning assessment must contain at least one single_choice remediation link.",
      );
    }
    if (
      document.scoring.overall_score?.source_type !== "criterion" ||
      document.scoring.overall_score.source_key !== "learning_final"
    ) {
      throw new JsonDocumentError(
        "A learning assessment overall_score must reference criterion 'learning_final'.",
      );
    }
    if (
      document.scoring.items.some(
        (item) => item.scoring_model !== "criterion" || item.min_points !== 0,
      )
    ) {
      throw new JsonDocumentError(
        "Learning assessments currently require criterion items with min_points equal to 0.",
      );
    }
  }
  if (document.scoring.assessment_domain === "attention") {
    if (
      document.scoring.overall_score?.source_type !== "criterion" ||
      document.scoring.overall_score.source_key !== "attention_accuracy"
    ) {
      throw new JsonDocumentError(
        "An attention assessment overall_score must reference criterion 'attention_accuracy'.",
      );
    }
    if (
      document.scoring.items.some(
        (item) =>
          item.scoring_model !== "criterion" ||
          item.strategy === "scale_value" ||
          item.min_points !== 0,
      )
    ) {
      throw new JsonDocumentError(
        "Attention assessments require objective criterion items with min_points equal to 0.",
      );
    }
    if (
      questions.some(
        (question) =>
          "remediation_question_key" in question &&
          Boolean(question.remediation_question_key),
      )
    ) {
      throw new JsonDocumentError(
        "Attention assessments cannot contain remediation branches.",
      );
    }
  }

  if (
    document.scoring.assessment_domain === "sjt" &&
    (
      document.scoring.result_shape !== "hybrid" ||
      document.scoring.overall_score?.source_type !== "criterion" ||
      document.scoring.overall_score.source_key !== "sjt_total"
    )
  ) {
    throw new JsonDocumentError(
      "An SJT assessment requires hybrid result_shape and criterion overall_score 'sjt_total'.",
    );
  }

  const validation = validateScoringDefinitionV2({
    criterionScoreIds: DERIVED_CRITERION_SCORE_IDS,
    definition: buildScoringDefinitionFromImportV2(document),
    forPublication: true,
    items: buildScoringItemsFromImportV2(document),
  });
  if (!validation.ok) {
    const first = validation.issues[0];
    throw new JsonDocumentError(
      `${first.path || "scoring"}: ${first.message}`,
    );
  }
}

export const talviaTestImportV2EnvelopeSchema = v2EnvelopeSchema;
export const talviaTestImportV1Schema = talviaTestImportDocumentSchema;
