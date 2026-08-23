import { z } from "zod";

import {
  ASSESSMENT_DOMAINS,
  CRITERION_STRATEGIES,
  FORCED_CHOICE_METHODS,
  RESULT_SHAPES,
  SCORING_SCHEMA_VERSION,
  type ScoringDefinitionV2,
  type ScoringErrorCode,
  type ScoringItemDefinition,
} from "./types.ts";

const stableKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z][a-z0-9_.-]*$/i, "Use a stable machine-readable key.");
const entityIdSchema = z.string().trim().min(1).max(160);
const positiveWeightSchema = z.number().finite().gt(0, "Weight must be greater than zero.");
const optionalTextSchema = z.string().trim().min(1).max(4_000).nullable().optional();

export const scoreThresholdSchema = z
  .object({
    code: stableKeySchema,
    label: z.string().trim().min(1).max(240),
    max: z.number().finite().min(0).max(100),
    min: z.number().finite().min(0).max(100),
  })
  .strict()
  .superRefine((threshold, context) => {
    if (threshold.min >= threshold.max) {
      context.addIssue({
        code: "custom",
        message: "max must be greater than min.",
        path: ["max"],
      });
    }
  });

export const scaleDefinitionSchema = z
  .object({
    aggregation: z.enum(["sum", "mean"]),
    code: stableKeySchema,
    description: optionalTextSchema,
    displayOrder: z.number().int().min(0),
    id: stableKeySchema,
    interpretationKey: stableKeySchema.nullable().optional(),
    minAnsweredItems: z.number().int().min(1).nullable().optional(),
    minAnsweredRatio: z.number().finite().gt(0).max(1).nullable().optional(),
    missingPolicy: z.enum(["insufficient", "prorate"]),
    theoreticalMax: z.number().finite(),
    theoreticalMin: z.number().finite(),
    title: z.string().trim().min(1).max(240),
  })
  .strict()
  .superRefine((scale, context) => {
    if (scale.theoreticalMin >= scale.theoreticalMax) {
      context.addIssue({
        code: "custom",
        message: "theoreticalMax must be greater than theoreticalMin.",
        path: ["theoreticalMax"],
      });
    }
  });

export const criterionScoringConfigSchema = z
  .object({
    competencyBindings: z
      .array(
        z
          .object({
            competencyId: stableKeySchema,
            weight: positiveWeightSchema,
          })
          .strict(),
      )
      .optional(),
    maxPoints: z.number().finite(),
    minPoints: z.number().finite().optional().default(0),
    strategy: z.enum(CRITERION_STRATEGIES),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.maxPoints <= config.minPoints) {
      context.addIssue({
        code: "custom",
        message: "maxPoints must be greater than minPoints.",
        path: ["maxPoints"],
      });
    }
  });

export const scaleScoringConfigSchema = z
  .object({
    bindings: z
      .array(
        z
          .object({
            direction: z.union([z.literal(1), z.literal(-1)]),
            scaleId: stableKeySchema,
            weight: positiveWeightSchema,
          })
          .strict(),
      )
      .min(1),
    responseMax: z.number().finite(),
    responseMin: z.number().finite(),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.responseMin >= config.responseMax) {
      context.addIssue({
        code: "custom",
        message: "responseMax must be greater than responseMin.",
        path: ["responseMax"],
      });
    }
  });

export const forcedChoiceScoringConfigSchema = z
  .object({
    centering: z.enum(["none", "person_mean"]),
    method: z.enum(FORCED_CHOICE_METHODS),
    roleWeights: z
      .object({
        least: z.number().finite(),
        most: z.number().finite(),
      })
      .strict(),
    statements: z
      .array(
        z
          .object({
            keyedDirection: z.union([z.literal(1), z.literal(-1)]).optional(),
            scaleId: stableKeySchema,
            statementId: entityIdSchema,
          })
          .strict(),
      )
      .min(2),
  })
  .strict();

