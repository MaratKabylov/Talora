import { createHash } from "node:crypto";

export type ListParams = {
  cursor?: string; sort?: string; pageSize?: string; q?: string; status?: string;
  company?: string; review?: string; kind?: string;
};
export type ListPage<T> = { items: T[]; nextCursor: string | null; hasCursor: boolean; pageSize: number };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const scalar = (value: unknown, max = 200) => typeof value === "string" ? value.trim().slice(0, max) : "";

function validTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !timestamp.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return month >= 1 && month <= 12 && day >= 1 && day <= maxDay;
}

export function normalizeListParams(params: ListParams = {}) {
  const size = Number(scalar(params.pageSize));
  const company = scalar(params.company);
  return {
    q: scalar(params.q), status: scalar(params.status, 50),
    company: company ? (uuid.test(company) ? company : "00000000-0000-0000-0000-000000000000") : "",
    review: params.review === "true", kind: params.kind === "system" || params.kind === "company" ? params.kind : "",
    sort: params.sort === "date_asc" ? "date_asc" : "date_desc",
    pageSize: Number.isInteger(size) && size > 0 ? Math.min(size, 100) : 50,
  };
}

// Only trusted callers choose column names; URL values never become SQL identifiers.
type Query = {
  order(column: string, options: { ascending: boolean }): unknown;
  limit(count: number): unknown;
  or(filters: string): unknown;
  eq(column: string, value: string | boolean): unknown;
  ilike(column: string, pattern: string): unknown;
};
// Narrow boundary for untyped PostgREST reads until generated database types exist.
// Avoid recursively instantiating the fluent Supabase builder at each list call.
export interface ListReadQuery extends Query, PromiseLike<{ data: unknown[] | null; error: unknown }> {
  select(columns: string): ListReadQuery;
}
type FilterColumns = { search?: string; status?: string; company?: string; review?: string; kind?: string };

export function listPage<C extends "created_at" | "updated_at">(scopeParts: string[], column: C, params: ListParams = {}) {
  const filters = normalizeListParams(params);
  const scope = createHash("sha256").update(JSON.stringify([scopeParts, column, filters])).digest("hex");
  let cursor: { id: string; value: string } | null = null;
  if (typeof params.cursor === "string" && params.cursor.length <= 1024 && /^[A-Za-z0-9_-]+$/.test(params.cursor)) {
    try {
      const parsed = JSON.parse(Buffer.from(params.cursor, "base64url").toString("utf8"));
      if (parsed?.scope === scope && typeof parsed.id === "string" && uuid.test(parsed.id) &&
          validTimestamp(parsed.value)) {
        cursor = parsed;
      }
    } catch { /* Malformed or stale cursors start at the first page. */ }
  }
  const ascending = filters.sort === "date_asc";
  const predicate = cursor
    ? `${column}.${ascending ? "gt" : "lt"}.${cursor.value},and(${column}.eq.${cursor.value},id.gt.${cursor.id})`
    : null;
  return {
    filters, predicate, ascending,
    apply(query: Query & PromiseLike<{ data: unknown[] | null; error: unknown }>, columns: FilterColumns = {}) {
      if (columns.search && filters.q) query.ilike(columns.search, `%${filters.q.replace(/[\\%_]/g, "\\$&")}%`);
      if (columns.status && filters.status) query.eq(columns.status, filters.status);
      if (columns.company && filters.company) query.eq(columns.company, filters.company);
      if (columns.review && filters.review) query.eq(columns.review, true);
      if (columns.kind && filters.kind) query.eq(columns.kind, filters.kind === "system");
      if (predicate) query.or(predicate);
      query.order(column, { ascending });
      query.order("id", { ascending: true });
      query.limit(filters.pageSize + 1);
      return query;
    },
    finish<T extends { id: string } & Record<C, string>, R = T>(rows: T[], map: (row: T) => R = (row) => row as unknown as R): ListPage<R> {
      const items = rows.slice(0, filters.pageSize);
      const last = items.at(-1);
      return {
        items: items.map(map), pageSize: filters.pageSize, hasCursor: cursor !== null,
        nextCursor: rows.length > filters.pageSize && last
          ? Buffer.from(JSON.stringify({ scope, id: last.id, value: last[column] })).toString("base64url") : null,
      };
    },
  };
}
