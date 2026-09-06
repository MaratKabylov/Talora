-- TEST ONLY — DO NOT RUN IN SUPABASE SQL EDITOR OR AN EXISTING DATABASE.
-- npm test loads this fixture exclusively into an empty, disposable PGlite instance.
-- Minimal dependency schema for executing the REAL integrity and lease migrations
-- in PGlite. Does not substitute for a fully migrated Supabase/RLS staging run.
create role anon;
create role authenticated;
create role service_role;
create function public.is_company_member(uuid) returns boolean language sql as 'select false';

create table public.companies (id uuid primary key);
create table public.candidate_applications (
  id uuid primary key, company_id uuid not null references public.companies,
  status text default 'in_progress', current_stage text
);
create table public.employee_assessment_participants (
  id uuid primary key, company_id uuid not null references public.companies,
  status text default 'in_progress', current_stage text
);
create table public.invitations (
  id uuid primary key, company_id uuid not null references public.companies,
  application_id uuid not null references public.candidate_applications,
  token text unique not null, status text not null, expires_at timestamptz
);
create table public.employee_assessment_invitations (
  id uuid primary key, company_id uuid not null references public.companies,
  participant_id uuid not null references public.employee_assessment_participants,
  token text unique not null, status text not null, expires_at timestamptz
);
create table public.test_versions (id uuid primary key, duration_minutes integer, status text);
create table public.test_sections (
  id uuid primary key, test_version_id uuid not null references public.test_versions
);
create table public.questions (
  id uuid primary key, section_id uuid not null references public.test_sections
);
create table public.test_sessions (
  id uuid primary key, application_id uuid not null references public.candidate_applications,
  test_version_id uuid not null references public.test_versions, status text not null,
  started_at timestamptz
);
create table public.employee_assessment_sessions (
  id uuid primary key, participant_id uuid not null references public.employee_assessment_participants,
  test_version_id uuid not null references public.test_versions, status text not null,
  started_at timestamptz
);
