export function resolveCandidateSessionPassingScore(input: {
  currentPackagePassingScore: number | null;
  snapshotPackageId: string | null;
  snapshotPassingScore: number | null;
}) {
  return input.snapshotPackageId !== null
    ? input.snapshotPassingScore
    : input.currentPackagePassingScore;
}
