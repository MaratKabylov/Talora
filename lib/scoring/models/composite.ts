import { createCoverageConfidence } from "../confidence.ts";
import { normalizeScore, roundOutput } from "../normalization.ts";
import {
  ScoringDomainError,
  type CompositeDefinition,
  type ScoreValue,
} from "../types.ts";

type PrimaryScores = {
  composite?: readonly ScoreValue[];
  criterion: readonly ScoreValue[];
  scale: readonly ScoreValue[];
};

export function calculateCompositeScores(
  definitions: readonly CompositeDefinition[],
  primaryScores: PrimaryScores,
) {
  const scores: ScoreValue[] = [...(primaryScores.composite ?? [])];
  const pending = new Map(definitions.map((definition) => [definition.id, definition]));

  while (pending.size > 0) {
    let progressed = false;
    for (const [id, definition] of pending) {
      const unresolvedDependency = definition.inputs.some(
        (input) =>
          input.source === "composite" &&
          pending.has(input.scoreId),
      );
      if (unresolvedDependency) continue;

      scores.push(calculateComposite(definition, {
        composite: scores,
        criterion: primaryScores.criterion,
        scale: primaryScores.scale,
      }));
      pending.delete(id);
      progressed = true;
    }
    if (!progressed) {
      throw new ScoringDomainError(
        "COMPOSITE_CYCLE",
        "Composite dependencies contain a cycle.",
      );
    }
  }

  return scores;
}

export function calculateComposite(
  definition: CompositeDefinition,
  scores: PrimaryScores,
): ScoreValue {
  const resolved = definition.inputs.map((input) => {
    const score = scores[input.source]?.find((candidate) => candidate.id === input.scoreId);
    const value = score ? readInputValue(score, input.value) : null;
    return { input, score, value };
  });
  const usable = resolved.filter(
    (entry): entry is typeof entry & { value: number } => entry.value !== null,
  );
  const minRequired = definition.minRequiredInputs ??
    (definition.missingPolicy === "fail" ? definition.inputs.length : 1);
  const hasMissingRequired =
    usable.length < minRequired ||
    (definition.missingPolicy === "fail" && usable.length !== resolved.length);
  const confidence = createCoverageConfidence(usable.length, resolved.length);

  if (hasMissingRequired) {
    return {
      confidence,
      id: definition.id,
      norm_score: null,
      normalized_score: null,
      raw_score: null,
      status: "insufficient_data",
    };
  }

  const numerator = usable.reduce(
    (sum, entry) => sum + entry.value * entry.input.weight,
    0,
  );
  const denominator = usable.reduce((sum, entry) => sum + entry.input.weight, 0);
  if (definition.aggregation === "weighted_mean" && denominator === 0) {
    throw new ScoringDomainError(
      "INVALID_SCORING_DEFINITION",
      `Composite '${definition.id}' has a zero denominator.`,
    );
  }
  const rawScore = roundOutput(
    definition.aggregation === "sum" ? numerator : numerator / denominator,
  );
  const normalizedScore = definition.outputRange
    ? normalizeScore(rawScore, definition.outputRange.min, definition.outputRange.max)
    : null;

  return {
    confidence,
    id: definition.id,
    norm_score: null,
    normalized_score: normalizedScore,
    raw_score: rawScore,
    status: "ok",
  };
}

function readInputValue(
  score: ScoreValue,
  value: "raw_score" | "normalized_score" | "norm_score",
) {
  if (score.status !== "ok") return null;
  if (value === "norm_score") return score.norm_score?.primary.value ?? null;
  return score[value];
}
