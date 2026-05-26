-- Platform backoffice: internal team access, auditable support operations and tenant suspension.

alter table public.companies
  add column if not exists status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_by uuid references public.profiles(id),
  add column if not exists suspension_reason text;

alter table public.companies
  drop constraint if exists companies_suspension_state_consistency;
alter table public.companies
  add constraint companies_suspension_state_consistency check (
    (status = 'suspended' and suspended_at is not null and suspension_reason is not null)
    or (status <> 'suspended' and suspended_at is null and suspended_by is null and suspension_reason is null)
  );

create table if not exists public.platform_users (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null check (role in ('platform_owner', 'platform_admin', 'platform_support', 'platform_analyst')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  actor_role text not null,
  action text not null,
  target_type text not null,
  target_id uuid,
  company_id uuid references public.companies(id) on delete set null,
  reason text,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_company_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  author_user_id uuid not null references public.profiles(id) on delete restrict,
  note text not null check (char_length(btrim(note)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists idx_platform_users_status_role
  on public.platform_users(status, role);
create index if not exists idx_platform_audit_created_at
  on public.platform_audit_logs(created_at desc);
create index if not exists idx_platform_audit_company_created_at
  on public.platform_audit_logs(company_id, created_at desc);
create index if not exists idx_platform_company_notes_company_created_at
  on public.platform_company_notes(company_id, created_at desc);

drop trigger if exists set_platform_users_updated_at on public.platform_users;
create trigger set_platform_users_updated_at before update on public.platform_users
for each row execute function public.set_updated_at();

alter table public.platform_users enable row level security;
alter table public.platform_audit_logs enable row level security;
alter table public.platform_company_notes enable row level security;

-- Backoffice access is intentionally server-only through the service-role client after
-- application-level platform role checks. No direct authenticated policies are granted.

create or replace function public.can_manage_company_resources(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_users cu
    join public.companies company on company.id = cu.company_id
    where cu.company_id = target_company_id
      and cu.user_id = auth.uid()
      and cu.status = 'active'
      and cu.role in ('owner', 'admin', 'recruiter', 'super_admin')
      and company.status = 'active'
  );
$$;

revoke all on function public.can_manage_company_resources(uuid) from public, anon;
grant execute on function public.can_manage_company_resources(uuid) to authenticated;

create or replace function public.is_company_admin(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_users cu
    join public.companies company on company.id = cu.company_id
    where cu.company_id = target_company_id
      and cu.user_id = auth.uid()
      and cu.status = 'active'
      and cu.role in ('owner', 'admin', 'super_admin')
      and company.status = 'active'
  );
$$;

revoke all on function public.is_company_admin(uuid) from public, anon;
grant execute on function public.is_company_admin(uuid) to authenticated;
