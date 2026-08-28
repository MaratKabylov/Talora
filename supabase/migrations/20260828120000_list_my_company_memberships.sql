-- Read the authenticated user's active company memberships without relying on
-- a PostgREST embedded relation across two RLS-protected tables.

create or replace function public.list_my_company_memberships()
returns table (
  company_id uuid,
  company_name text,
  role text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    cu.company_id,
    company.name as company_name,
    cu.role
  from public.company_users cu
  join public.companies company on company.id = cu.company_id
  where cu.user_id = auth.uid()
    and cu.status = 'active'
  order by cu.created_at, cu.company_id;
$$;

revoke all on function public.list_my_company_memberships() from public, anon;
grant execute on function public.list_my_company_memberships() to authenticated;
