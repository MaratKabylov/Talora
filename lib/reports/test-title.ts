export function resolveReportTestTitle(
  templateTitle: string | null | undefined,
  versionTitle: string | null | undefined,
) {
  return templateTitle?.trim() || versionTitle?.trim() || "Тест";
}
