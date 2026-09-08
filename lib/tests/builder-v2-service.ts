import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeRichTextValue } from "@/lib/rich-text.server";
import { normalizeVersion, type VersionRecord } from "./data";
import { normalizeBuilderSections, type SectionRecord } from "./builder-data";
import { serializeBuilderDocument } from "./builder-serialize";
import { builderDocumentSchema, type BuilderDocumentInput } from "./builder-document-schema";
import { BUILDER_MAX_REQUEST_BYTES, applyBuilderDelta, builderFingerprint, type BuilderV2Result } from "./builder-delta";
import { builderPublishRequestSchema, builderSaveRequestSchema } from "./builder-v2-schema";
import { buildStorageDelta } from "./builder-storage-delta";
import { validateRemediationLinks } from "./remediation";
import { validateQuestionsForPublication, type PublicationSection, type PublicationScoringVersion } from "./publication-validation";
import { formatTestVersionTitle } from "./version-title";

export const builderSaveV2Enabled = () => process.env.BUILDER_SAVE_V2 === "true";
export type BuilderActor = { userId: string; companyId: string | null };
type Snapshot = { revision: string; version: VersionRecord & PublicationScoringVersion; sections: SectionRecord[] & PublicationSection[];
  receipt: { last_request_id: string; last_actor_id: string; last_revision: string; last_expected_revision: string;
    client_payload_hash: string; saved_at: string; publication_request_id: string; published_from_revision: string } | null };
