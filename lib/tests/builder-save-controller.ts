import type { BuilderDocumentInput } from "./builder-document-schema";
import { BUILDER_MAX_REQUEST_BYTES, builderDeltaIsEmpty, diffBuilderDocument, type BuilderSaveRequest, type BuilderV2SaveAction } from "./builder-delta";

export type BuilderSaveState = { status: "idle" | "dirty" | "saving" | "saved" | "error" | "conflict"; message: string };
export function createBuilderSaveController(config: {
  initial: BuilderDocumentInput; revision: string;
  save: BuilderV2SaveAction; onState: (state: BuilderSaveState) => void;
  requestId?: () => string; wait?: (ms: number) => Promise<void>;
}) {
  let acknowledged = config.initial, revision = config.revision;
  let getDocument = () => config.initial;
  let pending: { request: BuilderSaveRequest; document: BuilderDocumentInput } | null = null;
  let inFlight: Promise<boolean> | null = null;
  let disposed = false, conflict = false, dirty = false;
  const emit = (status: BuilderSaveState["status"], message = "") => { if (!disposed) config.onState({ status, message }); };
  const wait = config.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  async function drain() {
    while (!disposed && !conflict) {
      if (!pending) {
        const document = getDocument();
        const delta = diffBuilderDocument(acknowledged, document);
        if (builderDeltaIsEmpty(delta)) { dirty = false; emit("saved", "Все изменения сохранены."); return true; }
        pending = { document, request: { templateId: document.templateId, versionId: document.versionId,
          expectedRevision: revision, requestId: (config.requestId ?? (() => crypto.randomUUID()))(), delta } };
        if (new TextEncoder().encode(JSON.stringify(pending.request)).byteLength > BUILDER_MAX_REQUEST_BYTES) {
          pending = null;
          emit("error", "Пакет изменений слишком большой. Скачайте локальную копию и сохраняйте новые секции небольшими порциями.");
          return false;
        }
      }
      emit("saving", "Сохраняем…");
      let confirmed = false;
      for (let attempt = 0; attempt < 3 && !disposed; attempt++) {
        let result;
        try { result = await config.save(pending.request); }
        catch { result = { ok: false as const, code: "retryable" as const, error: "Нет подтверждения сохранения. Проверьте соединение и повторите." }; }
        if (disposed) return false;
        if (result.ok) {
          if (!/^(0|[1-9]\d{0,18})$/.test(result.revision) || BigInt(result.revision) !== BigInt(revision) + BigInt(1)) {
            emit("error", "Некорректное подтверждение сохранения. Повторите попытку."); return false;
          }
          acknowledged = pending.document; revision = result.revision; pending = null; confirmed = true; break;
        }
        if (result.code === "conflict") { conflict = true; emit("conflict", result.error); return false; }
        if (result.code === "invalid") { pending = null; emit("error", result.error); return false; }
        if (result.code !== "retryable" || attempt === 2) { emit("error", result.error); return false; }
        await wait(500 * 2 ** attempt);
      }
      if (!confirmed) return false;
      // Edits made during the request are compared to the ACK, never discarded.
    }
    return false;
  }
  return {
    changed() { dirty = true; if (!inFlight && !conflict) emit("dirty"); },
    revision: () => revision,
    hasUnsaved: () => dirty || pending !== null || inFlight !== null,
    flush(readDocument: () => BuilderDocumentInput) {
      getDocument = readDocument;
      if (inFlight) return inFlight;
      if (disposed || conflict) return Promise.resolve(false);
      inFlight = drain().finally(() => { inFlight = null; }); return inFlight;
    },
    dispose() { disposed = true; },
    resume() { disposed = false; },
  };
}
