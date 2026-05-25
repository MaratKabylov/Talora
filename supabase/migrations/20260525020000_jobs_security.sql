-- Secure tenant-bound mutations needed by the Jobs milestone.

create or replace function public.can_manage_company_resources(target_company_id uuid)
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
      and cu.role in ('owner', 'admin', 'recruiter', 'super_admin')
  );
$$;

revoke all on function public.can_manage_company_resources(uuid) from public, anon;
grant execute on function public.can_manage_company_resources(uuid) to authenticated;

drop policy if exists "recruiters can manage jobs" on public.jobs;
create policy "recruiters can manage jobs"
on public.jobs for all to authenticated
using (public.can_manage_company_resources(company_id))
with check (public.can_manage_company_resources(company_id));

drop policy if exists "members can manage job competency weights" on public.job_competency_weights;
create policy "recruiters can manage job competency weights"
on public.job_competency_weights for all to authenticated
using (public.can_manage_company_resources(company_id))
with check (public.can_manage_company_resources(company_id));

-- A company package can be edited only as a non-system package; system content is seeded server-side.
drop policy if exists "members can manage own packages" on public.assessment_packages;
create policy "recruiters can manage own packages"
on public.assessment_packages for all to authenticated
using (
  is_system = false
  and company_id is not null
  and public.can_manage_company_resources(company_id)
)
with check (
  is_system = false
  and company_id is not null
  and public.can_manage_company_resources(company_id)
);

create or replace function public.validate_job_assessment_package_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assessment_package_id is not null
     and not exists (
       select 1
       from public.assessment_packages ap
       where ap.id = new.assessment_package_id
         and (ap.is_system = true or ap.company_id = new.company_id)
     ) then
    raise exception 'Assessment package is not available to the job company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_jobs_assessment_package_tenant on public.jobs;
create trigger validate_jobs_assessment_package_tenant
before insert or update of company_id, assessment_package_id on public.jobs
for each row execute function public.validate_job_assessment_package_tenant();

create or replace function public.validate_job_competency_weight_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.jobs j
    where j.id = new.job_id
      and j.company_id = new.company_id
  ) then
    raise exception 'Job competency weight must belong to the job company';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_job_competency_weight_tenant on public.job_competency_weights;
create trigger validate_job_competency_weight_tenant
before insert or update of company_id, job_id on public.job_competency_weights
for each row execute function public.validate_job_competency_weight_tenant();

alter table public.jobs
  drop constraint if exists jobs_passing_score_range;
alter table public.jobs
  add constraint jobs_passing_score_range
  check (passing_score is null or passing_score between 0 and 100);

alter table public.job_competency_weights
  drop constraint if exists job_competency_weights_weight_range;
alter table public.job_competency_weights
  add constraint job_competency_weights_weight_range
  check (weight between 0 and 1);

alter table public.job_competency_weights
  drop constraint if exists job_competency_weights_minimum_range;
alter table public.job_competency_weights
  add constraint job_competency_weights_minimum_range
  check (minimum_score is null or minimum_score between 0 and 100);

drop trigger if exists set_job_competency_weights_updated_at on public.job_competency_weights;
create trigger set_job_competency_weights_updated_at before update on public.job_competency_weights
for each row execute function public.set_updated_at();
