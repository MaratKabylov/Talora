import { scoringResultV2Schema } from "../scoring/result.ts";
import type {
  AssessmentDomain,
  CompositeDefinition,
  OverallScoreMapping,
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
  summaryPercentage?: number | null;
  score?: number | null;
  sessionId?: string | null;
  testTitle?: string | null;
  testVersionId?: string | null;
};

export type ScoringDefinitionMetadata = {
  composites?: Array<Pick<CompositeDefinition, "id" | "title"> & { displayOrder: number }>;
  overallScore?: OverallScoreMapping | null;
  scales?: Pick<ScaleDefinition, "displayOrder" | "id" | "title">[];
};

export type AssessmentDimensionSessionInput = {
  definition?: ScoringDefinitionMetadata | null;
  passingScore?: number | null;
  scoringResult: unknown;
  sessionId?: string | null;
  testTitle?: string | null;
  testVersionId?: string | null;
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
    ? value.composites.flatMap((item, displayOrder) => {
        if (!recordValue(item) || typeof item.id !== "string" || typeof item.title !== "string") {
          return [];
        }
        return [{ displayOrder, id: item.id, title: item.title }];
      })
    : [];
  const overallScore = recordValue(value.overallScore) &&
      typeof value.overallScore.sourceId === "string" &&
      (value.overallScore.sourceType === "criterion" || value.overallScore.sourceType === "composite")
    ? {
        sourceId: value.overallScore.sourceId,
        sourceType: value.overallScore.sourceType,
      } satisfies OverallScoreMapping
    : null;

  return scales.length > 0 || composites.length > 0 || overallScore
    ? { composites, overallScore, scales }
    : null;
}

const DERIVED_SCORE_TITLES: Record<string, string> = {
  attention_accuracy: "Внимательность",
  criterion_total: "Итоговый результат",
  learning_final: "Обучаемость",
  learning_initial: "Первичное усвоение",
  learning_recovery: "Восстановление после обратной связи",
  sjt_total: "Рабочие ситуации",
};

