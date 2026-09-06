# .env.example

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Prefer the new Supabase secret key for server-only operations.
SUPABASE_SECRET_KEY=

# Legacy fallback. Never expose server keys to browser code.
SUPABASE_SERVICE_ROLE_KEY=

NEXT_PUBLIC_APP_URL=http://localhost:3000

# Server only. Apply the session lease V2 migration and verify staging before enabling.
# Currently covers claim/heartbeat/integrity events, not answer saving.
SESSION_CONTROL_V2=false

# Optional email provider for later
RESEND_API_KEY=
EMAIL_FROM=
