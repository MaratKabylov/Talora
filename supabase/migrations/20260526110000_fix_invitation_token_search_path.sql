-- pgcrypto is exposed from the extensions schema in Supabase.
-- Keep the fixed path explicit so token generation resolves gen_random_bytes safely.
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
