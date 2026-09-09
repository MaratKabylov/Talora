import { createHash } from "node:crypto";

export const COMPARISON_PAGE_SIZE = 50;
export type ComparisonPageFilters = {
  status: string; recommendation: string; riskLevel: string; sort: "fit_asc" | "fit_desc";
  department?: string; roleTitle?: string;
};
type Cursor = { scope: string; id: string; score: number | null };

function scopeKey(companyId: string, parentId: string, filters: ComparisonPageFilters) {
  return createHash("sha256").update(JSON.stringify([
    companyId, parentId, filters.status, filters.recommendation, filters.riskLevel,
    filters.sort, filters.department ?? "", filters.roleTitle ?? "",
  ])).digest("hex");
}

export function comparisonPage(companyId: string, parentId: string, filters: ComparisonPageFilters, token?: string) {
  const scope = scopeKey(companyId, parentId, filters);
  let cursor: Cursor | null = null;
  if (token && token.length <= 1024 && /^[A-Za-z0-9_-]+$/.test(token)) {
    try {
      const value: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
      if (value && typeof value === "object" && "scope" in value && value.scope === scope &&
          "id" in value && typeof value.id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) &&
          "score" in value && (value.score === null || (typeof value.score === "number" && Number.isFinite(value.score) && value.score >= 0 && value.score <= 100))) {
        cursor = value as Cursor;
      }
    } catch { /* Invalid or stale cursor starts a fresh page. */ }
  }
  const ascending = filters.sort === "fit_asc";
  const predicate = !cursor ? null : cursor.score === null
    ? `and(fit_score.is.null,id.gt.${cursor.id})`
    : `fit_score.${ascending ? "gt" : "lt"}.${cursor.score},and(fit_score.eq.${cursor.score},id.gt.${cursor.id}),fit_score.is.null`;
  return {
    ascending, predicate,
    finish<T extends { id: string; fit_score: number | null }>(rows: T[]) {
      const items = rows.slice(0, COMPARISON_PAGE_SIZE);
      const last = items.at(-1);
      return {
        items,
        nextCursor: rows.length > COMPARISON_PAGE_SIZE && last
          ? Buffer.from(JSON.stringify({ scope, id: last.id, score: last.fit_score })).toString("base64url") : null,
      };
    },
  };
}

export const DEFAULT_COMPARISON_FILTERS: ComparisonPageFilters = {
  status: "", recommendation: "", riskLevel: "", sort: "fit_desc",
};
