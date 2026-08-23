import { z } from "zod";

const SOURCE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,119}$/;

export const assessmentCompositeComponentSchema = z.object({
  source: z.string().trim().regex(SOURCE_PATTERN),
  weight: z.number().positive().max(100),
});

export const assessmentCompositeConfigSchema = z
  .object({
    components: z.array(assessmentCompositeComponentSchema).min(1).max(50),
    min_required_components: z.number().int().positive().optional().default(1),
    missing_policy: z.enum(["fail", "renormalize"]).optional().default("renormalize"),
    version: z.literal("1.0").optional().default("1.0"),
  })
  .superRefine((config, context) => {
    const seen = new Set<string>();
    for (const [index, component] of config.components.entries()) {
      if (seen.has(component.source)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate composite source: ${component.source}.`,
          path: ["components", index, "source"],
        });
      }
      seen.add(component.source);
    }

    if (config.min_required_components > config.components.length) {
      context.addIssue({
        code: "custom",
        message: "min_required_components cannot exceed the number of components.",
        path: ["min_required_components"],
      });
    }
  });

export type AssessmentCompositeConfig = z.infer<typeof assessmentCompositeConfigSchema>;

export type AssessmentCompositeComponentResult = {
  active: boolean;
  contribution: number | null;
  score: number | null;
  source: string;
  weight: number;
};

export type AssessmentCompositeResult = {
  activeComponents: number;
  components: AssessmentCompositeComponentResult[];
  config: AssessmentCompositeConfig;
  coverage: number;
  model: "composite";
  score: number | null;
  status: "complete" | "partial" | "insufficient_data";
  version: "1.0";
};

export const assessmentCompositeResultSchema: z.ZodType<AssessmentCompositeResult> = z.object({
  activeComponents: z.number().int().nonnegative(),
  components: z.array(z.object({
    active: z.boolean(),
    contribution: z.number().finite().nullable(),
    score: z.number().min(0).max(100).nullable(),
    source: z.string(),
    weight: z.number().positive(),
  })),
  config: assessmentCompositeConfigSchema,
  coverage: z.number().min(0).max(100),
  model: z.literal("composite"),
  score: z.number().min(0).max(100).nullable(),
  status: z.enum(["complete", "partial", "insufficient_data"]),
  version: z.literal("1.0"),
});

function clampPercentage(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function normalizeAssessmentCompositeConfig(
  value: unknown,
): AssessmentCompositeConfig | null {
  const parsed = assessmentCompositeConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function normalizeAssessmentCompositeResult(
  value: unknown,
): AssessmentCompositeResult | null {
  const parsed = assessmentCompositeResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function calculateAssessmentComposite(
  config: AssessmentCompositeConfig,
  sourceValues: Readonly<Record<string, number | null | undefined>>,
): AssessmentCompositeResult {
  const resolved = config.components.map((component) => {
    const sourceValue = sourceValues[component.source];
    const score = typeof sourceValue === "number" && Number.isFinite(sourceValue)
      ? round(clampPercentage(sourceValue))
      : null;

    return { component, score };
  });
  const active = resolved.filter(
    (item): item is typeof item & { score: number } => item.score !== null,
  );
  const activeWeight = active.reduce((sum, item) => sum + item.component.weight, 0);
  const hasEnoughComponents = active.length >= config.min_required_components;
  const missingRejected = config.missing_policy === "fail" && active.length < resolved.length;
  const canScore = hasEnoughComponents && !missingRejected && activeWeight > 0;
  const score = canScore
    ? round(
        active.reduce(
          (sum, item) => sum + item.score * item.component.weight,
          0,
        ) / activeWeight,
      )
    : null;

  return {
    activeComponents: active.length,
    components: resolved.map(({ component, score: componentScore }) => ({
      active: componentScore !== null,
      contribution: canScore && componentScore !== null
        ? round((componentScore * component.weight) / activeWeight)
        : null,
      score: componentScore,
      source: component.source,
      weight: component.weight,
    })),
    config,
    coverage: round((active.length / resolved.length) * 100),
    model: "composite",
    score,
    status: score === null
      ? "insufficient_data"
      : active.length === resolved.length
        ? "complete"
        : "partial",
    version: "1.0",
  };
}
