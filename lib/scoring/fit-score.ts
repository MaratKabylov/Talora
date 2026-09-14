import { isMotivationCompetencyKey } from "../jobs/constants.ts";

type FitScoreCompetency = {
  competency_key: string;
  percentage: number | null;
};

function round(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculateFitScore(competencies: readonly FitScoreCompetency[]) {
  const components = competencies.filter(
    (competency) =>
      !isMotivationCompetencyKey(competency.competency_key) &&
      competency.percentage !== null,
  );

  return components.length > 0
    ? round(
        components.reduce((sum, component) => sum + component.percentage!, 0) /
          components.length,
      )
    : null;
}
