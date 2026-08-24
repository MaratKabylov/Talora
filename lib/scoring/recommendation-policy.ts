import { z } from "zod";

export const RECOMMENDATION_SOURCES = [
  "fit_score",
  "overall_score",
  "composite_score",
] as const;

export type RecommendationSource = (typeof RECOMMENDATION_SOURCES)[number];

export type RecommendationBand = {
  code: string;
  label: string;
  max: number;
  min: number;
};

export type RecommendationPolicy = {
  bands: RecommendationBand[];
  fallbackSource?: RecommendationSource;
  source: RecommendationSource;
};

const recommendationBandSchema = z
  .object({
    code: z.string().trim().min(1).max(160).regex(/^[a-z][a-z0-9_.-]*$/i),
    label: z.string().trim().min(1).max(240),
    max: z.number().finite().min(0).max(100),
    min: z.number().finite().min(0).max(100),
  })
  .strict()
  .superRefine((band, context) => {
    if (band.min > band.max) {
      context.addIssue({
        code: "custom",
        message: "min must be less than or equal to max.",
        path: ["max"],
      });
    }
  });

export const recommendationPolicySchema = z
  .object({
    bands: z.array(recommendationBandSchema).min(1).max(100),
    fallbackSource: z.enum(RECOMMENDATION_SOURCES).optional(),
    source: z.enum(RECOMMENDATION_SOURCES),
  })
  .strict()
  .superRefine((policy, context) => {
    const codes = new Set<string>();
    policy.bands.forEach((band, index) => {
      if (codes.has(band.code)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate recommendation code '${band.code}'.`,
          path: ["bands", index, "code"],
        });
      }
      codes.add(band.code);
    });

    const ordered = [...policy.bands].sort((left, right) => left.min - right.min);
    if (ordered[0]?.min !== 0) {
      context.addIssue({
        code: "custom",
        message: "Recommendation bands must start at 0.",
        path: ["bands"],
      });
    }
    if (ordered.at(-1)?.max !== 100) {
      context.addIssue({
        code: "custom",
        message: "Recommendation bands must end at 100.",
        path: ["bands"],
      });
    }

    ordered.slice(1).forEach((band, index) => {
      const previous = ordered[index];
      const gap = band.min - previous.max;
      if (gap <= 0) {
        context.addIssue({
          code: "custom",
          message: "Recommendation bands must not overlap.",
          path: ["bands"],
        });
      } else if (gap > 0.0100001) {
        context.addIssue({
          code: "custom",
          message: "Recommendation bands must cover every score rounded to two decimals.",
          path: ["bands"],
        });
      }
    });
  });

/**
 * Central legacy policy. The fallback preserves the historical `fit ?? overall`
 * source selection for rows created before configurable policies existed.
 */
export const DEFAULT_RECOMMENDATION_POLICY: RecommendationPolicy = {
  bands: [
    { code: "not_recommended", label: "Не рекомендуется", min: 0, max: 49.99 },
    { code: "backup", label: "Резерв", min: 50, max: 64.99 },
    { code: "consider", label: "Рассмотреть", min: 65, max: 74.99 },
    { code: "invite", label: "Рекомендуется пригласить", min: 75, max: 84.99 },
    { code: "strong_candidate", label: "Сильный кандидат", min: 85, max: 100 },
  ],
  fallbackSource: "overall_score",
  source: "fit_score",
};

export function parseRecommendationPolicy(value: unknown): RecommendationPolicy {
  if (value === null || value === undefined) return DEFAULT_RECOMMENDATION_POLICY;
  return recommendationPolicySchema.parse(value);
}

export function recommendWithPolicy(
  policy: RecommendationPolicy,
  scores: Record<RecommendationSource, number | null>,
) {
  const primaryValue = scores[policy.source];
  const value = primaryValue ?? (policy.fallbackSource ? scores[policy.fallbackSource] : null);
  if (value === null || !Number.isFinite(value)) return "requires_review";

  const rounded = Math.round(Math.min(Math.max(value, 0), 100) * 100) / 100;
  const band = policy.bands.find((candidate) => rounded >= candidate.min && rounded <= candidate.max);
  if (!band) {
    throw new Error(`Recommendation policy does not cover score ${rounded}.`);
  }
  return band.code;
}

export function capHighRiskRecommendation(
  recommendation: string,
  policy: RecommendationPolicy,
) {
  const cap = policy.bands.find((band) => band.code === "consider");
  const selected = policy.bands.find((band) => band.code === recommendation);
  if (!cap || !selected) return recommendation;
  return selected.min > cap.min ? cap.code : recommendation;
}
