import {
  MOTIVATION_9_COMPETENCIES,
  type CompetencyKey,
} from "../jobs/constants.ts";

export const MOTIVATION_PROFILE_GROUPS = [
  { key: "primary", label: "Основные драйверы" },
  { key: "expressed", label: "Выраженные драйверы" },
  { key: "situational", label: "Ситуативные" },
  { key: "lower_priority", label: "Относительно менее приоритетные" },
] as const;

export type MotivationProfileGroupKey = (typeof MOTIVATION_PROFILE_GROUPS)[number]["key"];

export type MotivationProfileSource = {
  key: CompetencyKey;
  label: string;
  percentage: number | null;
};

export type RankedMotivationCompetency = {
  group: MotivationProfileGroupKey;
  key: CompetencyKey;
  label: string;
  percentage: number;
  rank: number;
};

function shortLabel(label: string) {
  const value = label.replace(/^Мотивация:\s*/u, "");
  return value ? `${value[0].toLocaleUpperCase("ru-RU")}${value.slice(1)}` : label;
}

function groupForRank(rank: number): MotivationProfileGroupKey {
  if (rank <= 2) return "primary";
  if (rank <= 4) return "expressed";
  if (rank <= 7) return "situational";
  return "lower_priority";
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

  const ranked: RankedMotivationCompetency[] = profile
    .sort(
      (left, right) =>
        right.percentage - left.percentage || left.sourceIndex - right.sourceIndex,
    )
    .map((competency, index) => ({
      group: groupForRank(index + 1),
      key: competency.key,
      label: shortLabel(competency.label),
      percentage: competency.percentage,
      rank: index + 1,
    }));

  return {
    core: ranked.slice(0, 2),
    groups: MOTIVATION_PROFILE_GROUPS.map((group) => ({
      ...group,
      competencies: ranked.filter((competency) => competency.group === group.key),
    })),
    ranked,
  };
}
