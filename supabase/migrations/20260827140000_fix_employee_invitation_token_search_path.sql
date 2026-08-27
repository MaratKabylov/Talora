-- pgcrypto is exposed from the extensions schema in Supabase.
-- Keep the fixed path explicit so employee invitation token generation can
-- resolve gen_random_bytes without weakening the RPC's search path safety.
alter function public.invite_employee_to_assessment(
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
