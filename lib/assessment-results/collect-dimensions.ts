import { scoringResultV2Schema } from "../scoring/result.ts";
import type {
  AssessmentDomain,
  CompositeDefinition,
  ResultShape,
  ScaleDefinition,
  ScoreValue,
  ScoringResultV2,
} from "../scoring/types.ts";

import { getLegacyAssessmentDimension } from "./legacy-registry.ts";
import { isProfileReportGroup, resolveAssessmentReportGroup } from "./report-groups.ts";
import type { AssessmentDimensionResult } from "./types";

export type LegacyDimensionInput = {
  interpretationDirection?: "higher_is_better" | "lower_is_better" | "neutral" | "target_range" | null;
  isBelowMinimum: boolean;
  key: string;
  maxScore?: number | null;
  minimumScore?: number | null;
  percentage: number | null;
  score?: number | null;
};

export type ScoringDefinitionMetadata = {
  composites?: Pick<CompositeDefinition, "id" | "title">[];
  scales?: Pick<ScaleDefinition, "displayOrder" | "id" | "title">[];
};

export type AssessmentDimensionSessionInput = {
  definition?: ScoringDefinitionMetadata | null;
  scoringResult: unknown;
};

function recordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractScoringDefinitionMetadata(
  value: unknown,
): ScoringDefinitionMetadata | null {
  if (!recordValue(value)) return null;

  const scales = Array.isArray(value.scales)
    ? value.scales.flatMap((item) => {
        if (
          !recordValue(item) ||
          typeof item.id !== "string" ||
          typeof item.title !== "string" ||
          typeof item.displayOrder !== "number"
        ) {
          return [];
        }
        return [{ displayOrder: item.displayOrder, id: item.id, title: item.title }];
      })
    : [];
  const composites = Array.isArray(value.composites)
    ? value.composites.flatMap((item) => {
        if (!recordValue(item) || typeof item.id !== "string" || typeof item.title !== "string") {
          return [];
        }
        return [{ id: item.id, title: item.title }];
      })
    : [];

  return scales.length > 0 || composites.length > 0 ? { composites, scales } : null;
}

const DERIVED_SCORE_TITLES: Record<string, string> = {
  attention_accuracy: "Внимательность",
  criterion_total: "Итоговый результат",
  learning_final: "Обучаемость",
  learning_initial: "Первичное усвоение",
  learning_recovery: "Восстановление после обратной связи",
  sjt_total: "Рабочие ситуации",
};

function humanizeKey(key: string) {
  return key
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toLocaleUpperCase("ru-RU"));
}

function directionFor(
  domain: AssessmentDomain,
  shape: ResultShape,
  sourceType: AssessmentDimensionResult["sourceType"],
) {
  const isProfileDimension =
    shape === "profile" ||
    domain === "motivation" ||
    domain === "personality" ||
    (domain === "behavior" && (sourceType === "scale" || sourceType === "forced_choice"));
  return isProfileDimension
    ? "neutral" as const
    : "higher_better" as const;
}

function normFor(score: ScoreValue) {
  const primary = score.norm_score?.primary;
  return primary
    ? {
        metric: primary.metric,
        populationLabel: score.norm_score?.population_label,
        value: primary.value,
      }
    : null;
}

function definitionTitles(definition: ScoringDefinitionMetadata | null | undefined) {
  return new Map([
    ...(definition?.scales ?? []).map((item) => [item.id, item.title] as const),
    ...(definition?.composites ?? []).map((item) => [item.id, item.title] as const),
  ]);
}

