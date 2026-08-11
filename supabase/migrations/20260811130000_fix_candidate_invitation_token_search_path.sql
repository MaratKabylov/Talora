-- pgcrypto functions are exposed from the extensions schema in Supabase.
-- A later migration recreated this RPC with an empty search_path, so restore
-- the explicit path after all migrations that define invite_candidate_to_job.
alter function public.invite_candidate_to_job(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  timestamptz
)
set search_path = pg_catalog, extensions;
