-- HR Assessment SaaS MVP schema
-- Target: Supabase Postgres
-- Run in Supabase SQL editor or as migration.
-- This is MVP-oriented and can be refined.

create extension if not exists "pgcrypto";

-- =========================
-- ENUM-like check helpers are implemented as text checks for easier migration.
-- =========================

create table if not exists public.system_cities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bin_or_iin text,
  industry text,
  city_id uuid references public.system_cities(id) on delete restrict,
  logo_url text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','admin','recruiter','viewer','super_admin')),
  status text not null default 'active' check (status in ('active','invited','disabled')),
  created_at timestamptz not null default now(),
  unique(company_id, user_id)
);

create table if not exists public.assessment_packages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  title text not null,
  description text,
  is_system boolean not null default false,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  title text not null,
  description text,
  department text,
  location text,
  employment_type text,
  status text not null default 'draft' check (status in ('draft','active','paused','closed','archived')),
  assessment_package_id uuid references public.assessment_packages(id),
  passing_score numeric(5,2),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.job_competency_weights (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  competency_key text not null,
  weight numeric(6,4) not null default 0,
  minimum_score numeric(5,2),
  is_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, competency_key)
);

create table if not exists public.candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text,
  phone text,
  email text,
  city text,
  resume_url text,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.candidate_applications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited','in_progress','completed','shortlisted','rejected','hired','withdrawn')),
  current_stage text,
  overall_score numeric(5,2),
  fit_score numeric(5,2),
  recommendation text,
  risk_level text check (risk_level in ('low','medium','high')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(job_id, candidate_id)
);

create table if not exists public.test_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  title text not null,
  description text,
  category text,
  is_system boolean not null default false,
  created_by uuid references public.profiles(id),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.test_versions (
  id uuid primary key default gen_random_uuid(),
  test_template_id uuid not null references public.test_templates(id) on delete cascade,
  version_number integer not null default 1,
  title text not null,
  description text,
  instructions text,
  duration_minutes integer,
  scoring_type text not null default 'points' check (scoring_type in ('points','competency_profile','manual','mixed')),
  status text not null default 'draft' check (status in ('draft','published','archived')),
  settings_json jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'published' or duration_minutes is not null),
  unique(test_template_id, version_number)
);

create table if not exists public.test_sections (
  id uuid primary key default gen_random_uuid(),
  test_version_id uuid not null references public.test_versions(id) on delete cascade,
  title text not null,
  description text,
  order_index integer not null default 0,
  time_limit_minutes integer,
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.test_sections(id) on delete cascade,
  question_type text not null check (question_type in ('single_choice','multiple_choice','scale','open_text','ordering','matching','forced_choice')),
  text text not null,
  description text,
  media_url text,
  order_index integer not null default 0,
  points numeric(8,2) not null default 0,
  competency_key text,
  difficulty text check (difficulty in ('easy','medium','hard')),
  settings_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.answer_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  text text not null,
  order_index integer not null default 0,
  is_correct boolean,
  points numeric(8,2) not null default 0,
  competency_effect_json jsonb not null default '{}'::jsonb,
  explanation text,
  created_at timestamptz not null default now()
);

create table if not exists public.assessment_package_tests (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.assessment_packages(id) on delete cascade,
  test_version_id uuid not null references public.test_versions(id) on delete restrict,
  order_index integer not null default 0,
  weight numeric(6,4) not null default 1,
  is_required boolean not null default true,
  passing_score numeric(5,2),
  created_at timestamptz not null default now(),
  unique(package_id, test_version_id)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_id uuid references public.candidates(id) on delete set null,
  application_id uuid references public.candidate_applications(id) on delete cascade,
  token text not null unique,
  status text not null default 'sent' check (status in ('created','sent','opened','started','completed','expired','cancelled')),
  expires_at timestamptz,
  sent_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.test_sessions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.candidate_applications(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  test_version_id uuid not null references public.test_versions(id) on delete restrict,
  status text not null default 'not_started' check (status in ('not_started','in_progress','completed','expired','cancelled')),
  started_at timestamptz,
  deadline_at timestamptz,
  completed_at timestamptz,
  active_client_id_hash text check (active_client_id_hash is null or active_client_id_hash ~ '^[a-f0-9]{64}$'),
  active_device_id_hash text check (active_device_id_hash is null or active_device_id_hash ~ '^[a-f0-9]{64}$'),
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  submission_reason text check (submission_reason is null or submission_reason in ('candidate','time_expired')),
  time_spent_seconds integer,
  score numeric(8,2),
  max_score numeric(8,2),
  percentage numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(application_id, test_version_id)
);

create table if not exists public.candidate_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.test_sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  selected_option_id uuid references public.answer_options(id) on delete restrict,
  answer_text text,
  answer_json jsonb not null default '{}'::jsonb,
  is_correct boolean,
  points_awarded numeric(8,2),
  time_spent_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(session_id, question_id)
);