function resultDimensions(
  result: ScoringResultV2,
  definition: ScoringDefinitionMetadata | null | undefined,
) {
  const titles = definitionTitles(definition);
  const sources = [
    ...result.criterionScores.map((score) => ({ score, sourceType: "criterion" as const })),
    ...result.scaleScores.map((score) => ({ score, sourceType: "scale" as const })),
    ...result.forcedChoiceScores.map((score) => ({ score, sourceType: "forced_choice" as const })),
    ...result.compositeScores.map((score) => ({ score, sourceType: "composite" as const })),
  ];

  return sources.map(({ score, sourceType }): AssessmentDimensionResult => {
    const reportGroup = resolveAssessmentReportGroup({
      assessmentDomain: result.assessmentDomain,
      resultShape: result.resultShape,
      sourceType,
    });
    const interpretationDirection = directionFor(
      result.assessmentDomain,
      result.resultShape,
      sourceType,
    );
    return {
      assessmentDomain: result.assessmentDomain,
      interpretationDirection,
      key: score.id,
      norm: normFor(score),
      normalizedScore: score.normalized_score,
      reportGroup,
      resultShape: result.resultShape,
      score: score.raw_score,
      sourceType,
      thresholdStatus:
        interpretationDirection === "neutral" ? "not_applicable" : "not_configured",
      title: titles.get(score.id) ?? DERIVED_SCORE_TITLES[score.id] ?? humanizeKey(score.id),
    };
  });
}

function legacyDirection(input: LegacyDimensionInput, profile: boolean) {
  if (profile || input.interpretationDirection === "neutral" || input.interpretationDirection === "target_range") {
    return "neutral" as const;
  }
  return input.interpretationDirection === "lower_is_better"
    ? "lower_better" as const
    : "higher_better" as const;
}

function legacyDimension(input: LegacyDimensionInput): AssessmentDimensionResult {
  const registry = getLegacyAssessmentDimension(input.key);
  const domain = registry?.domain ?? "other";
  const reportGroup = resolveAssessmentReportGroup({
    assessmentDomain: domain,
    legacyKey: input.key,
    resultShape: registry?.interpretationDirection === "neutral" ? "profile" : "score",
    sourceType: "legacy_competency",
  });
  const profile = isProfileReportGroup(reportGroup);
  const thresholdStatus = profile
    ? "not_applicable" as const
    : input.minimumScore === null || input.minimumScore === undefined
      ? "not_configured" as const
      : input.isBelowMinimum
        ? "failed" as const
        : "passed" as const;

  return {
    assessmentDomain: domain,
    interpretationDirection: legacyDirection(input, profile),
    key: input.key,
    norm: null,
    normalizedScore: input.percentage,
    reportGroup,
    resultShape: profile ? "profile" : "score",
    score: input.score ?? null,
    sourceType: "legacy_competency",
    thresholdStatus,
    title: registry?.title ?? humanizeKey(input.key),
  };
}

function legacyKeyReplacedByV2(key: string, results: readonly ScoringResultV2[]) {
  const registry = getLegacyAssessmentDimension(key);
  if (!registry) return false;
  return results.some((result) => {
    if (result.assessmentDomain === "learning") return key === "learning_ability";
    if (result.assessmentDomain === "attention") return key === "attention_to_detail";
    if (result.assessmentDomain === "motivation") return registry.group === "motivation";
    if (result.assessmentDomain === "personality") return registry.group === "personality";
    if (result.assessmentDomain === "behavior" && result.resultShape === "profile") {
      return key === "work_behavior";
    }
    return false;
  });
}

export function collectAssessmentDimensions(input: {
  legacy?: readonly LegacyDimensionInput[];
  sessions?: readonly AssessmentDimensionSessionInput[];
}) {
  const parsedSessions = (input.sessions ?? []).flatMap((session) => {
    const parsed = scoringResultV2Schema.safeParse(session.scoringResult);
    return parsed.success ? [{ definition: session.definition, result: parsed.data as ScoringResultV2 }] : [];
  });
  const v2Results = parsedSessions.map((session) => session.result);
  const v2Dimensions = parsedSessions.flatMap((session) =>
    resultDimensions(session.result, session.definition),
  );
  const legacyDimensions = (input.legacy ?? [])
    .filter((dimension) => !legacyKeyReplacedByV2(dimension.key, v2Results))
    .map(legacyDimension);

  return [...v2Dimensions, ...legacyDimensions];
}
