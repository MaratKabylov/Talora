# .env.example

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Prefer the new Supabase secret key for server-only operations.
SUPABASE_SECRET_KEY=

# Legacy fallback. Never expose server keys to browser code.
SUPABASE_SERVICE_ROLE_KEY=

NEXT_PUBLIC_APP_URL=http://localhost:3000

# Server only. Apply both session lease and answer V2 migrations, then verify staging.
# Covers claim/heartbeat/events/autosave/finalize/expiration checks.
SESSION_CONTROL_V2=false

# Server only. Apply 20260906140000_assessment_section_read_v2.sql, then verify staging.
# Independent of SESSION_CONTROL_V2; limits test-page content to the active section.
ASSESSMENT_SECTION_READ_V2=false

# Optional email provider for later
RESEND_API_KEY=
EMAIL_FROM=
