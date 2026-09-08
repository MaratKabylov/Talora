import type { BuilderSection } from "./builder-data";

export type BuilderImportRequest = {
  templateId: string;
  versionId: string;
  sourceTemplateId: string;
  sourceVersionId: string;
};

export type BuilderImportResult =
  | { ok: true; versionId: string; sections: BuilderSection[] }
  | { ok: false; error: string };

export type BuilderImportAction = (input: BuilderImportRequest) => Promise<BuilderImportResult>;
