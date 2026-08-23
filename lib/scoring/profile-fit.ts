import { z } from "zod";

const DIMENSION_ID_PATTERN = /^[a-z][a-z0-9_-]{0,79}$/;

export const profileTargetSchema = z
  .object({
    dimension_id: z.string().trim().regex(DIMENSION_ID_PATTERN),
    preferred_max: z.number().min(0).max(100),
    preferred_min: z.number().min(0).max(100),
    weight: z.number().positive().max(100),
  })
  .superRefine((target, context) => {
    if (target.preferred_min > target.preferred_max) {
      context.addIssue({
        code: "custom",
        message: "preferred_min cannot be greater than preferred_max.",
        path: ["preferred_min"],
      });
    }
  });

export const profileTargetListSchema = z
  .array(profileTargetSchema)
  .max(50)
  .superRefine((targets, context) => {
    const seen = new Set<string>();
    for (const [index, target] of targets.entries()) {
      if (seen.has(target.dimension_id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate dimension_id: ${target.dimension_id}.`,
          path: [index, "dimension_id"],
        });
      }
      seen.add(target.dimension_id);
    }
  });

export type ProfileTarget = z.infer<typeof profileTargetSchema>;

export type ProfileDimensionScore = {
  dimensionId: string;
  score: number;
};

export type ProfileFitComponent = {
  dimensionId: string;
  fit: number;
  preferredMax: number;
  preferredMin: number;
  score: number;
  weight: number;
};

export type ProfileFitResult = {
  components: ProfileFitComponent[];
  coverage: number;
  matchedDimensions: number;
  score: number | null;
  targetDimensions: number;
};

function clampPercentage(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function dimensionFit(score: number, target: ProfileTarget) {
  if (score >= target.preferred_min && score <= target.preferred_max) {
    return 100;
  }

  if (score < target.preferred_min) {
    return target.preferred_min === 0 ? 100 : (score / target.preferred_min) * 100;
  }

  return target.preferred_max === 100
    ? 100
    : ((100 - score) / (100 - target.preferred_max)) * 100;
}

export function normalizeProfileTargets(value: unknown): ProfileTarget[] {
  const parsed = profileTargetListSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function calculateProfileFit(
  dimensions: ProfileDimensionScore[],
  targets: ProfileTarget[],
): ProfileFitResult | null {
  if (targets.length === 0) {
    return null;
  }

  const scoresByDimension = new Map<string, number[]>();
  for (const dimension of dimensions) {
    if (!Number.isFinite(dimension.score)) continue;
    const values = scoresByDimension.get(dimension.dimensionId) ?? [];
    values.push(clampPercentage(dimension.score));
    scoresByDimension.set(dimension.dimensionId, values);
  }

  const components = targets.flatMap((target) => {
    const values = scoresByDimension.get(target.dimension_id);
    if (!values?.length) return [];

    const score = values.reduce((sum, value) => sum + value, 0) / values.length;
    return [{
      dimensionId: target.dimension_id,
      fit: round(clampPercentage(dimensionFit(score, target))),
      preferredMax: target.preferred_max,
      preferredMin: target.preferred_min,
      score: round(score),
      weight: target.weight,
    }];
  });

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);

  return {
    components,
    coverage: round((components.length / targets.length) * 100),
    matchedDimensions: components.length,
    score: totalWeight > 0
      ? round(
          components.reduce(
            (sum, component) => sum + component.fit * component.weight,
            0,
          ) / totalWeight,
        )
      : null,
    targetDimensions: targets.length,
  };
}
