import type { PrefetchedSection } from "./section-prefetch-contract";

export type SectionPrefetchRequest = {
  assessmentType: "candidate" | "employee"; token: string; sessionId: string; sectionIndex: number;
};
const TTL_MS = 5 * 60_000;
const MAX_BYTES = 1_048_576;
const key = (input: SectionPrefetchRequest) => JSON.stringify([input.assessmentType, input.token, input.sessionId, input.sectionIndex]);

// Owned by ONE mounted test controller. Never shared between sessions, persisted,
// or allowed to hold more than one section. Failures do not affect normal reads.
export class SectionPrefetchCache {
  private pending: AbortController | null = null;
  private entry: { key: string; value: PrefetchedSection; expiresAt: number } | null = null;
  private readonly transport: typeof fetch;
  private readonly now: () => number;
  constructor(transport: typeof fetch = fetch, now = Date.now) { this.transport = transport; this.now = now; }

  clear() { this.abortPending(); this.entry = null; }
  abortPending() { this.pending?.abort(); this.pending = null; }

  async start(input: SectionPrefetchRequest): Promise<void> {
    this.clear();
    const controller = new AbortController();
    this.pending = controller;
    try {
      const response = await this.transport("/api/assessment/section-prefetch", {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      if (!response.ok || Number(response.headers.get("content-length")) > MAX_BYTES) return;
      const body = await response.text();
      if (controller.signal.aborted || this.pending !== controller || new TextEncoder().encode(body).length > MAX_BYTES) return;
      const value = JSON.parse(body) as PrefetchedSection | null;
      if (!value?.section || !value.versionId || value.sectionIndex !== input.sectionIndex + 1) return;
      this.entry = { key: key(input), value, expiresAt: this.now() + TTL_MS };
    } catch { /* Speculative work is best effort. Navigation always has a full-read path. */ }
    finally { if (this.pending === controller) this.pending = null; }
  }

  ready(input: SectionPrefetchRequest, targetIndex: number): PrefetchedSection | undefined {
    if (this.entry && this.entry.expiresAt <= this.now()) this.entry = null;
    return this.entry?.key === key(input) && this.entry.value.sectionIndex === targetIndex ? this.entry.value : undefined;
  }
}
