export type TalviaTestImportSummary = {
  competencyKeys: string[];
  durationMinutes: number;
  openTextCount: number;
  optionCount: number;
  requiredQuestionCount: number;
  scaleCount: number;
  scoringType: "points" | "competency_profile" | "manual" | "mixed";
  sectionCount: number;
  singleChoiceCount: number;
  title: string;
  totalQuestionCount: number;
};

export type TalviaTestImportPreviewState =
  | { status: "idle" }
  | { error: string; status: "error" }
  | {
      fileName: string;
      normalizedDocument: string;
      status: "ready";
      summary: TalviaTestImportSummary;
      warnings: string[];
    };

export type TalviaTestImportResult =
  | { error: string; status: "error" }
  | {
      status: "success";
      templateId: string;
      title: string;
      versionId: string;
    };
