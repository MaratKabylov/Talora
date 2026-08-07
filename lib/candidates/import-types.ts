export type CandidateImportCandidate = {
  city: string | null;
  email: string;
  fullName: string;
  phone: string | null;
  rowNumber: number;
  source: string | null;
};

export type CandidateImportPreviewRow = CandidateImportCandidate & {
  issues: string[];
  status: "ready" | "skipped" | "error";
};

export type CandidateImportPreviewState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | {
      errorCount: number;
      expiresAt: string;
      fileName: string;
      readyCount: number;
      rows: CandidateImportPreviewRow[];
      skippedCount: number;
      status: "ready";
    };

export type CandidateImportResultRow = {
  email: string;
  message: string;
  outcome: "imported" | "skipped" | "error";
  rowNumber: number;
};

export type CandidateImportResult =
  | { status: "error"; error: string }
  | {
      errorCount: number;
      importedCount: number;
      rows: CandidateImportResultRow[];
      skippedCount: number;
      status: "success";
    };
