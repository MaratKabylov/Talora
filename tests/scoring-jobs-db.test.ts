import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL(
  "../supabase/migrations/20260912160000_perf015_async_scoring_jobs.sql",
  import.meta.url,
), "utf8");
const verification = readFileSync(new URL(
  "../supabase/verification/perf015_async_scoring_jobs.sql",
  import.meta.url,
), "utf8");
const id = (n: number) => `fd000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function scalar<T>(db: PGlite, sql: string): Promise<T> {
  const result = await db.query<{ result: T }>(sql);
  return result.rows[0]!.result;
}

test("durable scoring jobs deduplicate, lease, retry and commit final state atomically", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role bypassrls;
      grant usage on schema public to anon, authenticated, service_role;
      create table public.companies (id uuid primary key);
      create function public.is_company_member(uuid) returns boolean language sql stable as 'select false';
      create table public.candidate_applications (
        id uuid primary key, company_id uuid not null references public.companies,
        status text not null default 'in_progress', current_stage text default 'assessment',
        scoring_revision integer not null default 0, completed_at timestamptz,
        updated_at timestamptz not null default now()
      );
      create table public.employee_assessment_participants (
        id uuid primary key, company_id uuid not null references public.companies,
        status text not null default 'in_progress', current_stage text default 'assessment',
        scoring_revision integer not null default 0, completed_at timestamptz,
        updated_at timestamptz not null default now()
      );
      create table public.invitations (
        id uuid primary key, company_id uuid not null references public.companies,
        application_id uuid not null references public.candidate_applications,
        status text not null
      );
      create table public.employee_assessment_invitations (
        id uuid primary key, company_id uuid not null references public.companies,
        participant_id uuid not null references public.employee_assessment_participants,
        status text not null
      );
      create table public.test_sessions (
        id uuid primary key, application_id uuid not null references public.candidate_applications,
        status text not null
      );
      create table public.employee_assessment_sessions (
        id uuid primary key, participant_id uuid not null references public.employee_assessment_participants,
        status text not null
      );
      create table public.test_scoring_snapshots (
        scope text not null, parent_id uuid not null, revision integer not null, snapshot jsonb not null
      );
      create function public.try_persist_scoring_snapshot(
        p_scope text, p_parent_id uuid, p_expected_revision integer, p_snapshot jsonb, p_audit jsonb default null
      ) returns jsonb language plpgsql security definer set search_path = '' as $$
      declare affected integer; next_revision integer := p_expected_revision + 1;
      begin
        if p_scope = 'candidate' then
          update public.candidate_applications set scoring_revision = next_revision
          where id = p_parent_id and scoring_revision = p_expected_revision;
        else
          update public.employee_assessment_participants set scoring_revision = next_revision
          where id = p_parent_id and scoring_revision = p_expected_revision;
        end if;
        get diagnostics affected = row_count;
        if affected <> 1 then return jsonb_build_object('conflict', true, 'revision', p_expected_revision); end if;
        insert into public.test_scoring_snapshots values (p_scope, p_parent_id, next_revision, p_snapshot);
        return jsonb_build_object('conflict', false, 'revision', next_revision, 'audit_id', null);
      end; $$;
    `);
    await db.exec(migration);
    await db.exec(`
      insert into public.companies values ('${id(1)}'), ('${id(2)}');
      insert into public.candidate_applications(id,company_id) values
        ('${id(10)}','${id(1)}'), ('${id(11)}','${id(2)}'), ('${id(12)}','${id(1)}');
      insert into public.invitations values
        ('${id(20)}','${id(1)}','${id(10)}','started'),
        ('${id(21)}','${id(2)}','${id(11)}','started'),
        ('${id(22)}','${id(1)}','${id(12)}','started');
      insert into public.test_sessions values
        ('${id(30)}','${id(10)}','completed'), ('${id(31)}','${id(11)}','completed'),
        ('${id(32)}','${id(12)}','completed');
    `);

    await db.exec("set role service_role");
    const first = await scalar<{ status: string; jobId: string }>(db,
      `select public.enqueue_scoring_job('candidate','${id(10)}','${id(20)}',false) result`);
    await db.exec("reset role");
    assert.equal(first.status, "queued");
    assert.equal((await scalar<{ status: string }>(db,
      `select public.enqueue_scoring_job('candidate','${id(10)}','${id(20)}',false) result`)).status, "processing");
    assert.equal(await scalar<number>(db, "select count(*)::integer result from public.scoring_jobs"), 1);
    await assert.rejects(scalar(db,
      `select public.enqueue_scoring_job('candidate','${id(10)}','${id(21)}',false) result`), /not found/);

    const worker = id(90);
    const claimed = await scalar<Array<{ jobId: string; attempt: number }>>(db,
      `select public.claim_scoring_jobs('${worker}',1,300) result`);
    assert.deepEqual(claimed.map((job) => job.attempt), [1]);
    assert.equal(claimed[0]!.jobId, first.jobId);
    assert.deepEqual(await scalar<unknown[]>(db,
      `select public.claim_scoring_jobs('${id(91)}',1,300) result`), []);
    await db.exec(`update public.candidate_applications set current_stage='scoring' where id='${id(10)}'`);
    const persisted = await scalar<{ conflict: boolean; revision: number }>(db,
      `select public.try_persist_queued_scoring_snapshot('${first.jobId}','${worker}','candidate','${id(10)}',0,'{"ok":true}',null) result`);
    assert.deepEqual(persisted, { audit_id: null, conflict: false, revision: 1 });
    const committed = await scalar<Record<string, unknown>>(db, `select jsonb_build_object(
      'parent',(select jsonb_build_object('status',status,'stage',current_stage,'revision',scoring_revision) from public.candidate_applications where id='${id(10)}'),
      'invitation',(select status from public.invitations where id='${id(20)}'),
      'job',(select jsonb_build_object('status',status,'revision',result_revision) from public.scoring_jobs where id='${first.jobId}'),
      'snapshots',(select count(*) from public.test_scoring_snapshots where parent_id='${id(10)}')
    ) result`);
    assert.deepEqual(committed, {
      invitation: "completed", job: { revision: 1, status: "completed" },
      parent: { revision: 1, stage: "assessment_completed", status: "completed" }, snapshots: 1,
    });

    await db.exec(`
      insert into public.employee_assessment_participants(id,company_id) values ('${id(40)}','${id(1)}');
      insert into public.employee_assessment_invitations values ('${id(41)}','${id(1)}','${id(40)}','started');
      insert into public.employee_assessment_sessions values ('${id(42)}','${id(40)}','completed');
    `);
    const employee = await scalar<{ jobId: string }>(db,
      `select public.enqueue_scoring_job('employee','${id(40)}','${id(41)}',false) result`);
    await scalar(db, `select public.claim_scoring_jobs('${worker}',1,300) result`);
    await db.exec(`update public.employee_assessment_participants set current_stage='scoring' where id='${id(40)}';
      create function public.reject_invitation_completion() returns trigger language plpgsql as $$ begin
        raise exception 'synthetic invitation failure'; end; $$;
      create trigger reject_invitation_completion before update on public.employee_assessment_invitations
      for each row execute function public.reject_invitation_completion();`);
    await assert.rejects(scalar(db,
      `select public.try_persist_queued_scoring_snapshot('${employee.jobId}','${worker}','employee','${id(40)}',0,'{"ok":true}',null) result`),
      /synthetic invitation failure/);
    assert.deepEqual(await scalar<Record<string, unknown>>(db, `select jsonb_build_object(
      'parent',(select jsonb_build_object('status',status,'stage',current_stage,'revision',scoring_revision) from public.employee_assessment_participants where id='${id(40)}'),
      'invitation',(select status from public.employee_assessment_invitations where id='${id(41)}'),
      'job',(select status from public.scoring_jobs where id='${employee.jobId}'),
      'snapshots',(select count(*) from public.test_scoring_snapshots where parent_id='${id(40)}')
    ) result`), {
      invitation: "started", job: "processing",
      parent: { revision: 0, stage: "scoring", status: "in_progress" }, snapshots: 0,
    });
    await db.exec("drop trigger reject_invitation_completion on public.employee_assessment_invitations");

    const retryJob = await scalar<{ jobId: string }>(db,
      `select public.enqueue_scoring_job('candidate','${id(12)}','${id(22)}',false) result`);
    await db.exec(`update public.scoring_jobs set max_attempts=3 where id='${retryJob.jobId}'`);
    await scalar(db, `select public.claim_scoring_jobs('${id(92)}',1,300) result`);
    assert.equal((await scalar<{ status: string }>(db,
      `select public.finish_scoring_job('${retryJob.jobId}','${id(92)}',false,'scoring_failed') result`)).status, "retry");
    await db.exec(`update public.scoring_jobs set available_at=clock_timestamp() where id='${retryJob.jobId}'`);
    await scalar(db, `select public.claim_scoring_jobs('${id(93)}',1,300) result`);
    await db.exec(`update public.scoring_jobs set locked_until=clock_timestamp()-interval '1 second' where id='${retryJob.jobId}'`);
    await assert.rejects(scalar(db,
      `select public.finish_scoring_job('${retryJob.jobId}','${id(93)}',false,'scoring_failed') result`), /lease was lost/);
    await scalar(db, `select public.claim_scoring_jobs('${id(94)}',1,300) result`);
    assert.equal((await scalar<{ status: string }>(db,
      `select public.finish_scoring_job('${retryJob.jobId}','${id(94)}',false,'scoring_failed') result`)).status, "failed");
    assert.equal((await scalar<{ status: string }>(db,
      `select public.enqueue_scoring_job('candidate','${id(12)}','${id(22)}',false) result`)).status, "failed");
    assert.equal((await scalar<{ status: string }>(db,
      `select public.enqueue_scoring_job('candidate','${id(12)}','${id(22)}',true) result`)).status, "queued");
    assert.equal(await scalar<number>(db,
      `select attempts result from public.scoring_jobs where id='${retryJob.jobId}'`), 0);

    for (const role of ["anon", "authenticated"]) {
      await db.exec("begin");
      try {
        await db.exec(`set local role ${role}`);
        await assert.rejects(db.query("select * from public.scoring_jobs"), /permission denied/);
      } finally {
        await db.exec("rollback");
      }
    }
    const privileges = await scalar<Record<string, boolean>>(db, `select jsonb_build_object(
      'service_enqueue',has_function_privilege('service_role','public.enqueue_scoring_job(text,uuid,uuid,boolean)','execute'),
      'authenticated_enqueue',has_function_privilege('authenticated','public.enqueue_scoring_job(text,uuid,uuid,boolean)','execute'),
      'authenticated_table',has_table_privilege('authenticated','public.scoring_jobs','select'),
      'service_table_write',has_table_privilege('service_role','public.scoring_jobs','insert,update')
    ) result`);
    assert.deepEqual(privileges, {
      authenticated_enqueue: false, authenticated_table: false, service_enqueue: true, service_table_write: false,
    });
    const verified = (await db.exec(verification))[0]!.rows[0] as {
      result: { perf015_async_scoring_jobs: {
        catalog: Record<string, boolean>;
        privileges: Record<string, boolean>;
        queue: { tenant_parent_mismatches: number };
      } };
    };
    const report = verified.result.perf015_async_scoring_jobs;
    assert.ok(Object.values(report.catalog).every(Boolean));
    assert.ok(Object.values(report.privileges).every(Boolean));
    assert.equal(report.queue.tenant_parent_mismatches, 0);
    assert.match(migration, /for update skip locked/);
  } finally {
    await db.close();
  }
});
