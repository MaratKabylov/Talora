export type OverallContributionMetadata = {
  contributesToOverall?: boolean | null;
  resultShape?: string | null;
  scoringType?: string | null;
};

export function contributesToOverallByDefault(metadata: OverallContributionMetadata) {
  return metadata.resultShape !== "profile" && metadata.scoringType !== "competency_profile";
}

export function packageTestContributesToOverall(metadata: OverallContributionMetadata) {
  return typeof metadata.contributesToOverall === "boolean"
    ? metadata.contributesToOverall
    : contributesToOverallByDefault(metadata);
}

export function contributingWeightPercent(
  tests: ReadonlyArray<{ contributesToOverall: boolean; weightPercent: number }>,
) {
  return tests.reduce(
    (total, test) => total + (test.contributesToOverall ? test.weightPercent : 0),
    0,
  );
}

export function calculateContributingOverall(
  scores: ReadonlyArray<{ percentage: number | null; weight: number }>,
) {
  const eligible = scores.filter((score) => score.percentage !== null && score.weight > 0);
  const totalWeight = eligible.reduce((total, score) => total + score.weight, 0);
  if (totalWeight <= 0) return null;

  const weightedScore = eligible.reduce(
    (total, score) => total + score.percentage! * score.weight,
    0,
  );
  return Math.round((weightedScore / totalWeight) * 100) / 100;
}
