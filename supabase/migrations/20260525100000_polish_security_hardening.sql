-- Polish security hardening: tighter RLS helpers and scoring-output integrity.

create or replace function public.is_company_member(target_company_id uuid)
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
  );
$$;

revoke all on function public.is_company_member(uuid) from public, anon;
grant execute on function public.is_company_member(uuid) to authenticated;

create or replace function public.is_company_admin(target_company_id uuid)
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
      and cu.role in ('owner', 'admin', 'super_admin')
  );
$$;

revoke all on function public.is_company_admin(uuid) from public, anon;
grant execute on function public.is_company_admin(uuid) to authenticated;

create or replace function public.validate_test_result_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.test_sessions session
    where session.id = new.session_id
      and session.application_id = new.application_id
      and session.candidate_id = new.candidate_id
      and session.test_version_id = new.test_version_id
  ) then
    raise exception 'Test result must match its test session';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_test_result_scope on public.test_results;
create trigger validate_test_result_scope
before insert or update of session_id, application_id, candidate_id, test_version_id
on public.test_results
for each row execute function public.validate_test_result_scope();

create or replace function public.validate_competency_score_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.result_id is not null
    and not exists (
      select 1
      from public.test_results result
      where result.id = new.result_id
        and result.application_id = new.application_id
    ) then
    raise exception 'Competency score must match its application result';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_competency_score_scope on public.competency_scores;
create trigger validate_competency_score_scope
before insert or update of result_id, application_id on public.competency_scores
for each row execute function public.validate_competency_score_scope();

create or replace function public.validate_comparison_score_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.candidate_applications application
    where application.id = new.application_id
      and application.job_id = new.job_id
      and application.candidate_id = new.candidate_id
  ) then
    raise exception 'Comparison score must match its application';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_comparison_score_scope on public.application_comparison_scores;
create trigger validate_comparison_score_scope
before insert or update of application_id, job_id, candidate_id
on public.application_comparison_scores
for each row execute function public.validate_comparison_score_scope();

create or replace function public.validate_candidate_report_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.candidate_applications application
    where application.id = new.application_id
      and application.candidate_id = new.candidate_id
  ) then
    raise exception 'Candidate report must match its application';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_candidate_report_scope on public.candidate_reports;
create trigger validate_candidate_report_scope
before insert or update of application_id, candidate_id on public.candidate_reports
for each row execute function public.validate_candidate_report_scope();

revoke all on function public.validate_test_result_scope() from public, anon, authenticated;
revoke all on function public.validate_competency_score_scope() from public, anon, authenticated;
revoke all on function public.validate_comparison_score_scope() from public, anon, authenticated;
revoke all on function public.validate_candidate_report_scope() from public, anon, authenticated;
