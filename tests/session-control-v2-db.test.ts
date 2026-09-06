import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPaths = [
  "20260811120000_assessment_integrity_controls.sql",
  "20260827170000_employee_assessment_integrity_controls.sql",
  "20260906120000_assessment_session_lease_v2.sql",
];
const id = (n: number) => `f2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const client = "AAAAAAAA-0000-4000-8000-000000000001";
const device = "BBBBBBBB-0000-4000-8000-000000000001";
const hash = (token: string, value: string) => createHash("sha256").update(`${token}:${value}`).digest("hex");

test("session lease V2 executes in PostgreSQL for candidate and employee scopes", async (t) => {
  const db = new PGlite();
  try {
    await db.exec(readFileSync(new URL("./fixtures/session-control-v2.sql", import.meta.url), "utf8"));
    for (const migration of migrationPaths) {
      await db.exec(readFileSync(new URL(`../supabase/migrations/${migration}`, import.meta.url), "utf8"));
    }
    for (const scope of ["candidate", "employee"] as const) {
      const employee = scope === "employee";
      const sessions = employee ? "employee_assessment_sessions" : "test_sessions";
      const owners = employee ? "employee_assessment_participants" : "candidate_applications";
      const invitations = employee ? "employee_assessment_invitations" : "invitations";
      const events = employee ? "employee_assessment_session_events" : "assessment_session_events";
      const ownerColumn = employee ? "participant_id" : "application_id";
      const token = (employee ? "b" : "a").repeat(64);

      const invoke = async (
        operation: string,
        payload: Record<string, unknown> = {},
        overrides: { token?: string; sessionId?: string; clientId?: string; deviceId?: string; scope?: string } = {},
      ) => {
        const result = await db.query<{ result: Record<string, unknown> }>(
          "select public.control_assessment_session_lease_v2($1,$2,$3,$4,$5,$6,$7) as result",
          [overrides.scope ?? scope, overrides.token ?? token, overrides.sessionId ?? id(10),
            overrides.clientId ?? client, overrides.deviceId ?? device, operation, JSON.stringify(payload)],
        );
        return result.rows[0].result;
      };
      const claim = (overrides = {}) => invoke("claim", { clientEventId: id(20) }, overrides);
      const session = async () => (await db.query<Record<string, unknown>>(`select * from public.${sessions} where id = $1`, [id(10)])).rows[0];
      const journal = async () => (await db.query<Record<string, unknown>>(`select * from public.${events} order by id`)).rows;

      await db.exec("begin");
      await db.query("insert into public.companies values ($1), ($2)", [id(1), id(2)]);
      await db.query(`insert into public.${owners} (id, company_id) values ($1, $3), ($2, $4)`, [id(3), id(4), id(1), id(2)]);
      await db.query(`insert into public.${invitations} (id, company_id, ${ownerColumn}, token, status, expires_at)
        values ($1, $2, $3, $4, 'started', clock_timestamp() + interval '1 day')`, [id(5), id(1), id(3), token]);
      await db.query("insert into public.test_versions values ($1, 30, 'published'), ($2, 30, 'published')", [id(6), id(7)]);
      await db.query("insert into public.test_sections values ($1, $3), ($2, $4)", [id(8), id(9), id(6), id(7)]);
      await db.query("insert into public.questions values ($1, $3), ($2, $4)", [id(11), id(12), id(8), id(9)]);
      await db.query(`insert into public.${sessions} (id, ${ownerColumn}, test_version_id, status, started_at)
        values ($1, $2, $3, 'in_progress', clock_timestamp())`, [id(10), id(3), id(6)]);

      // Each case starts with the same unclaimed active session.
      const scenario = async (name: string, run: () => Promise<void>) => {
        await t.test(`${scope}: ${name}`, async () => {
          await db.exec("savepoint scenario");
          try { await run(); }
          finally { await db.exec("rollback to savepoint scenario"); }
        });
      };

      await scenario("claim backfills deadline and preserves V1 hashes including UUID case", async () => {
        const response = await claim();
        assert.deepEqual(Object.keys(response).sort(), ["deadlineAt", "status"]);
        assert.equal(response.status, "active");
        const row = await session();
        assert.equal(row.active_client_id_hash, hash(token, client));
        assert.equal(row.active_device_id_hash, hash(token, device));
        assert.equal(Number(row.deadline_at) - Number(row.started_at), 30 * 60_000);
        assert.equal(Number(row.lease_expires_at) - Number(row.last_heartbeat_at), 90_000);
        assert.deepEqual(await journal(), []);
        assert.equal((await invoke("heartbeat")).status, "active");
      });

      await scenario("unclaimed heartbeat cannot acquire ownership", async () => {
        assert.deepEqual(await invoke("heartbeat"), { status: "blocked", retryAfterSeconds: 90 });
        assert.equal((await session()).active_client_id_hash, null);
      });

      await scenario("second client is blocked, duplicate claim event is idempotent", async () => {
        await claim();
        const before = await session();
        for (let i = 0; i < 2; i += 1) {
          assert.deepEqual(await claim({ clientId: id(30) }), { status: "blocked", retryAfterSeconds: 90 });
        }
        assert.deepEqual(await session(), before);
        const rows = await journal();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].event_type, "concurrent_session_blocked");
        assert.deepEqual(rows[0].metadata, { sameDevice: true });
        assert.equal(rows[0].company_id, id(1));
        assert.equal(rows[0][ownerColumn], id(3));
      });

      await scenario("expired lease can be taken over and the former client loses access", async () => {
        await claim();
        await db.exec(`update public.${sessions} set lease_expires_at = clock_timestamp() - interval '1 second'`);
        assert.equal((await claim({ clientId: id(30), deviceId: id(31) })).status, "active");
        const before = await session();
        assert.equal((await invoke("heartbeat")).status, "blocked");
        assert.equal((await invoke("event", { clientEventId: id(21), eventType: "focus_lost" })).status, "blocked");
        assert.deepEqual(await session(), before);
        const rows = await journal();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].event_type, "session_recovered");
        assert.deepEqual(rows[0].metadata, { changedDevice: true });
      });

      await scenario("same owner may renew an expired lease, wrong device may not", async () => {
        await claim();
        await db.exec(`update public.${sessions} set lease_expires_at = clock_timestamp() - interval '1 second'`);
        assert.equal((await invoke("heartbeat", {}, { deviceId: id(31) })).status, "blocked");
        assert.equal((await invoke("heartbeat")).status, "active");
      });

      await scenario("events sanitize metadata, clamp duration and deduplicate retries", async () => {
        await claim();
        const payload = { clientEventId: id(21), eventType: "focus_returned", questionId: id(11),
          clientOccurredAt: "2026-09-06T10:00:00.000Z", metadata: { durationMs: 1e9, text: "must not persist" } };
        await invoke("event", payload);
        await invoke("event", payload);
        assert.equal((await journal()).length, 1);
        assert.deepEqual((await journal())[0].metadata, { durationMs: 86_400_000 });
        for (const [duration, expected] of [[12.5, 13], [-10, 0], ["42", null]] as const) {
          await invoke("event", { ...payload, clientEventId: id(40 + (expected ?? 2)), metadata: { durationMs: duration } });
          const last = (await journal()).at(-1)!;
          assert.deepEqual(last.metadata, expected === null ? {} : { durationMs: expected });
        }
        await invoke("event", { ...payload, clientEventId: id(25), eventType: "clipboard_copy" });
        assert.deepEqual((await journal()).at(-1)!.metadata, {});
      });

      await scenario("foreign question and reserved event are rejected without renewing lease", async () => {
        await claim();
        const before = await session();
        // PostgreSQL aborts a transaction on statement error, so isolate each rejection.
        for (const payload of [
          { clientEventId: id(21), eventType: "focus_lost", questionId: id(12) },
          { clientEventId: id(21), eventType: "timer_expired" },
          { eventType: "focus_lost" },
        ]) {
          await db.exec("savepoint rejection");
          await assert.rejects(invoke("event", payload));
          await db.exec("rollback to savepoint rejection");
          assert.deepEqual(await session(), before);
          assert.deepEqual(await journal(), []);
        }
      });

      await scenario("event insert failure rolls back the lease update in the same transaction", async () => {
        await claim();
        const before = await session();
        await db.exec(`alter table public.${events} add constraint test_reject_event check (event_type <> 'focus_lost')`);
        await db.exec("savepoint rejection");
        await assert.rejects(invoke("event", { clientEventId: id(21), eventType: "focus_lost" }));
        await db.exec("rollback to savepoint rejection");
        assert.deepEqual(await session(), before);
        assert.deepEqual(await journal(), []);
      });

      await scenario("expired deadline cannot renew a lease or write an event", async () => {
        await claim();
        await db.exec(`update public.${sessions} set deadline_at = clock_timestamp() - interval '1 second'`);
        const before = await session();
        assert.deepEqual(await claim(), { status: "expired" });
        assert.deepEqual(await invoke("heartbeat"), { status: "expired" });
        assert.deepEqual(await invoke("event", { clientEventId: id(21), eventType: "focus_lost" }), { status: "expired" });
        assert.deepEqual(await session(), before);
        assert.deepEqual(await journal(), []);
      });

      await scenario("legacy missing deadline is derived before expiration check", async () => {
        await db.exec(`update public.${sessions} set started_at = clock_timestamp() - interval '31 minutes'`);
        assert.deepEqual(await claim(), { status: "expired" });
        assert.equal((await session()).active_client_id_hash, null);
        assert.ok((await session()).deadline_at);
      });

      await scenario("invalid token, identity, scope mismatch and foreign session cannot mutate state", async () => {
        const before = await session();
        for (const override of [
          { token: "bad-token" }, { token: "d".repeat(64) }, { clientId: "bad-client" },
          { deviceId: "bad-device" }, { sessionId: id(99) }, { scope: employee ? "candidate" : "employee" },
        ]) assert.deepEqual(await claim(override), { status: "unavailable" });
        await db.query(`update public.${sessions} set ${ownerColumn} = $1`, [id(4)]);
        assert.deepEqual(await claim(), { status: "unavailable" });
        await db.query(`update public.${sessions} set ${ownerColumn} = $1`, [id(3)]);
        assert.deepEqual(await session(), before);
      });

      await scenario("inactive, expired and company-mismatched invitations are rejected", async () => {
        for (const status of ["sent", "completed", "cancelled", "expired"]) {
          await db.query(`update public.${invitations} set status = $1`, [status]);
          assert.deepEqual(await claim(), { status: "unavailable" });
        }
        await db.exec(`update public.${invitations} set status = 'started', expires_at = clock_timestamp() - interval '1 second'`);
        assert.deepEqual(await claim(), { status: "unavailable" });
        await db.query(`update public.${invitations} set expires_at = null, company_id = $1`, [id(2)]);
        assert.deepEqual(await claim(), { status: "unavailable" });
        assert.equal((await session()).active_client_id_hash, null);
      });

      await scenario("completed, cancelled and not-started sessions cannot be reopened", async () => {
        for (const status of ["completed", "cancelled", "not_started"]) {
          await db.query(`update public.${sessions} set status = $1`, [status]);
          assert.deepEqual(await claim(), { status: "terminal" });
          assert.equal((await session()).active_client_id_hash, null);
        }
      });

      await scenario("RPC is server-only with an empty search_path", async () => {
        const signature = "public.control_assessment_session_lease_v2(text,text,uuid,text,text,text,jsonb)";
        for (const role of ["anon", "authenticated"]) {
          const privileges = await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2,'execute') as allowed", [role, signature]);
          assert.equal(privileges.rows[0].allowed, false);
          await db.exec("savepoint denied_role");
          await db.exec(`set local role ${role}`);
          await assert.rejects(claim(), /permission denied for function/);
          await db.exec("rollback to savepoint denied_role");
        }
        await db.exec("set local role service_role");
        assert.equal((await claim()).status, "active");
        await db.exec("reset role");
        const config = await db.query<{ prosecdef: boolean; proconfig: string[] }>("select prosecdef, proconfig from pg_proc where oid = $1::regprocedure", [signature]);
        assert.equal(config.rows[0].prosecdef, true);
        assert.deepEqual(config.rows[0].proconfig, ['search_path=""']);
      });
      await db.exec("rollback");
    }
  } finally {
    await db.close();
  }
});