create table if not exists public.assessment_session_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  application_id uuid not null references public.candidate_applications(id) on delete cascade,
  session_id uuid not null references public.test_sessions(id) on delete cascade,
  question_id uuid references public.questions(id) on delete set null,
  client_event_id uuid not null,
  event_type text not null check (event_type in (
    'focus_lost','focus_returned','clipboard_copy','clipboard_cut','clipboard_paste',
    'concurrent_session_blocked','session_recovered','timer_expired'
  )),
  client_occurred_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  unique(session_id, client_event_id)
);

create table if not exists public.test_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.test_sessions(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  application_id uuid not null references public.candidate_applications(id) on delete cascade,
  test_version_id uuid not null references public.test_versions(id) on delete restrict,
  raw_score numeric(8,2),
  max_score numeric(8,2),
  percentage numeric(5,2),
  level text,
  summary text,
  created_at timestamptz not null default now(),
  unique(session_id)
);

create table if not exists public.competency_scores (
  id uuid primary key default gen_random_uuid(),
  result_id uuid references public.test_results(id) on delete cascade,
  application_id uuid not null references public.candidate_applications(id) on delete cascade,
  competency_key text not null,
  score numeric(8,2),
  max_score numeric(8,2),
  percentage numeric(5,2),
  level text,
  interpretation text,
  created_at timestamptz not null default now()
);

create table if not exists public.application_competency_summary (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.candidate_applications(id) on delete cascade,
  competency_key text not null,
  score numeric(8,2),
  max_score numeric(8,2),
  percentage numeric(5,2),
  level text,
  weighted_score numeric(8,2),
  is_below_minimum boolean not null default false,
  created_at timestamptz not null default now(),
  unique(application_id, competency_key)
);

