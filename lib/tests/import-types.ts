export type TalviaTestImportSummary = {
  competencyKeys: string[];
  durationMinutes: number;
  forcedChoiceCount: number;
  matchingCount: number;
  multipleChoiceCount: number;
  openTextCount: number;
  optionCount: number;
  remediationQuestionCount: number;
  requiredQuestionCount: number;
  scaleCount: number;
  scoringType: "points" | "competency_profile" | "manual" | "mixed";
  sectionCount: number;
  singleChoiceCount: number;
  orderingCount: number;
  title: string;
  totalQuestionCount: number;
};

export type SystemTestImportTargetOption = {
  category: string | null;
  hasDraft: boolean;
  id: string;
  latestVersionNumber: number;
  title: string;
};

export type SystemTestImportTarget = {
  nextVersionNumber: number;
  templateId: string;
  title: string;
};

export type TalviaTestImportPreviewState =
  | { status: "idle" }
  | { error: string; status: "error" }
  | {
      fileName: string;
      normalizedDocument: string;
      status: "ready";
      summary: TalviaTestImportSummary;
      target?: SystemTestImportTarget;
      warnings: string[];
    };

export type TalviaTestImportResult =
  | { error: string; status: "error" }
  | {
      status: "success";
      templateId: string;
      title: string;
      versionId: string;
      versionNumber: number;
    };