export const scoringItemDefinitionSchema = z.discriminatedUnion("scoringModel", [
  z
    .object({
      config: criterionScoringConfigSchema,
      id: entityIdSchema,
      questionType: z.enum([
        "single_choice",
        "multiple_choice",
        "scale",
        "ordering",
        "matching",
      ]),
      scoringModel: z.literal("criterion"),
    })
    .strict(),
  z
    .object({
      config: scaleScoringConfigSchema,
      id: entityIdSchema,
      questionType: z.literal("scale"),
      scoringModel: z.literal("scale"),
    })
    .strict(),
  z
    .object({
      config: forcedChoiceScoringConfigSchema,
      id: entityIdSchema,
      questionType: z.literal("forced_choice"),
      scoringModel: z.literal("forced_choice"),
    })
    .strict(),
  z
    .object({
      config: z.null(),
      id: entityIdSchema,
      questionType: z.literal("open_text"),
      scoringModel: z.null(),
    })
    .strict(),
]);

const compositeDefinitionSchema = z
  .object({
    aggregation: z.enum(["weighted_mean", "sum"]),
    code: stableKeySchema,
    id: stableKeySchema,
    inputs: z
      .array(
        z
          .object({
            scoreId: entityIdSchema,
            source: z.enum(["criterion", "scale", "composite"]),
            value: z.enum(["raw_score", "normalized_score", "norm_score"]),
            weight: positiveWeightSchema,
          })
          .strict(),
      )
      .min(1),
    interpretationKey: stableKeySchema.nullable().optional(),
    minRequiredInputs: z.number().int().min(1).optional(),
    missingPolicy: z.enum(["fail", "renormalize"]),
    outputRange: z
      .object({ max: z.number().finite(), min: z.number().finite() })
      .strict()
      .nullable()
      .optional(),
    title: z.string().trim().min(1).max(240),
  })
  .strict()
  .superRefine((composite, context) => {
    if (
      composite.outputRange &&
      composite.outputRange.min >= composite.outputRange.max
    ) {
      context.addIssue({
        code: "custom",
        message: "outputRange.max must be greater than outputRange.min.",
        path: ["outputRange", "max"],
      });
    }
    if (
      composite.minRequiredInputs !== undefined &&
      composite.minRequiredInputs > composite.inputs.length
    ) {
      context.addIssue({
        code: "custom",
        message: "minRequiredInputs cannot exceed the input count.",
        path: ["minRequiredInputs"],
      });
    }
  });

export const scoringDefinitionV2Schema = z
  .object({
    assessmentDomain: z.enum(ASSESSMENT_DOMAINS),
    composites: z.array(compositeDefinitionSchema),
    normAssignments: z.array(
      z
        .object({
          normScaleCode: stableKeySchema,
          normSetId: entityIdSchema,
          normSetVersion: z.number().int().min(1),
          primaryMetric: z.enum(["percentile", "z", "sten"]),
          scaleId: stableKeySchema,
        })
        .strict(),
    ),
    overallScore: z
      .object({
        sourceId: entityIdSchema,
        sourceType: z.enum(["criterion", "composite"]),
      })
      .strict()
      .nullable()
      .optional(),
    resultShape: z.enum(RESULT_SHAPES),
    scales: z.array(scaleDefinitionSchema),
    schemaVersion: z.literal(SCORING_SCHEMA_VERSION),
    thresholds: z
      .array(scoreThresholdSchema)
      .optional()
      .superRefine((thresholds, context) => {
        if (!thresholds || thresholds.length === 0) return;
        if (thresholds[0].min !== 0) {
          context.addIssue({
            code: "custom",
            message: "Thresholds must start at 0.",
            path: [0, "min"],
          });
        }
        if (thresholds.at(-1)?.max !== 100) {
          context.addIssue({
            code: "custom",
            message: "Thresholds must end at 100.",
            path: [thresholds.length - 1, "max"],
          });
        }
        thresholds.slice(1).forEach((threshold, index) => {
          const previous = thresholds[index];
          const gap = threshold.min - previous.max;
          if (gap <= 0) {
            context.addIssue({
              code: "custom",
              message: "Threshold ranges must not overlap and must be ordered.",
              path: [index + 1, "min"],
            });
          } else if (gap > 0.0100001) {
            context.addIssue({
              code: "custom",
              message: "Threshold ranges must cover every score rounded to two decimals.",
              path: [index + 1, "min"],
            });
          }
        });
      }),
  })
  .strict();

