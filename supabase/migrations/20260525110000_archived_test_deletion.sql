-- Company test deletion: permanent removal is available only after archiving.

create or replace function public.require_archived_test_template_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_system then
    raise exception 'System test templates cannot be deleted';
  end if;

  if old.status <> 'archived' then
    raise exception 'Only archived test templates can be deleted';
  end if;

  return old;
end;
$$;

drop trigger if exists require_archived_test_template_before_delete on public.test_templates;
create trigger require_archived_test_template_before_delete
before delete on public.test_templates
for each row execute function public.require_archived_test_template_before_delete();

revoke all on function public.require_archived_test_template_before_delete()
  from public, anon, authenticated;
