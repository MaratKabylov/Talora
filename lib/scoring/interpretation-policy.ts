import { z } from "zod";

import { findScoreBand, validateScoreBands } from "./score-bands.ts";

export const INTERPRETATION_DIRECTIONS = [
  "higher_is_better",
  "lower_is_better",
  "neutral",
  "target_range",
] as const;
export const interpretationDirectionSchema = z.enum(INTERPRETATION_DIRECTIONS);

export type InterpretationDirection = (typeof INTERPRETATION_DIRECTIONS)[number];
export type InterpretationBandCode = "development_area" | "neutral" | "strength";
export type ProfileBandCode = "high" | "low" | "medium";

type InterpretationBand = {
  code: InterpretationBandCode;
  label: string;
  max: number;
  min: number;
};

type ProfileBand = {
  code: ProfileBandCode;
  label: string;
  max: number;
  min: number;
};

export type InterpretationPolicy = {
  bands: InterpretationBand[];
  profileBands: ProfileBand[];
};

const interpretationBandSchema = z.object({
  code: z.enum(["development_area", "neutral", "strength"]),
  label: z.string().trim().min(1).max(240).optional(),
  max: z.number().finite().min(0).max(100),
  min: z.number().finite().min(0).max(100),
}).strict();

const profileBandSchema = z.object({
  code: z.enum(["low", "medium", "high"]),
  label: z.string().trim().min(1).max(240).optional(),
  max: z.number().finite().min(0).max(100),
  min: z.number().finite().min(0).max(100),
}).strict();

function addBandIssues(
  bands: ReadonlyArray<{ code: string; max: number; min: number }>,
  context: z.RefinementCtx,
  path: string,
) {
  for (const message of validateScoreBands(bands)) {
    context.addIssue({ code: "custom", message, path: [path] });
  }
}

export const DEFAULT_INTERPRETATION_POLICY: InterpretationPolicy = {
  // Preserves the deployed report heuristics: <65 development, >=75 strength.
  bands: [
    { code: "development_area", label: "Зона развития", min: 0, max: 64.99 },
    { code: "neutral", label: "Приемлемый уровень", min: 65, max: 74.99 },
    { code: "strength", label: "Сильная сторона", min: 75, max: 100 },
  ],
  profileBands: [
    { code: "low", label: "Низкая выраженность", min: 0, max: 33.33 },
    { code: "medium", label: "Средняя выраженность", min: 33.34, max: 66.66 },
    { code: "high", label: "Высокая выраженность", min: 66.67, max: 100 },
  ],
};

export const interpretationPolicySchema = z.object({
  bands: z.array(interpretationBandSchema).length(3),
  profileBands: z.array(profileBandSchema).length(3).optional(),
}).strict().superRefine((policy, context) => {
  addBandIssues(policy.bands, context, "bands");
  addBandIssues(
    policy.profileBands ?? DEFAULT_INTERPRETATION_POLICY.profileBands,
    context,
    "profileBands",
  );
});

export function parseInterpretationPolicy(value: unknown): InterpretationPolicy {
  if (value === null || value === undefined) return DEFAULT_INTERPRETATION_POLICY;
  const parsed = interpretationPolicySchema.parse(value);
  return {
    bands: parsed.bands.map((band) => ({
      ...band,
      label:
        band.label ??
        DEFAULT_INTERPRETATION_POLICY.bands.find((item) => item.code === band.code)!.label,
    })),
    profileBands: (parsed.profileBands ?? DEFAULT_INTERPRETATION_POLICY.profileBands).map(
      (band) => ({
        ...band,
        label:
          band.label ??
          DEFAULT_INTERPRETATION_POLICY.profileBands.find(
            (item) => item.code === band.code,
          )!.label,
      }),
    ),
  };
}

export function defaultInterpretationDirection(input: {
  assessmentDomain?: string | null;
  competencyKey?: string | null;
}): InterpretationDirection {
  if (
    input.assessmentDomain === "personality" ||
    input.assessmentDomain === "motivation" ||
    input.competencyKey?.startsWith("motivation_")
  ) {
    return "neutral";
  }
  return "higher_is_better";
}

export function interpretReportScore(
  score: number | null,
  policy: InterpretationPolicy,
  context: {
    assessmentDomain?: string | null;
    competencyKey?: string | null;
    direction?: InterpretationDirection;
  } = {},
) {
  const direction = context.direction ?? defaultInterpretationDirection(context);
  if (direction === "neutral" || direction === "target_range") {
    const band = findScoreBand(score, policy.profileBands);
    return band ? { band: band.code, direction, evaluative: false as const } : null;
  }

  const directedScore = direction === "lower_is_better" && score !== null ? 100 - score : score;
  const band = findScoreBand(directedScore, policy.bands);
  return band ? { band: band.code, direction, evaluative: true as const } : null;
}
