-- TEST ONLY — never run in Supabase SQL Editor or an existing database.
-- Extends fixtures/session-control-v2.sql in a disposable PGlite instance.
alter table public.companies add column name text not null default 'Company';
create table public.candidates (id uuid primary key, company_id uuid references public.companies,
  full_name text, email text, phone text, city text, profile_completed_at timestamptz);
create table public.employees (id uuid primary key, company_id uuid references public.companies,
  full_name text, email text, phone text, department text, role_title text, profile_completed_at timestamptz);
create table public.assessment_packages (id uuid primary key, company_id uuid references public.companies,
  title text not null, description text);
create table public.jobs (id uuid primary key, company_id uuid references public.companies,
  assessment_package_id uuid references public.assessment_packages, title text not null, department text, location text);
create table public.employee_assessments (id uuid primary key, company_id uuid references public.companies,
  assessment_package_id uuid references public.assessment_packages, title text not null, description text);
alter table public.candidate_applications add column candidate_id uuid references public.candidates,
  add column job_id uuid references public.jobs;
alter table public.employee_assessment_participants add column employee_id uuid references public.employees,
  add column employee_assessment_id uuid references public.employee_assessments;
alter table public.invitations add column candidate_id uuid references public.candidates,
  add column job_id uuid references public.jobs, add column consent_given_at timestamptz;
alter table public.employee_assessment_invitations add column employee_id uuid references public.employees,
  add column employee_assessment_id uuid references public.employee_assessments, add column consent_given_at timestamptz;
create table public.test_templates (id uuid primary key, title text not null);
alter table public.test_versions add column test_template_id uuid references public.test_templates,
  add column title text not null default 'Version', add column description text, add column instructions text,
  add column settings_json jsonb not null default '{}'::jsonb;
create table public.assessment_package_tests (package_id uuid references public.assessment_packages,
  test_version_id uuid references public.test_versions, order_index integer not null,
  unique(package_id, test_version_id));
alter table public.test_sessions add column candidate_id uuid references public.candidates,
  add column deadline_at timestamptz, add column completed_at timestamptz;
alter table public.employee_assessment_sessions add column employee_id uuid references public.employees,
  add column deadline_at timestamptz, add column completed_at timestamptz,
  add column package_id uuid references public.assessment_packages, add column package_order_index integer,
  add column created_at timestamptz not null default now();
