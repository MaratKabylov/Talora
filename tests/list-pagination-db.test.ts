import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listPage } from "../lib/lists/pagination.ts";

test("date keyset traverses PostgreSQL ties and microseconds without duplicates or gaps, with filters before limit", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table list_rows(id uuid primary key, company_id int, status text, created_at timestamptz not null);
      insert into list_rows
      select ('fa100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
        case when n % 5 = 0 then 2 else 1 end,
        case when n % 3 = 0 then 'archived' else 'active' end,
        '2026-09-09T00:00:00Z'::timestamptz + (n % 7) * interval '1 microsecond'
      from generate_series(1, 1507) n;`);
    for (const sort of ["date_asc", "date_desc"]) {
      for (const pageSize of ["1", "50", "100"]) {
        let cursor: string | undefined;
        const seen: string[] = [];
        do {
          const page = listPage(["fixture", "1"], "created_at", { sort, pageSize, status: "active", cursor });
          // Compile only the validated keyset predicate, preserving six fractional digits.
          const predicate = page.predicate?.replace(/created_at\.(gt|lt|eq)\.([^,)]+)/g,
            (_, op: "gt" | "lt" | "eq", value: string) => `created_at ${{ gt: ">", lt: "<", eq: "=" }[op]} '${value}'::timestamptz`)
            .replace(/id\.gt\.([a-f0-9-]+)/g, "id > '$1'::uuid")
            .replace(/and\(([^,]+),([^()]+)\)/g, "($1 and $2)").replaceAll(",", " or ");
          const rows = (await db.query<{ id: string; created_at: string }>(`
            select id, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
            from list_rows where company_id = 1 and status = 'active' ${predicate ? `and (${predicate})` : ""}
            order by list_rows.created_at ${page.ascending ? "asc" : "desc"}, id asc limit ${page.filters.pageSize + 1}`)).rows;
          const result = page.finish(rows);
          assert.ok(result.items.length <= Number(pageSize));
          seen.push(...result.items.map(row => row.id)); cursor = result.nextCursor ?? undefined;
          assert.ok(seen.length <= 1507, "cursor must advance");
        } while (cursor);
        const expected = (await db.query<{ id: string }>(`select id from list_rows where company_id = 1 and status = 'active'
          order by created_at ${sort === "date_asc" ? "asc" : "desc"}, id asc`)).rows.map(row => row.id);
        assert.deepEqual(seen, expected); assert.equal(new Set(seen).size, expected.length);
      }
    }
  } finally { await db.close(); }
});
