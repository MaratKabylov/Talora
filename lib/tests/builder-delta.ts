import type { BuilderDocumentInput } from "./builder-document-schema";

type Section = BuilderDocumentInput["sections"][number];
type Question = Section["questions"][number];
type Option = Question["options"][number];
export type BuilderDelta = {
  version: BuilderDocumentInput["version"] | null;
  sections: (Omit<Section, "questions"> & { orderIndex: number })[];
  questions: (Omit<Question, "options"> & { sectionId: string; orderIndex: number })[];
  options: (Option & { questionId: string; orderIndex: number })[];
  deletedSections: string[]; deletedQuestions: string[]; deletedOptions: string[];
};
export type BuilderSaveRequest = {
  templateId: string; versionId: string; expectedRevision: string; requestId: string; delta: BuilderDelta;
};
export type BuilderV2Result = { ok: true; revision: string; savedAt: string } |
  { ok: false; code: "conflict" | "invalid" | "unavailable" | "retryable"; error: string };
export type BuilderV2SaveAction = (input: BuilderSaveRequest) => Promise<BuilderV2Result>;
export type BuilderPublishRequest = Omit<BuilderSaveRequest, "delta">;
export type BuilderV2PublishAction = (input: BuilderPublishRequest) => Promise<BuilderV2Result>;
// Leave room for the Server Action envelope under the existing 1 MiB transport limit.
export const BUILDER_MAX_REQUEST_BYTES = 900_000;

// Stable across object key insertion order (e.g. competencyEffects).
export function builderFingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(builderFingerprint).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${builderFingerprint(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function flattenBuilderDocument(document: BuilderDocumentInput) {
  const sections: BuilderDelta["sections"] = [];
  const questions: BuilderDelta["questions"] = [];
  const options: BuilderDelta["options"] = [];
  document.sections.forEach(({ questions: children, ...s }, i) => {
    sections.push({ ...s, orderIndex: i + 1 });
    children.forEach(({ options: answers, ...q }, j) => {
      questions.push({ ...q, sectionId: s.id, orderIndex: j + 1 });
      answers.forEach((o, k) => options.push({ ...o, questionId: q.id, orderIndex: k + 1 }));
    });
  });
  return { sections, questions, options };
}
export function diffBuilderDocument(before: BuilderDocumentInput, after: BuilderDocumentInput): BuilderDelta {
  const base = flattenBuilderDocument(before), next = flattenBuilderDocument(after);
  function changed<T extends { id: string }>(old: T[], current: T[]) {
    const byId = new Map(old.map(row => [row.id, builderFingerprint(row)]));
    return current.filter(row => byId.get(row.id) !== builderFingerprint(row));
  }
  function deleted(old: { id: string }[], current: { id: string }[]) {
    const ids = new Set(current.map(row => row.id)); return old.filter(row => !ids.has(row.id)).map(row => row.id);
  }
  return {
    version: builderFingerprint(before.version) === builderFingerprint(after.version) ? null : after.version,
    sections: changed(base.sections, next.sections), questions: changed(base.questions, next.questions),
    options: changed(base.options, next.options), deletedSections: deleted(base.sections, next.sections),
    deletedQuestions: deleted(base.questions, next.questions), deletedOptions: deleted(base.options, next.options),
  };
}
export function builderDeltaIsEmpty(delta: BuilderDelta) {
  return delta.version === null && [delta.sections, delta.questions, delta.options,
    delta.deletedSections, delta.deletedQuestions, delta.deletedOptions].every(rows => rows.length === 0);
}

// Reconstruct before domain validation. Never silently drop or steal IDs/parents.
export function applyBuilderDelta(base: BuilderDocumentInput, delta: BuilderDelta): BuilderDocumentInput {
  const flat = flattenBuilderDocument(base);
  function apply<T extends { id: string; orderIndex: number }>(rows: T[], changes: T[], deletes: string[]) {
    const map = new Map(rows.map(row => [row.id, row])); const seen = new Set<string>();
    for (const id of deletes) {
      if (seen.has(id) || !map.delete(id)) throw new Error("Удаляемый элемент не найден."); seen.add(id);
    }
    for (const row of changes) {
      if (seen.has(row.id)) throw new Error("Повторяющиеся идентификаторы элементов.");
      seen.add(row.id); map.set(row.id, row);
    }
    return [...map.values()].sort((a, b) => a.orderIndex - b.orderIndex || a.id.localeCompare(b.id));
  }
  const sections = apply(flat.sections, delta.sections, delta.deletedSections);
  const questions = apply(flat.questions, delta.questions, delta.deletedQuestions);
  const options = apply(flat.options, delta.options, delta.deletedOptions);
  if (questions.some(q => !sections.some(s => s.id === q.sectionId)) ||
    options.some(o => !questions.some(q => q.id === o.questionId))) throw new Error("Родитель элемента не найден.");
  const ordered = (rows: { orderIndex: number }[]) => rows.every((r, i) => r.orderIndex === i + 1);
  if (!ordered(sections) || sections.some(s => !ordered(questions.filter(q => q.sectionId === s.id))) ||
    questions.some(q => !ordered(options.filter(o => o.questionId === q.id)))) throw new Error("Некорректный порядок элементов.");
  function content<T extends { orderIndex: number; sectionId?: string; questionId?: string }>(row: T) {
    const { orderIndex, sectionId, questionId, ...entity } = row;
    void orderIndex; void sectionId; void questionId;
    return entity;
  }
  return { ...base, version: delta.version ?? base.version, sections: sections.map(s => ({
    id: s.id, title: s.title, description: s.description, contentBlocks: s.contentBlocks, timeLimitMinutes: s.timeLimitMinutes,
    questions: questions.filter(q => q.sectionId === s.id).map(q => ({
      ...content(q), options: options.filter(o => o.questionId === q.id).map(content),
    })),
  })) };
}
