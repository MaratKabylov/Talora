import { z } from "zod";

import { roundOutput } from "./normalization.ts";
import {
  ScoringDomainError,
  type NormAssignment,
  type NormScore,
} from "./types.ts";

const percentileTableParametersSchema = z
  .object({
    interpolation: z.enum(["step", "linear"]),
    points: z
      .array(
        z
          .object({
            percentile: z.number().finite().min(0).max(100),
            score: z.number().finite(),
          })
          .strict(),
      )
      .min(2),
  })
  .strict()
  .superRefine((parameters, context) => {
    for (let index = 1; index < parameters.points.length; index += 1) {
      const previous = parameters.points[index - 1];
      const current = parameters.points[index];
      if (current.score <= previous.score) {
        context.addIssue({
          code: "custom",
          message: "Percentile table scores must be strictly increasing.",
          path: ["points", index, "score"],
        });
      }
      if (current.percentile < previous.percentile) {
        context.addIssue({
          code: "custom",
          message: "Percentile table values must be monotonic.",
          path: ["points", index, "percentile"],
        });
      }
    }
  });

const zScoreParametersSchema = z
  .object({
    derivedMetrics: z.array(z.enum(["percentile", "sten"])).default([]),
    mean: z.number().finite(),
    sd: z.number().finite().positive(),
  })
  .strict();

export const normScaleDefinitionSchema = z.discriminatedUnion("conversionMethod", [
  z
    .object({
      conversionMethod: z.literal("percentile_table"),
      parameters: percentileTableParametersSchema,
      scaleCode: z.string().trim().min(1).max(160),
      scoreBasis: z.enum(["raw_score", "normalized_score"]),
    })
    .strict(),
  z
    .object({
      conversionMethod: z.literal("z_score"),
      parameters: zScoreParametersSchema,
      scaleCode: z.string().trim().min(1).max(160),
      scoreBasis: z.enum(["raw_score", "normalized_score"]),
    })
    .strict(),
]);

export type NormScaleDefinition = z.infer<typeof normScaleDefinitionSchema>;

export type PublishedNormSet = {
  code: string;
  id: string;
  populationLabel: string;
  scales: readonly NormScaleDefinition[];
  status: "published" | "retired";
  version: number;
};

export function convertNormScore(input: {
  assignment: NormAssignment;
  comparability?: "between_people" | "within_person_only";
  normSet: PublishedNormSet;
  rawScore: number | null;
  normalizedScore: number | null;
}): NormScore {
  if (input.comparability === "within_person_only") {
    throw new ScoringDomainError(
      "INVALID_SCORING_DEFINITION",
      "Ipsative within-person scores cannot be converted with population norms.",
    );
  }
  if (
    input.normSet.id !== input.assignment.normSetId ||
    input.normSet.version !== input.assignment.normSetVersion
  ) {
    throw new ScoringDomainError(
      "NORM_VERSION_MISMATCH",
      "The loaded norm set does not match the exact assigned ID and version.",
    );
  }
  const definition = input.normSet.scales.find(
    (scale) => scale.scaleCode === input.assignment.normScaleCode,
  );
  if (!definition) {
    throw new ScoringDomainError(
      "NORM_SCALE_NOT_FOUND",
      `Norm scale '${input.assignment.normScaleCode}' was not found.`,
    );
  }
  const sourceScore =
    definition.scoreBasis === "raw_score" ? input.rawScore : input.normalizedScore;
  if (sourceScore === null) {
    throw new ScoringDomainError(
      "INSUFFICIENT_DATA",
      `The required ${definition.scoreBasis} is unavailable for norm conversion.`,
    );
  }

  const metrics =
    definition.conversionMethod === "percentile_table"
      ? convertPercentileTable(sourceScore, definition.parameters)
      : convertZScore(sourceScore, definition.parameters);
  const primaryValue = metrics.get(input.assignment.primaryMetric);
  if (primaryValue === undefined) {
    throw new ScoringDomainError(
      "INVALID_SCORING_DEFINITION",
      `Norm conversion does not produce '${input.assignment.primaryMetric}'.`,
    );
  }

  return {
    derived: [...metrics]
      .filter(([metric]) => metric !== input.assignment.primaryMetric)
      .map(([metric, value]) => ({ metric, value })),
    norm_set_id: input.normSet.id,
    norm_set_version: input.normSet.version,
    population_label: input.normSet.populationLabel,
    primary: { metric: input.assignment.primaryMetric, value: primaryValue },
  };
}

function convertPercentileTable(
  score: number,
  parameters: z.infer<typeof percentileTableParametersSchema>,
) {
  const points = parameters.points;
  let percentile = points[0].percentile;
  if (score >= points.at(-1)!.score) {
    percentile = points.at(-1)!.percentile;
  } else if (score > points[0].score) {
    const upperIndex = points.findIndex((point) => point.score >= score);
    const lower = points[upperIndex - 1];
    const upper = points[upperIndex];
    percentile =
      parameters.interpolation === "step"
        ? lower.percentile
        : lower.percentile +
          ((score - lower.score) / (upper.score - lower.score)) *
            (upper.percentile - lower.percentile);
  }
  return new Map<"percentile" | "z" | "sten", number>([
    ["percentile", roundOutput(percentile)],
  ]);
}

function convertZScore(score: number, parameters: z.infer<typeof zScoreParametersSchema>) {
  const zValue = roundOutput((score - parameters.mean) / parameters.sd);
  const metrics = new Map<"percentile" | "z" | "sten", number>([["z", zValue]]);
  if (parameters.derivedMetrics.includes("percentile")) {
    metrics.set("percentile", roundOutput(normalCdf(zValue) * 100));
  }
  if (parameters.derivedMetrics.includes("sten")) {
    metrics.set("sten", Math.min(Math.max(Math.round(5.5 + 2 * zValue), 1), 10));
  }
  return metrics;
}

// Abramowitz-Stegun approximation; deterministic and sufficient for display conversion.
function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t) *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}
