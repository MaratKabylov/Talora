-- TEST ONLY. Never run in Supabase SQL Editor. Loaded by npm test into PGlite.
alter table public.test_versions add column if not exists settings_json jsonb default '{}'::jsonb;
alter table public.test_sections add column order_index integer default 0;
alter table public.questions add column question_type text default 'open_text',
  add column settings_json jsonb default '{}'::jsonb, add column order_index integer default 0;
create table public.answer_options (
  id uuid primary key, question_id uuid not null references public.questions,
  is_correct boolean, match_target_id uuid not null default gen_random_uuid()
);
create table public.candidate_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.test_sessions,
  question_id uuid not null references public.questions,
  answer_json jsonb not null default '{}'::jsonb, answer_text text,
  selected_option_id uuid references public.answer_options, is_correct boolean,
  raw_score numeric, points_awarded numeric, time_spent_seconds integer,
  unique(session_id, question_id)
);
create table public.employee_assessment_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.employee_assessment_sessions,
  question_id uuid not null references public.questions,
  answer_json jsonb not null default '{}'::jsonb, answer_text text,
  selected_option_id uuid references public.answer_options, is_correct boolean,
  raw_score numeric, points_awarded numeric, time_spent_seconds integer,
  unique(session_id, question_id)
);