create table if not exists public.application_comparison_scores (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.candidate_applications(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  overall_score numeric(5,2),
  fit_score numeric(5,2),
  rank_position integer,
  percentile numeric(5,2),
  recommendation text,
  risk_level text check (risk_level in ('low','medium','high')),
  completed_required_tests boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(application_id)
);

create table if not exists public.candidate_risk_flags (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.candidate_applications(id) on delete cascade,
  risk_key text not null,
  risk_level text not null check (risk_level in ('low','medium','high')),
  title text not null,
  description text,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists public.candidate_reports (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.candidate_applications(id) on delete cascade,
  candidate_id uuid not null references public.candidates(id) on delete cascade,
  overall_score numeric(5,2),
  fit_score numeric(5,2),
  recommendation text,
  strengths_json jsonb not null default '[]'::jsonb,
  risks_json jsonb not null default '[]'::jsonb,
  suggested_roles_json jsonb not null default '[]'::jsonb,
  interview_questions_json jsonb not null default '[]'::jsonb,
  report_text text,
  created_at timestamptz not null default now(),
  unique(application_id)
);

create table if not exists public.shortlists (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  title text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.shortlist_candidates (
  id uuid primary key default gen_random_uuid(),
  shortlist_id uuid not null references public.shortlists(id) on delete cascade,
  application_id uuid not null references public.candidate_applications(id) on delete cascade,
  position integer,
  note text,
  created_at timestamptz not null default now(),
  unique(shortlist_id, application_id)
);

-- =========================
-- Useful indexes
-- =========================

create unique index if not exists idx_system_cities_normalized_name on public.system_cities (lower(btrim(name)));
create index if not exists idx_companies_city_id on public.companies(city_id);
create index if not exists idx_company_users_user_id on public.company_users(user_id);
create index if not exists idx_jobs_company_id on public.jobs(company_id);
create index if not exists idx_candidates_email on public.candidates(email);
create index if not exists idx_applications_company_job on public.candidate_applications(company_id, job_id);
create index if not exists idx_invitations_token on public.invitations(token);
create index if not exists idx_test_sessions_application on public.test_sessions(application_id);
create index if not exists idx_answers_session on public.candidate_answers(session_id);
create index if not exists idx_assessment_session_events_application_time on public.assessment_session_events(application_id, occurred_at);
create index if not exists idx_assessment_session_events_session_time on public.assessment_session_events(session_id, occurred_at);
create index if not exists idx_competency_scores_application on public.competency_scores(application_id);
create index if not exists idx_comparison_job_fit on public.application_comparison_scores(job_id, fit_score desc);

-- =========================
-- Updated_at trigger
-- =========================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_companies_updated_at on public.companies;
create trigger set_companies_updated_at before update on public.companies
for each row execute function public.set_updated_at();

drop trigger if exists set_system_cities_updated_at on public.system_cities;
create trigger set_system_cities_updated_at before update on public.system_cities
for each row execute function public.set_updated_at();

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_jobs_updated_at on public.jobs;
create trigger set_jobs_updated_at before update on public.jobs
for each row execute function public.set_updated_at();

drop trigger if exists set_candidates_updated_at on public.candidates;
create trigger set_candidates_updated_at before update on public.candidates
for each row execute function public.set_updated_at();

drop trigger if exists set_applications_updated_at on public.candidate_applications;
create trigger set_applications_updated_at before update on public.candidate_applications
for each row execute function public.set_updated_at();

drop trigger if exists set_test_templates_updated_at on public.test_templates;
create trigger set_test_templates_updated_at before update on public.test_templates
for each row execute function public.set_updated_at();

drop trigger if exists set_test_versions_updated_at on public.test_versions;
create trigger set_test_versions_updated_at before update on public.test_versions
for each row execute function public.set_updated_at();

-- =========================
-- RLS helpers
-- =========================

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_users cu
    where cu.company_id = target_company_id
      and cu.user_id = auth.uid()
      and cu.status = 'active'
  );
$$;

create or replace function public.is_company_admin(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_users cu
    where cu.company_id = target_company_id
      and cu.user_id = auth.uid()
      and cu.status = 'active'
      and cu.role in ('owner','admin','super_admin')
  );
$$;

-- =========================
-- Enable RLS
-- =========================

alter table public.system_cities enable row level security;
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.company_users enable row level security;
alter table public.jobs enable row level security;
alter table public.job_competency_weights enable row level security;
alter table public.candidates enable row level security;
alter table public.candidate_applications enable row level security;
alter table public.test_templates enable row level security;
alter table public.test_versions enable row level security;
alter table public.test_sections enable row level security;
alter table public.questions enable row level security;
alter table public.answer_options enable row level security;
alter table public.assessment_packages enable row level security;
alter table public.assessment_package_tests enable row level security;
alter table public.invitations enable row level security;
alter table public.test_sessions enable row level security;
alter table public.candidate_answers enable row level security;
alter table public.assessment_session_events enable row level security;
alter table public.test_results enable row level security;
alter table public.competency_scores enable row level security;
alter table public.application_competency_summary enable row level security;
alter table public.application_comparison_scores enable row level security;
alter table public.candidate_risk_flags enable row level security;
alter table public.candidate_reports enable row level security;
alter table public.shortlists enable row level security;
alter table public.shortlist_candidates enable row level security;

-- =========================
-- Basic policies
-- Note: Public candidate token access should go through secure route handlers/server actions,
-- not direct anon table access, except if you intentionally add limited token policies.
-- =========================

create policy "authenticated users can read system cities"
on public.system_cities for select
to authenticated
using (true);

create policy "members can read own companies"
on public.companies for select
using (public.is_company_member(id));

create policy "admins can update own companies"
on public.companies for update
using (public.is_company_admin(id))
with check (public.is_company_admin(id));

create policy "users can read own profile"
on public.profiles for select
using (id = auth.uid());

create policy "users can update own profile"
on public.profiles for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "members can read company users"
on public.company_users for select
using (public.is_company_member(company_id));

create policy "admins can manage company users"
on public.company_users for all
using (public.is_company_admin(company_id))
with check (public.is_company_admin(company_id));

create policy "members can read jobs"
on public.jobs for select
using (public.is_company_member(company_id));

create policy "recruiters can manage jobs"
on public.jobs for all
using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));

create policy "members can read job competency weights"
on public.job_competency_weights for select
using (public.is_company_member(company_id));

create policy "members can manage job competency weights"
on public.job_competency_weights for all
using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));

create policy "members can read applications"
on public.candidate_applications for select
using (public.is_company_member(company_id));

create policy "members can manage applications"
on public.candidate_applications for all
using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));

create policy "members can read assessment session events"
on public.assessment_session_events for select
using (public.is_company_member(company_id));

create policy "members can read invitations"
on public.invitations for select
using (public.is_company_member(company_id));

create policy "members can manage invitations"
on public.invitations for all
using (public.is_company_member(company_id))
with check (public.is_company_member(company_id));

create policy "members can read packages"
on public.assessment_packages for select
using (is_system = true or public.is_company_member(company_id));

create policy "members can manage own packages"
on public.assessment_packages for all
using (company_id is not null and public.is_company_member(company_id))
with check (company_id is not null and public.is_company_member(company_id));

create policy "members can read test templates"
on public.test_templates for select
using (is_system = true or public.is_company_member(company_id));

create policy "members can manage own test templates"
on public.test_templates for all
using (company_id is not null and public.is_company_member(company_id))
with check (company_id is not null and public.is_company_member(company_id));

-- For nested test entities, keep write operations in server actions that verify ownership.
-- Basic read policies for published/system tests and own company tests can be implemented via joins in views or RPC.
