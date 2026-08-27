type VersionWithPublicationStatus = {
  status: string;
  versionNumber: number;
};

export function getLatestPublishedVersion<T extends VersionWithPublicationStatus>(
  versions: readonly T[],
): T | null {
  return versions.reduce<T | null>((latest, version) => {
    if (version.status !== "published") {
      return latest;
    }

    return !latest || version.versionNumber > latest.versionNumber ? version : latest;
  }, null);
}
