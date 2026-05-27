-- Company team invitations, owner-only access management and audit history.

create unique index if not exists idx_company_users_single_owner
  on public.company_users(company_id)
  where role = 'owner';

create or replace function public.is_company_owner(target_company_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_users cu
    where cu.company_id = target_company_id
      and cu.user_id = auth.uid()
      and cu.status = 'active'
      and cu.role = 'owner'
  );
$$;

revoke all on function public.is_company_owner(uuid) from public, anon;
grant execute on function public.is_company_owner(uuid) to authenticated;

drop policy if exists "admins can manage company users" on public.company_users;
drop policy if exists "owners can manage company users" on public.company_users;

-- Team writes go through server actions after an owner check. This keeps invite
-- acceptance and audit creation in one controlled application flow.

create table if not exists public.company_audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (
    action in (
      'invite_member',
      'grant_existing_member_access',
      'accept_member_invitation',
      'disable_member',
      'revoke_member_invitation',
      'update_member_role'
    )
  ),
  target_user_id uuid references public.profiles(id) on delete set null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_company_audit_logs_company_created_at
  on public.company_audit_logs(company_id, created_at desc);

alter table public.company_audit_logs enable row level security;

drop policy if exists "owners can read company audit logs" on public.company_audit_logs;
create policy "owners can read company audit logs"
on public.company_audit_logs for select to authenticated
using (public.is_company_owner(company_id));
