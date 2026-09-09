-- PERF-010: SELECT-only views run with the caller's existing table privileges/RLS.
-- No service-role RPC and no new access policy for business data.
create view public.test_template_list with (security_invoker = true) as
select t.id, t.company_id, t.title, t.category, t.is_system, t.status, t.updated_at,
  v.id as latest_version_id, v.version_number as latest_version_number,
  v.status as latest_version_status,
  p.id as published_version_id, p.version_number as published_version_number,
  p.status as published_version_status,
  (select count(*) from public.test_versions c where c.test_template_id = t.id) as version_count,
  exists (select 1 from public.test_versions c where c.test_template_id = t.id and c.status = 'draft') as has_draft
from public.test_templates t
left join lateral (
  select id, version_number, status from public.test_versions
  where test_template_id = t.id order by version_number desc, id desc limit 1
) v on true
left join lateral (
  select id, version_number, status from public.test_versions
  where test_template_id = t.id and status = 'published'
  order by version_number desc, id desc limit 1
) p on true;

create view public.assessment_package_list with (security_invoker = true) as
select p.id, p.company_id, p.title, p.is_system, p.updated_at,
  s.test_count, s.required_count, s.duration_minutes
from public.assessment_packages p
left join lateral (
   select count(*) as test_count, count(*) filter (where pt.is_required) as required_count,
     coalesce(sum(v.duration_minutes), 0) as duration_minutes
   from public.assessment_package_tests pt
   join public.test_versions v on v.id = pt.test_version_id
   join public.test_templates t on t.id = v.test_template_id
   where pt.package_id = p.id
) s on true;

create view public.employee_assessment_list with (security_invoker = true) as
select a.id, a.company_id, a.title, a.status, a.updated_at,
  p.title as assessment_package_title,
  s.participant_count, s.completed_count, s.average_fit_score
from public.employee_assessments a
left join public.assessment_packages p on p.id = a.assessment_package_id
left join lateral (
  select count(*) as participant_count,
    count(*) filter (where status = 'completed') as completed_count,
    avg(fit_score) as average_fit_score
  from public.employee_assessment_participants
  where employee_assessment_id = a.id and company_id = a.company_id
) s on true;

revoke all on public.test_template_list, public.assessment_package_list,
  public.employee_assessment_list from public, anon, authenticated, service_role;
grant select on public.test_template_list, public.assessment_package_list,
  public.employee_assessment_list to authenticated, service_role;

create view public.job_comparison_summary with (security_invoker = true) as
select j.id, j.company_id, s.* from public.jobs j
left join lateral (
  select count(*) as participant_count,
    count(*) filter (where status in ('completed', 'shortlisted')) as completed_count,
    count(*) filter (where status = 'shortlisted') as shortlisted_count,
    avg(fit_score) as average_fit_score
  from public.candidate_applications
  where job_id = j.id and company_id = j.company_id
) s on true;

create view public.employee_comparison_filters with (security_invoker = true) as
select a.id, a.company_id, s.* from public.employee_assessments a
left join lateral (
  select array_agg(distinct e.department order by e.department)
      filter (where nullif(e.department, '') is not null) as departments,
    array_agg(distinct e.role_title order by e.role_title)
      filter (where nullif(e.role_title, '') is not null) as role_titles
  from public.employee_assessment_participants p
  join public.employees e on e.id = p.employee_id and e.company_id = p.company_id
  where p.employee_assessment_id = a.id and p.company_id = a.company_id
) s on true;

revoke all on public.job_comparison_summary, public.employee_comparison_filters
  from public, anon, authenticated, service_role;
grant select on public.job_comparison_summary, public.employee_comparison_filters
  to authenticated, service_role;

notify pgrst, 'reload schema';
