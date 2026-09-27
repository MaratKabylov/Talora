import {
  MOTIVATION_9_COMPETENCIES,
  type CompetencyKey,
} from "../jobs/constants.ts";
import { assignCompetitionRanks } from "./profile-ranking.ts";

export type MotivationProfileSource = {
  key: CompetencyKey;
  label: string;
  percentage: number | null;
};

export type RankedMotivationCompetency = {
  key: CompetencyKey;
  label: string;
  percentage: number;
  rank: number;
};

function shortLabel(label: string) {
  const value = label.replace(/^Мотивация:\s*/u, "");
  return value ? `${value[0].toLocaleUpperCase("ru-RU")}${value.slice(1)}` : label;
}

export function buildMotivation9Profile(competencies: readonly MotivationProfileSource[]) {
  const competencyByKey = new Map(competencies.map((competency) => [competency.key, competency]));
  const profile = MOTIVATION_9_COMPETENCIES.flatMap((definition, sourceIndex) => {
    const competency = competencyByKey.get(definition.key);
    return competency?.percentage !== null && competency?.percentage !== undefined
      ? [{ ...competency, percentage: competency.percentage, sourceIndex }]
      : [];
  });

  if (profile.length !== MOTIVATION_9_COMPETENCIES.length) return null;

  const ordered = profile.sort(
    (left, right) =>
      right.percentage - left.percentage || left.sourceIndex - right.sourceIndex,
  );
  const ranked: RankedMotivationCompetency[] = assignCompetitionRanks(
    ordered,
    (competency) => competency.percentage,
  ).map(({ rank, value: competency }) => ({
    key: competency.key,
    label: shortLabel(competency.label),
    percentage: competency.percentage,
    rank: rank!,
  }));

  return { ranked };
}
