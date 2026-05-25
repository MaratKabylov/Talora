-- Auth and first-company onboarding support.
-- The initial schema enables RLS before a user has a profile or membership.
-- These functions keep first-time creation atomic without exposing open inserts.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), '')
  )
  on conflict (id) do update
  set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.create_first_company(
  company_name text,
  profile_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  normalized_company_name text := nullif(btrim(company_name), '');
  normalized_full_name text := nullif(btrim(profile_full_name), '');
  created_company_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required';
  end if;

  if normalized_company_name is null then
    raise exception 'Company name is required';
  end if;

  if exists (
    select 1
    from public.company_users cu
    where cu.user_id = actor_id
      and cu.status = 'active'
  ) then
    raise exception 'An active company membership already exists';
  end if;

  insert into public.profiles (id, email, full_name)
  select
    u.id,
    u.email,
    coalesce(normalized_full_name, nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''))
  from auth.users u
  where u.id = actor_id
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(normalized_full_name, public.profiles.full_name);

  insert into public.companies (name)
  values (normalized_company_name)
  returning id into created_company_id;

  insert into public.company_users (company_id, user_id, role, status)
  values (created_company_id, actor_id, 'owner', 'active');

  return created_company_id;
end;
$$;

revoke all on function public.create_first_company(text, text) from public, anon;
grant execute on function public.create_first_company(text, text) to authenticated;

create or replace function public.list_company_members(target_company_id uuid)
returns table (
  user_id uuid,
  full_name text,
  email text,
  role text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_company_member(target_company_id) then
    raise exception 'Not authorized to view company members';
  end if;

  return query
  select
    cu.user_id,
    p.full_name,
    p.email,
    cu.role,
    cu.status,
    cu.created_at
  from public.company_users cu
  join public.profiles p on p.id = cu.user_id
  where cu.company_id = target_company_id
  order by
    case cu.role
      when 'owner' then 1
      when 'admin' then 2
      when 'recruiter' then 3
      when 'viewer' then 4
      else 5
    end,
    cu.created_at;
end;
$$;

revoke all on function public.list_company_members(uuid) from public, anon;
grant execute on function public.list_company_members(uuid) to authenticated;
