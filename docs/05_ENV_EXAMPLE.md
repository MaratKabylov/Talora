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

# Server only. Apply 20260907120000_assessment_test_overview_v2.sql, then verify staging.
# Enable with ASSESSMENT_SECTION_READ_V2 to avoid legacy overview/content reads.
ASSESSMENT_OVERVIEW_V2=false

# Server only. Requires ASSESSMENT_SECTION_READ_V2=true.
# No new migration. Keeps the session mounted when loading another section.
ASSESSMENT_SOFT_NAVIGATION_V2=false

# Server only. Apply 20260907150000_assessment_section_save_v2.sql before enabling.
# Requires SESSION_CONTROL_V2, ASSESSMENT_SECTION_READ_V2, ASSESSMENT_SOFT_NAVIGATION_V2=true.
ASSESSMENT_SECTION_SAVE_V2=false

# Server only. Apply 20260907170000_assessment_section_prefetch_v3.sql before enabling.
# Requires ASSESSMENT_SECTION_READ_V2 + ASSESSMENT_SOFT_NAVIGATION_V2=true.
# Whole-section mode also requires ASSESSMENT_SECTION_SAVE_V2 + SESSION_CONTROL_V2=true.
ASSESSMENT_SECTION_PREFETCH_V3=false

# Optional email provider for later
RESEND_API_KEY=
EMAIL_FROM=