export type DefinitionValidationIssue = {
  code: ScoringErrorCode;
  message: string;
  path: string;
};

export type DefinitionValidationResult =
  | {
      definition: ScoringDefinitionV2;
      items: ScoringItemDefinition[];
      issues: [];
      ok: true;
      warnings: DefinitionValidationIssue[];
    }
  | {
      issues: DefinitionValidationIssue[];
      ok: false;
      warnings: DefinitionValidationIssue[];
    };

export function validateScoringDefinitionV2(input: {
  criterionScoreIds?: readonly string[];
  definition: unknown;
  forPublication?: boolean;
  items?: unknown;
}): DefinitionValidationResult {
  const definitionResult = scoringDefinitionV2Schema.safeParse(input.definition);
  const itemsResult = z.array(scoringItemDefinitionSchema).safeParse(input.items ?? []);
  const issues: DefinitionValidationIssue[] = [];
  const warnings: DefinitionValidationIssue[] = [];

  if (!definitionResult.success) {
    issues.push(...definitionResult.error.issues.map((issue) => toDefinitionIssue(issue)));
  }
  if (!itemsResult.success) {
    issues.push(...itemsResult.error.issues.map((issue) => toDefinitionIssue(issue, "items")));
  }
  if (!definitionResult.success || !itemsResult.success) {
    return { issues, ok: false, warnings };
  }

  const definition = definitionResult.data as ScoringDefinitionV2;
  const items = itemsResult.data as ScoringItemDefinition[];
  findDuplicates(definition.scales.map((scale) => scale.id), "scales", "scale id", issues);
  findDuplicates(definition.scales.map((scale) => scale.code), "scales", "scale code", issues);
  findDuplicates(
    definition.composites.map((composite) => composite.id),
    "composites",
    "composite id",
    issues,
  );
  findDuplicates(
    definition.composites.map((composite) => composite.code),
    "composites",
    "composite code",
    issues,
  );
  findDuplicates(items.map((item) => item.id), "items", "item id", issues);
  findDuplicates(
    (definition.thresholds ?? []).map((threshold) => threshold.code),
    "thresholds",
    "threshold code",
    issues,
  );

  const scaleIds = new Set(definition.scales.map((scale) => scale.id));
  const compositeIds = new Set(definition.composites.map((composite) => composite.id));
  const criterionIds = new Set([
    ...(input.criterionScoreIds ?? []),
    ...items.filter((item) => item.scoringModel === "criterion").map((item) => item.id),
  ]);

  items.forEach((item, itemIndex) => {
    if (item.scoringModel === "criterion") {
      const expectedStrategy = {
        matching: "matching",
        multiple_choice: "multiple_choice_v1",
        ordering: "ordering",
        scale: "scale_value",
        single_choice: "single_choice_points",
      } as const;
      if (item.config.strategy !== expectedStrategy[item.questionType]) {
        issues.push(issue(
          "INVALID_SCORING_DEFINITION",
          `Criterion strategy '${item.config.strategy}' is incompatible with '${item.questionType}'.`,
          `items.${itemIndex}.config.strategy`,
        ));
      }
    }
    if (item.scoringModel === "scale") {
      item.config.bindings.forEach((binding, bindingIndex) => {
        if (!scaleIds.has(binding.scaleId)) {
          issues.push(issue(
            "INVALID_SCORING_DEFINITION",
            `Unknown scale '${binding.scaleId}'.`,
            `items.${itemIndex}.config.bindings.${bindingIndex}.scaleId`,
          ));
        }
      });
    }
    if (item.scoringModel === "forced_choice") {
      item.config.statements.forEach((statement, statementIndex) => {
        if (!scaleIds.has(statement.scaleId)) {
          issues.push(issue(
            "INVALID_SCORING_DEFINITION",
            `Unknown scale '${statement.scaleId}'.`,
            `items.${itemIndex}.config.statements.${statementIndex}.scaleId`,
          ));
        }
      });
      if (input.forPublication && item.config.method === "thurstonian_irt") {
        issues.push(issue(
          "UNSUPPORTED_SCORING_METHOD",
          "Thurstonian IRT is reserved for a future calibrated scorer.",
          `items.${itemIndex}.config.method`,
        ));
      }
    }
  });

  definition.normAssignments.forEach((assignment, assignmentIndex) => {
    if (!scaleIds.has(assignment.scaleId)) {
      issues.push(issue(
        "NORM_SCALE_NOT_FOUND",
        `Norm assignment references unknown scale '${assignment.scaleId}'.`,
        `normAssignments.${assignmentIndex}.scaleId`,
      ));
    }
  });

  definition.composites.forEach((composite, compositeIndex) => {
    composite.inputs.forEach((compositeInput, inputIndex) => {
      const known =
        compositeInput.source === "criterion"
          ? criterionIds.has(compositeInput.scoreId)
          : compositeInput.source === "scale"
            ? scaleIds.has(compositeInput.scoreId)
            : compositeIds.has(compositeInput.scoreId);
      if (!known) {
        issues.push(issue(
          "COMPOSITE_INPUT_MISSING",
          `Unknown ${compositeInput.source} score '${compositeInput.scoreId}'.`,
          `composites.${compositeIndex}.inputs.${inputIndex}.scoreId`,
        ));
      }
    });
  });

  if (hasCompositeCycle(definition)) {
    issues.push(issue("COMPOSITE_CYCLE", "Composite dependencies contain a cycle.", "composites"));
  }

  const overall = definition.overallScore;
  if (
    overall &&
    !(
      (overall.sourceType === "criterion" && criterionIds.has(overall.sourceId)) ||
      (overall.sourceType === "composite" && compositeIds.has(overall.sourceId))
    )
  ) {
    issues.push(issue(
      "OVERALL_MAPPING_INVALID",
      `Overall score references unknown ${overall.sourceType} '${overall.sourceId}'.`,
      "overallScore.sourceId",
    ));
  }

  if (
    overall &&
    (definition.assessmentDomain === "personality" ||
      definition.assessmentDomain === "motivation")
  ) {
    warnings.push(issue(
      "OVERALL_MAPPING_INVALID",
      "A profile assessment has an explicit overall score; confirm its business meaning before publication.",
      "overallScore",
    ));
  }

  return issues.length > 0
    ? { issues, ok: false, warnings }
    : { definition, items, issues: [], ok: true, warnings };
}

function hasCompositeCycle(definition: ScoringDefinitionV2) {
  const dependencies = new Map(
    definition.composites.map((composite) => [
      composite.id,
      composite.inputs
        .filter((input) => input.source === "composite")
        .map((input) => input.scoreId),
    ]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };

  return [...dependencies.keys()].some(visit);
}

function findDuplicates(
  values: readonly string[],
  path: string,
  label: string,
  issues: DefinitionValidationIssue[],
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      issues.push(issue(
        "INVALID_SCORING_DEFINITION",
        `Duplicate ${label} '${value}'.`,
        `${path}.${index}`,
      ));
    }
    seen.add(value);
  });
}

function toDefinitionIssue(
  value: { message: string; path: PropertyKey[] },
  prefix?: string,
): DefinitionValidationIssue {
  const suffix = value.path.map(String).join(".");
  return issue(
    "INVALID_SCORING_DEFINITION",
    value.message,
    [prefix, suffix].filter(Boolean).join("."),
  );
}

function issue(
  code: ScoringErrorCode,
  message: string,
  path: string,
): DefinitionValidationIssue {
  return { code, message, path };
}
