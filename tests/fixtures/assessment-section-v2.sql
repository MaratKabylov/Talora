-- TEST ONLY: npm test loads this into a disposable PGlite DB. NOT for Supabase.
alter table public.invitations add column consent_given_at timestamptz;
alter table public.employee_assessment_invitations add column consent_given_at timestamptz;
alter table public.test_sections add column title text default 'Section',
  add column description text, add column settings_json jsonb default '{}'::jsonb;
alter table public.questions add column text text default 'Question', add column description text;
alter table public.answer_options add column text text default 'Option',
  add column order_index integer default 0, add column match_text text;
