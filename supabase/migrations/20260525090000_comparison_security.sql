-- Candidate comparison: tenant-protected shortlists and an atomic shortlist action.

create unique index if not exists idx_shortlists_job_title_unique
  on public.shortlists(job_id, title);

create index if not exists idx_shortlist_candidates_application
  on public.shortlist_candidates(application_id);

drop policy if exists "members can read shortlists" on public.shortlists;
create policy "members can read shortlists"
on public.shortlists for select to authenticated
using (public.is_company_member(company_id));

drop policy if exists "recruiters can manage shortlists" on public.shortlists;
create policy "recruiters can manage shortlists"
on public.shortlists for all to authenticated
using (public.can_manage_company_resources(company_id))
with check (public.can_manage_company_resources(company_id));

drop policy if exists "members can read shortlist candidates" on public.shortlist_candidates;
create policy "members can read shortlist candidates"
on public.shortlist_candidates for select to authenticated
using (
  exists (
    select 1
    from public.shortlists shortlist
    where shortlist.id = shortlist_candidates.shortlist_id
      and public.is_company_member(shortlist.company_id)
  )
);

drop policy if exists "recruiters can manage shortlist candidates" on public.shortlist_candidates;
create policy "recruiters can manage shortlist candidates"
on public.shortlist_candidates for all to authenticated
using (
  exists (
    select 1
    from public.shortlists shortlist
    join public.candidate_applications application
      on application.id = shortlist_candidates.application_id
    where shortlist.id = shortlist_candidates.shortlist_id
      and application.company_id = shortlist.company_id
      and application.job_id = shortlist.job_id
      and public.can_manage_company_resources(shortlist.company_id)
  )
)
with check (
  exists (
    select 1
    from public.shortlists shortlist
    join public.candidate_applications application
      on application.id = shortlist_candidates.application_id
    where shortlist.id = shortlist_candidates.shortlist_id
      and application.company_id = shortlist.company_id
      and application.job_id = shortlist.job_id
      and public.can_manage_company_resources(shortlist.company_id)
  )
);

create or replace function public.validate_shortlist_job_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.jobs job
    where job.id = new.job_id
      and job.company_id = new.company_id
  ) then
    raise exception 'Shortlist job must belong to its company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_shortlist_job_tenant on public.shortlists;
create trigger validate_shortlist_job_tenant
before insert on public.shortlists
for each row execute function public.validate_shortlist_job_tenant();

create or replace function public.prevent_shortlist_scope_reassignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.company_id is distinct from new.company_id
    or old.job_id is distinct from new.job_id then
    raise exception 'Shortlist ownership cannot be changed';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_shortlist_scope_reassignment on public.shortlists;
create trigger prevent_shortlist_scope_reassignment
before update of company_id, job_id on public.shortlists
for each row execute function public.prevent_shortlist_scope_reassignment();

create or replace function public.validate_shortlist_candidate_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.shortlists shortlist
    join public.candidate_applications application
      on application.id = new.application_id
    where shortlist.id = new.shortlist_id
      and application.company_id = shortlist.company_id
      and application.job_id = shortlist.job_id
  ) then
    raise exception 'Shortlisted application must belong to the shortlist job';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_shortlist_candidate_tenant on public.shortlist_candidates;
create trigger validate_shortlist_candidate_tenant
before insert or update of shortlist_id, application_id on public.shortlist_candidates
for each row execute function public.validate_shortlist_candidate_tenant();

create or replace function public.add_application_to_shortlist(
  target_company_id uuid,
  target_job_id uuid,
  target_application_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  default_shortlist_id uuid;
begin
  if not public.can_manage_company_resources(target_company_id) then
    raise exception 'User cannot manage shortlists for this company';
  end if;

  if not exists (
    select 1
    from public.candidate_applications application
    where application.id = target_application_id
      and application.company_id = target_company_id
      and application.job_id = target_job_id
      and application.status in ('completed', 'shortlisted')
  ) then
    raise exception 'Only completed applications can be shortlisted';
  end if;

  insert into public.shortlists (company_id, job_id, title, created_by)
  values (target_company_id, target_job_id, 'Основной шорт-лист', auth.uid())
  on conflict (job_id, title) do update
    set title = excluded.title
  returning id into default_shortlist_id;

  insert into public.shortlist_candidates (shortlist_id, application_id)
  values (default_shortlist_id, target_application_id)
  on conflict (shortlist_id, application_id) do nothing;

  update public.candidate_applications
  set
    status = 'shortlisted',
    current_stage = 'shortlist'
  where id = target_application_id
    and company_id = target_company_id
    and job_id = target_job_id;

  return default_shortlist_id;
end;
$$;

revoke all on function public.add_application_to_shortlist(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.add_application_to_shortlist(uuid, uuid, uuid)
  to authenticated;