const SAFE_DERIVED_CRITERION_IDS = new Set(Object.keys(DERIVED_SCORE_TITLES));
const DERIVED_SCORE_ORDER: Record<string, number> = {
  learning_final: 0,
  learning_initial: 1,
  learning_recovery: 2,
  attention_accuracy: 0,
  sjt_total: 0,
  criterion_total: 0,
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
    ((domain === "motivation" || domain === "personality" || domain === "behavior") &&
      (sourceType === "scale" || sourceType === "forced_choice"));
  return isProfileDimension ? "neutral" as const : "higher_better" as const;
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

function isOverallScore(
  result: ScoringResultV2,
  definition: ScoringDefinitionMetadata | null | undefined,
  sourceType: AssessmentDimensionResult["sourceType"],
  key: string,
) {
  if (definition?.overallScore) {
    return definition.overallScore.sourceType === sourceType &&
      definition.overallScore.sourceId === key;
  }
  if (sourceType !== "criterion") return false;
  if (result.assessmentDomain === "learning") return key === "learning_final";
  if (result.assessmentDomain === "attention") return key === "attention_accuracy";
  if (result.assessmentDomain === "sjt") return key === "sjt_total";
  return key === "criterion_total";
}

function isReportableCriterion(
  result: ScoringResultV2,
  definition: ScoringDefinitionMetadata | null | undefined,
  key: string,
) {
  if (result.assessmentDomain === "learning") {
    return key === "learning_final" || key === "learning_initial" || key === "learning_recovery";
  }
  if (result.assessmentDomain === "attention") return key === "attention_accuracy";
  if (result.assessmentDomain === "sjt") return key === "sjt_total";
  if (definition?.overallScore) {
    return definition.overallScore.sourceType === "criterion" &&
      definition.overallScore.sourceId === key;
  }
  if (definition) return key === "criterion_total";
  return SAFE_DERIVED_CRITERION_IDS.has(key);
}

function resultDimensions(
  result: ScoringResultV2,
  session: AssessmentDimensionSessionInput,
) {
  const definition = session.definition;
  const scaleMetadata = new Map((definition?.scales ?? []).map((item) => [item.id, item]));
  const compositeMetadata = new Map((definition?.composites ?? []).map((item) => [item.id, item]));
  const testVersionId = session.testVersionId ?? result.definitionVersionId ?? null;
  const sources = [
    ...result.criterionScores
      .filter((score) => isReportableCriterion(result, definition, score.id))
      .map((score) => ({ order: DERIVED_SCORE_ORDER[score.id] ?? null, score, sourceType: "criterion" as const })),
    ...result.scaleScores.map((score) => ({
      order: scaleMetadata.get(score.id)?.displayOrder ?? null,
      score,
      sourceType: "scale" as const,
    })),
    ...result.forcedChoiceScores.map((score) => ({
      order: scaleMetadata.get(score.id)?.displayOrder ?? null,
      score,
      sourceType: "forced_choice" as const,
    })),
    ...result.compositeScores.map((score) => ({
      order: compositeMetadata.get(score.id)?.displayOrder ?? null,
      score,
      sourceType: "composite" as const,
    })),
  ];

  return sources.map(({ order, score, sourceType }): AssessmentDimensionResult => {
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
    const overall = isOverallScore(result, definition, sourceType, score.id);
    const valueStatus = result.status === "requires_review"
      ? "requires_review" as const
      : score.status === "not_applicable"
        ? "not_applicable" as const
        : score.status === "ok" && (score.normalized_score !== null || score.raw_score !== null)
          ? "available" as const
          : "insufficient_data" as const;
    const threshold = interpretationDirection !== "neutral" &&
        overall &&
        session.passingScore !== null &&
        session.passingScore !== undefined &&
        valueStatus === "available" &&
        result.overallScore !== null
      ? {
          kind: "test_passing_score" as const,
          status: result.overallScore >= session.passingScore ? "passed" as const : "failed" as const,
          value: session.passingScore,
        }
      : null;
    const thresholdStatus = threshold?.status ?? (
      interpretationDirection === "neutral" || valueStatus === "not_applicable"
        ? "not_applicable" as const
        : "not_configured" as const
    );
    const title = scaleMetadata.get(score.id)?.title ??
      compositeMetadata.get(score.id)?.title ??
      DERIVED_SCORE_TITLES[score.id] ??
      humanizeKey(score.id);

    return {
      assessmentDomain: result.assessmentDomain,
      id: `${testVersionId ?? "unknown"}:${sourceType}:${score.id}`,
      interpretation: overall && result.interpretation
        ? { code: result.interpretation.code, label: result.interpretation.label }
        : null,
      interpretationDirection,
      key: score.id,
      norm: normFor(score),
      normalizedScore: overall && result.overallScore !== null
        ? result.overallScore
        : score.normalized_score,
      order,
      reportGroup,
      resultShape: result.resultShape,
      score: score.raw_score,
      sessionId: session.sessionId ?? null,
      sourceType,
      testTitle: session.testTitle ?? null,
      testVersionId,
      threshold,
      thresholdStatus,
      title,
      valueStatus,
    };
  });
}

function legacyDirection(inputs: readonly LegacyDimensionInput[], profile: boolean) {
  if (profile) {
    return "neutral" as const;
  }
  const directions = new Set(inputs.map((input) => input.interpretationDirection).filter(Boolean));
  if (
    directions.has("neutral") ||
    directions.has("target_range") ||
    (directions.has("higher_is_better") && directions.has("lower_is_better"))
  ) {
    return "neutral" as const;
  }
  return directions.has("lower_is_better") ? "lower_better" as const : "higher_better" as const;
}

function finitePercentage(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(100, Math.max(0, value)) * 100) / 100
    : null;
}

function aggregateLegacyPercentage(rows: readonly LegacyDimensionInput[]) {
  const percentages = rows.flatMap((row) => {
    const percentage = finitePercentage(row.percentage);
    return percentage === null ? [] : [{ percentage, weight: row.maxScore }];
  });
  if (percentages.length === 1) return percentages[0].percentage;
  if (percentages.length > 1 && percentages.every((row) => typeof row.weight === "number" && Number.isFinite(row.weight) && row.weight > 0)) {
    const totalWeight = percentages.reduce((total, row) => total + Number(row.weight), 0);
    return finitePercentage(
      percentages.reduce((total, row) => total + row.percentage * Number(row.weight), 0) / totalWeight,
    );
  }
  const summaryPercentage = rows
    .map((row) => finitePercentage(row.summaryPercentage))
    .find((value) => value !== null);
  if (summaryPercentage !== undefined && summaryPercentage !== null) return summaryPercentage;
  if (percentages.length === 0) return null;
  return finitePercentage(
    percentages.reduce((total, row) => total + row.percentage, 0) / percentages.length,
  );
}

