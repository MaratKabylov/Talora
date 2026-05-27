-- Platform team invitations are issued through Supabase Auth by a platform owner.
-- The invited user receives access only after completing the invitation flow.

alter table public.platform_users
  drop constraint if exists platform_users_status_check;

alter table public.platform_users
  add constraint platform_users_status_check
  check (status in ('invited', 'active', 'disabled'));
