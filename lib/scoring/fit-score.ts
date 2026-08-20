import { isMotivationCompetencyKey } from "../jobs/constants.ts";

type FitScoreCompetency = {
  competency_key: string;
  percentage: number | null;
};

type FitScoreWeight = {
  competency_key: string;
  weight: number;
};

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculateFitScore(
  competencies: readonly FitScoreCompetency[],
  weights: readonly FitScoreWeight[],
) {
  const weightsByCompetency = new Map(
    weights.map((weight) => [weight.competency_key, Number(weight.weight)]),
  );
  const components = competencies.flatMap((competency) => {
    const weight = weightsByCompetency.get(competency.competency_key) ?? 0;
    return !isMotivationCompetencyKey(competency.competency_key) &&
      competency.percentage !== null &&
      weight > 0
      ? [{ percentage: competency.percentage, weight }]
      : [];
  });
  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);

  return totalWeight > 0
    ? round(
        components.reduce(
          (sum, component) => sum + component.percentage * component.weight,
          0,
        ) / totalWeight,
      )
    : null;
}
