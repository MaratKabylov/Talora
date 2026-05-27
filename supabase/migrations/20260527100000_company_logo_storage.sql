-- Public company branding images for candidate-facing pages.
-- Only active company administrators may create or replace their logo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos',
  'company-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "company admins can select own logo objects" on storage.objects;
create policy "company admins can select own logo objects"
on storage.objects for select
to authenticated
using (
  bucket_id = 'company-logos'
  and name = split_part(name, '/', 1) || '/logo'
  and public.is_company_admin(
    case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then split_part(name, '/', 1)::uuid
      else null
    end
  )
);

drop policy if exists "company admins can insert own logo objects" on storage.objects;
create policy "company admins can insert own logo objects"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'company-logos'
  and name = split_part(name, '/', 1) || '/logo'
  and public.is_company_admin(
    case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then split_part(name, '/', 1)::uuid
      else null
    end
  )
);

drop policy if exists "company admins can update own logo objects" on storage.objects;
create policy "company admins can update own logo objects"
on storage.objects for update
to authenticated
using (
  bucket_id = 'company-logos'
  and name = split_part(name, '/', 1) || '/logo'
  and public.is_company_admin(
    case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then split_part(name, '/', 1)::uuid
      else null
    end
  )
)
with check (
  bucket_id = 'company-logos'
  and name = split_part(name, '/', 1) || '/logo'
  and public.is_company_admin(
    case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then split_part(name, '/', 1)::uuid
      else null
    end
  )
);

drop policy if exists "company admins can delete own logo objects" on storage.objects;
create policy "company admins can delete own logo objects"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'company-logos'
  and name = split_part(name, '/', 1) || '/logo'
  and public.is_company_admin(
    case
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        then split_part(name, '/', 1)::uuid
      else null
    end
  )
);