function aggregateLegacyDimensions(inputs: readonly LegacyDimensionInput[]) {
  const grouped = new Map<string, LegacyDimensionInput[]>();
  for (const input of inputs) {
    const registry = getLegacyAssessmentDimension(input.key);
    const reportGroup = registry?.group ?? "other";
    const id = `legacy:${reportGroup}:${input.key}`;
    grouped.set(id, [...(grouped.get(id) ?? []), input]);
  }

  return Array.from(grouped.entries()).map(([id, rows]): AssessmentDimensionResult => {
    const first = rows[0];
    const registry = getLegacyAssessmentDimension(first.key);
    const domain = registry?.domain ?? "other";
    const reportGroup = resolveAssessmentReportGroup({
      assessmentDomain: domain,
      legacyKey: first.key,
      resultShape: registry?.interpretationDirection === "neutral" ? "profile" : "score",
      sourceType: "legacy_competency",
    });
    const profile = isProfileReportGroup(reportGroup);
    const numericRows = rows.filter(
      (row) => row.score !== null && row.score !== undefined && row.maxScore !== null && row.maxScore !== undefined,
    );
    const score = numericRows.length > 0
      ? numericRows.reduce((total, row) => total + Number(row.score), 0)
      : null;
    const percentage = aggregateLegacyPercentage(rows);
    const minimumScore = rows.find((row) => row.minimumScore !== null && row.minimumScore !== undefined)?.minimumScore;
    const valueStatus = percentage === null ? "insufficient_data" as const : "available" as const;
    const threshold = !profile &&
        minimumScore !== null &&
        minimumScore !== undefined &&
        valueStatus === "available"
      ? {
          kind: "competency_minimum" as const,
          status: percentage! >= minimumScore ? "passed" as const : "failed" as const,
          value: minimumScore,
        }
      : null;
    const thresholdStatus = threshold?.status ?? (profile ? "not_applicable" as const : "not_configured" as const);
    const sessionIds = new Set(rows.flatMap((row) => row.sessionId ? [row.sessionId] : []));
    const versionIds = new Set(rows.flatMap((row) => row.testVersionId ? [row.testVersionId] : []));
    const testTitles = new Set(rows.flatMap((row) => row.testTitle ? [row.testTitle] : []));

    return {
      assessmentDomain: domain,
      id,
      interpretation: null,
      interpretationDirection: legacyDirection(rows, profile),
      key: first.key,
      norm: null,
      normalizedScore: percentage,
      order: registry?.order ?? null,
      reportGroup,
      resultShape: profile ? "profile" : "score",
      score,
      sessionId: sessionIds.size === 1 ? Array.from(sessionIds)[0] : null,
      sourceType: "legacy_competency",
      testTitle: testTitles.size === 1 ? Array.from(testTitles)[0] : null,
      testVersionId: versionIds.size === 1 ? Array.from(versionIds)[0] : null,
      threshold,
      thresholdStatus,
      title: registry?.title ?? humanizeKey(first.key),
      valueStatus,
    };
  });
}

export function collectAssessmentDimensions(input: {
  legacy?: readonly LegacyDimensionInput[];
  sessions?: readonly AssessmentDimensionSessionInput[];
}) {
  const parsedSessions = (input.sessions ?? []).flatMap((session) => {
    const parsed = scoringResultV2Schema.safeParse(session.scoringResult);
    return parsed.success ? [{ result: parsed.data as ScoringResultV2, session }] : [];
  });
  const v2SessionIds = new Set(
    parsedSessions.flatMap(({ session }) => session.sessionId ? [session.sessionId] : []),
  );
  const v2Dimensions = parsedSessions.flatMap(({ result, session }) => resultDimensions(result, session));
  const legacyDimensions = aggregateLegacyDimensions(
    (input.legacy ?? []).filter((dimension) => !dimension.sessionId || !v2SessionIds.has(dimension.sessionId)),
  );

  return [...v2Dimensions, ...legacyDimensions].filter(
    (dimension, index, dimensions) => dimensions.findIndex((candidate) => candidate.id === dimension.id) === index,
  );
}