const failure = (code: "conflict" | "invalid" | "unavailable" | "retryable", error: string): BuilderV2Result => ({ ok: false, code, error });
export const builderConflict = () => failure("conflict", "Черновик изменён в другой вкладке. Скачайте локальные изменения, затем обновите страницу и перенесите нужные правки. Автоматическая перезапись отключена.");
const unavailable = () => failure("unavailable", "Сохранение V2 недоступно. Изменения остались в редакторе; скачайте копию и обратитесь к администратору.");
function databaseFailure(error: unknown): BuilderV2Result {
  const code = error && typeof error === "object" && "code" in error ? error.code : null;
  if (code === "40001") return builderConflict();
  if (code === "42501" || code === "55000" || code === "PGRST202" || code === "42P01") return unavailable();
  if (typeof code === "string" && (code.startsWith("22") || code.startsWith("23"))) return failure("invalid", "Не удалось сохранить пакет. Проверьте содержание теста.");
  return failure("retryable", "Нет подтверждения сохранения. Проверьте соединение и повторите попытку.");
}
const identity = (actor: BuilderActor, templateId: string, versionId: string) => ({
  target_template_id: templateId, target_version_id: versionId, acting_user_id: actor.userId, target_company_id: actor.companyId,
});
export async function readBuilderSnapshot(actor: BuilderActor, templateId: string, versionId: string): Promise<Snapshot> {
  const { data, error } = await createAdminClient().rpc("read_builder_snapshot_v2", identity(actor, templateId, versionId));
  if (error) throw error;
  if (!data || !/^\d+$/.test(data.revision) || !Array.isArray(data.sections) || data.version?.id !== versionId) {
    throw new Error("Invalid builder snapshot");
  }
  return data as Snapshot;
}
export function builderSnapshotEditorData(snapshot: Snapshot) {
  return { revision: snapshot.revision, version: normalizeVersion(snapshot.version), sections: normalizeBuilderSections(snapshot.sections) };
}
function snapshotDocument(snapshot: Snapshot, templateId: string): BuilderDocumentInput {
  const data = builderSnapshotEditorData(snapshot);
  return serializeBuilderDocument(data.sections, { description: data.version.description ?? "", instructions: data.version.instructions ?? "",
    durationMinutes: data.version.durationMinutes?.toString() ?? "", presentationSettings: data.version.presentationSettings,
    scoringType: data.version.scoringType }, templateId, data.version.id, formatTestVersionTitle(data.version.versionNumber));
}
function sanitizeDocument(document: BuilderDocumentInput): BuilderDocumentInput {
  return { ...document, version: { ...document.version, description: sanitizeRichTextValue(document.version.description),
    instructions: sanitizeRichTextValue(document.version.instructions) }, sections: document.sections.map(s => ({ ...s,
    description: sanitizeRichTextValue(s.description), contentBlocks: s.contentBlocks.map(b => ({ ...b, description: sanitizeRichTextValue(b.description) })),
    questions: s.questions.map(q => ({ ...q, description: sanitizeRichTextValue(q.description) })),
  })) };
}
export async function saveBuilderV2(actor: BuilderActor, input: unknown): Promise<BuilderV2Result> {
  if (!builderSaveV2Enabled()) return unavailable();
  const parsed = builderSaveRequestSchema.safeParse(input);
  if (!parsed.success) return failure("invalid", parsed.error.issues[0]?.message ?? "Проверьте изменения.");
  const request = parsed.data;
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > BUILDER_MAX_REQUEST_BYTES) {
    return failure("invalid", "Пакет изменений слишком большой. Сохраняйте новые секции небольшими порциями.");
  }
  const hash = createHash("sha256").update(builderFingerprint(request.delta)).digest("hex");
  try {
    const snapshot = await readBuilderSnapshot(actor, request.templateId, request.versionId);
    if (snapshot.version.status !== "draft") return builderConflict();
    const receipt = snapshot.receipt;
    // Resolve a lost ACK BEFORE reconstructing a delta against a now newer base.
    if (receipt?.last_request_id === request.requestId) {
      if (receipt.last_actor_id !== actor.userId || receipt.last_expected_revision !== request.expectedRevision || receipt.client_payload_hash !== hash) {
        return failure("invalid", "Идентификатор запроса уже использован. Изменения не перезаписаны.");
      }
      if (receipt.last_revision === snapshot.revision) return { ok: true, revision: snapshot.revision, savedAt: receipt.saved_at };
    }
    if (snapshot.revision !== request.expectedRevision) return builderConflict();
    const base = snapshotDocument(snapshot, request.templateId);
    let assembled;
    try { assembled = applyBuilderDelta(base, request.delta); }
    catch (error) { return failure("invalid", error instanceof Error ? error.message : "Некорректный пакет."); }
    const validated = builderDocumentSchema.safeParse(assembled);
    if (!validated.success) return failure("invalid", validated.error.issues[0]?.message ?? "Проверьте содержание теста.");
    const next = sanitizeDocument(validated.data);
    next.version.title = formatTestVersionTitle(snapshot.version.version_number);
    const remediationError = validateRemediationLinks(next.sections);
    if (remediationError) return failure("invalid", remediationError);
    const { data, error } = await createAdminClient().rpc("commit_builder_delta_v2", {
      ...identity(actor, request.templateId, request.versionId), expected_revision: request.expectedRevision,
      request_id: request.requestId, client_payload_hash: hash, delta: buildStorageDelta(base, next, snapshot.sections),
    });
    if (error) return databaseFailure(error);
    if (!data || !/^\d+$/.test(data.revision) || typeof data.savedAt !== "string") return databaseFailure(null);
    return { ok: true, revision: data.revision, savedAt: data.savedAt };
  } catch (error) { return databaseFailure(error); }
}
export async function publishBuilderV2(actor: BuilderActor, input: unknown): Promise<BuilderV2Result> {
  if (!builderSaveV2Enabled()) return unavailable();
  const parsed = builderPublishRequestSchema.safeParse(input);
  if (!parsed.success) return failure("invalid", "Некорректный запрос публикации.");
  const request = parsed.data;
  try {
    const snapshot = await readBuilderSnapshot(actor, request.templateId, request.versionId);
    const receipt = snapshot.receipt;
    if (snapshot.version.status === "published" && receipt?.publication_request_id === request.requestId &&
      receipt.last_actor_id === actor.userId && receipt.published_from_revision === request.expectedRevision &&
      BigInt(snapshot.revision) === BigInt(request.expectedRevision) + BigInt(1)) {
      return { ok: true, revision: snapshot.revision, savedAt: snapshot.version.published_at ?? "" };
    }
    if (snapshot.version.status !== "draft" || snapshot.revision !== request.expectedRevision) return builderConflict();
    if (!snapshot.version.duration_minutes) return failure("invalid", "Перед публикацией укажите длительность теста.");
    const content = builderDocumentSchema.safeParse(snapshotDocument(snapshot, request.templateId));
    if (!content.success) return failure("invalid", content.error.issues[0]?.message ?? "Проверьте содержание теста.");
    const validationError = validateRemediationLinks(content.data.sections) || validateQuestionsForPublication(snapshot.sections, snapshot.version);
    if (validationError) return failure("invalid", validationError);
    const { data, error } = await createAdminClient().rpc("publish_builder_version_v2", {
      ...identity(actor, request.templateId, request.versionId), expected_revision: request.expectedRevision,
      request_id: request.requestId, version_title: formatTestVersionTitle(snapshot.version.version_number),
    });
    if (error) return databaseFailure(error);
    if (!data?.published || !/^\d+$/.test(data.revision)) return databaseFailure(null);
    return { ok: true, revision: data.revision, savedAt: new Date().toISOString() };
  } catch (error) { return databaseFailure(error); }
}

// Explicit publication from a version card has no local editor buffer to flush.
export async function publishCurrentBuilderV2(actor: BuilderActor, templateId: string, versionId: string): Promise<BuilderV2Result> {
  if (!builderSaveV2Enabled()) return unavailable();
  try {
    const snapshot = await readBuilderSnapshot(actor, templateId, versionId);
    return publishBuilderV2(actor, { templateId, versionId, expectedRevision: snapshot.revision, requestId: randomUUID() });
  } catch (error) { return databaseFailure(error); }
}
