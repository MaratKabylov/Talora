-- LOCAL PGLITE TEST FIXTURE ONLY. DO NOT APPLY IN SUPABASE / SQL EDITOR.
-- Production table DDL and publication guards are loaded from real migrations by the test.
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.companies(id uuid primary key, status text not null default 'active');
create table public.profiles(id uuid primary key);
create table public.company_users(
  company_id uuid references public.companies, user_id uuid references public.profiles,
  role text not null, status text not null default 'active', primary key(company_id, user_id)
);
create table public.platform_users(
  user_id uuid primary key references public.profiles, role text not null,
  status text not null default 'active'
);
