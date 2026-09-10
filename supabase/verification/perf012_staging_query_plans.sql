-- PERF-012 staging query plans for the authorized synthetic dataset.
-- Paste the whole file into Supabase SQL Editor. It is read-only and uses
-- EXPLAIN without ANALYZE, so it does not execute DML or expose tokens/PII.
--
-- The default prefix/company are from the 2026-09-10 staging run. If a new
-- synthetic run is used, replace the values in each `fixture` CTE.
-- This captures planner shapes only. It does not replace authenticated JWT/RLS
-- runtime checks, cold/warm timings, or the write-amplification gate.

begin read only;
set local statement_timeout = '15s';
set local lock_timeout = '3s';

with fixture as (
  select
    'PERF-STAGING-342e429f'::text as prefix,
    '4042019d-0b25-43b8-a0c1-c44c55897a9d'::uuid as company_id
), ids as (
  select
    fixture.prefix,
    fixture.company_id,
    (select id from public.jobs where company_id = fixture.company_id and title like fixture.prefix || '%' order by created_at, id limit 1) as job_id,
    (select id from public.employee_assessments where company_id = fixture.company_id and title like fixture.prefix || '%' order by created_at, id limit 1) as assessment_id,
    (select version.id
      from public.test_versions version
      join public.test_templates template on template.id = version.test_template_id
      where template.company_id = fixture.company_id and template.title like fixture.prefix || '%'
      order by version.created_at desc, version.id
      limit 1) as test_version_id
  from fixture
)
select jsonb_build_object(
  'checked_at', now(),
  'server_version', current_setting('server_version'),
  'prefix', prefix,
  'company_id', company_id,
  'job_id', job_id,
  'employee_assessment_id', assessment_id,
  'test_version_id', test_version_id,
  'note', 'Plans only: EXPLAIN without ANALYZE, SQL Editor role, no JWT/RLS latency.'
) as perf012_plan_context
from ids;

select 'jobs:list updated_at desc first page' as plan_name;
explain (format json, analyze false, buffers false)
with fixture as (
  select '4042019d-0b25-43b8-a0c1-c44c55897a9d'::uuid as company_id
)
select job.id, job.title, job.department, job.location, job.status, job.updated_at,
       package.title as assessment_package_title
from public.jobs job
left join public.assessment_packages package on package.id = job.assessment_package_id
cross join fixture
where job.company_id = fixture.company_id
order by job.updated_at desc, job.id asc
limit 51;

select 'candidate_applications:list latest invitation first page' as plan_name;
explain (format json, analyze false, buffers false)
with fixture as (
  select '4042019d-0b25-43b8-a0c1-c44c55897a9d'::uuid as company_id
)
select application.id, application.candidate_id, application.status, application.current_stage,
       application.overall_score, application.fit_score, application.composite_score,
       application.recommendation, application.risk_level, application.requires_review,
       application.created_at, candidate.id as candidate_id, candidate.full_name,
       candidate.email, candidate.phone, candidate.city, candidate.source,
       job.id as job_id, job.title as job_title,
       invitation.id as latest_invitation_id, invitation.status as latest_invitation_status,
       invitation.created_at as latest_invitation_created_at
from public.candidate_applications application
join public.candidates candidate on candidate.id = application.candidate_id
left join public.jobs job on job.id = application.job_id
left join lateral (
  select invitation.id, invitation.status, invitation.created_at
  from public.invitations invitation
  where invitation.application_id = application.id
  order by invitation.created_at desc, invitation.id desc
  limit 1
) invitation on true
cross join fixture
where application.company_id = fixture.company_id
order by application.created_at desc, application.id asc
limit 51;

select 'candidate_applications:job list first page' as plan_name;
explain (format json, analyze false, buffers false)
with fixture as (
  select '4042019d-0b25-43b8-a0c1-c44c55897a9d'::uuid as company_id
), target as (
  select id as job_id
  from public.jobs, fixture
  where jobs.company_id = fixture.company_id and jobs.title like 'PERF-STAGING-342e429f%'
  order by jobs.created_at, jobs.id
  limit 1
)
select application.id, application.status, application.fit_score, application.created_at,
       candidate.id as candidate_id, candidate.full_name
from public.candidate_applications application
join public.candidates candidate on candidate.id = application.candidate_id
cross join fixture
cross join target
where application.company_id = fixture.company_id
  and application.job_id = target.job_id
order by application.created_at desc, application.id asc
limit 51;

select 'candidate_applications:job comparison fit desc first page' as plan_name;
explain (format json, analyze false, buffers false)
with fixture as (
  select '4042019d-0b25-43b8-a0c1-c44c55897a9d'::uuid as company_id
), target as (
  select id as job_id
  from public.jobs, fixture
  where jobs.company_id = fixture.company_id and jobs.title like 'PERF-STAGING-342e429f%'
  order by jobs.created_at, jobs.id
  limit 1
)
select application.id, application.status, application.completed_at, application.overall_score,
       application.fit_score, application.motivation_fit, application.behavior_fit,
       application.composite_score, application.recommendation, application.risk_level,
       application.requires_review, candidate.id as candidate_id, candidate.full_name,
       summary.competency_key, summary.percentage
from public.candidate_applications application
join public.candidates candidate on candidate.id = application.candidate_id
left join public.application_competency_summary summary on summary.application_id = application.id
cross join fixture
cross join target
where application.company_id = fixture.company_id
  and application.job_id = target.job_id
order by application.fit_score desc nulls last, application.id asc
limit 51;

select 'employee_assessment_participants:list first page' as plan_name;
explain (format json, analyze false, buffers false)
with fixture as (
  select '4042019d-0b25-43b8-a0c1-c44c55897a9d'::uuid as company_id
), target as (
  select id as assessment_id
  from public.employee_assessments, fixture
  where employee_assessments.company_id = fixture.company_id
    and employee_assessments.title like 'PERF-STAGING-342e429f%'
  order by employee_assessments.created_at, employee_assessments.id
  limit 1
)
select participant.id, participant.status, participant.current_stage, participant.fit_score,
       participant.overall_score, participant.recommendation, participant.risk_level,
       participant.requires_review, participant.created_at, employee.id as employee_id,
       employee.full_name, employee.email, employee.department, employee.role_title,
       invitation.id as latest_invitation_id, invitation.status as latest_invitation_status
from public.employee_assessment_participants participant
join public.employees employee on employee.id = participant.employee_id
left join lateral (
  select invitation.id, invitation.status, invitation.created_at
  from public.employee_assessment_invitations invitation
  where invitation.participant_id = participant.id
  order by invitation.created_at desc, invitation.id desc
  limit 1
) invitation on true
cross join fixture
cross join target
where participant.company_id = fixture.company_id
  and participant.employee_assessment_id = target.assessment_id
order by participant.created_at desc, participant.id asc
limit 51;

select 'employee_assessment_participants:comparison fit desc first page' as plan_name;
explain (format json, analyze false, buffers false)
with fixture as (
  select '4042019d-0b25-43b8-a0c1-c44c55897a9d'::uuid as company_id
), target as (
  select id as assessment_id
  from public.employee_assessments, fixture
  where employee_assessments.company_id = fixture.company_id
    and employee_assessments.title like 'PERF-STAGING-342e429f%'
  order by employee_assessments.created_at, employee_assessments.id
  limit 1
)
select participant.id, participant.status, participant.completed_at, participant.overall_score,
       participant.fit_score, participant.recommendation, participant.risk_level,
       participant.requires_review, employee.id as employee_id, employee.full_name,
       summary.competency_key, summary.percentage
from public.employee_assessment_participants participant
join public.employees employee on employee.id = participant.employee_id
left join public.employee_assessment_competency_summary summary on summary.participant_id = participant.id
cross join fixture
cross join target
where participant.company_id = fixture.company_id
  and participant.employee_assessment_id = target.assessment_id
order by participant.fit_score desc nulls last, participant.id asc
limit 51;

select 'test_template_list RPC/function first page' as plan_name;
explain (format json, analyze false, buffers false)
select *
from public.list_company_test_templates('4042019d-0b25-43b8-a0c1-c44c55897a9d'::uuid)
order by updated_at desc, id asc
limit 51;

select 'assessment_package_list RPC/function first page' as plan_name;
explain (format json, analyze false, buffers false)
select *
from public.list_company_assessment_packages('4042019d-0b25-43b8-a0c1-c44c55897a9d'::uuid)
order by updated_at desc, id asc
limit 51;

select 'employee_assessment_list view first page' as plan_name;
explain (format json, analyze false, buffers false)
select id, company_id, title, status, updated_at, assessment_package_title,
       participant_count, completed_count, average_fit_score
from public.employee_assessment_list
where company_id = '4042019d-0b25-43b8-a0c1-c44c55897a9d'::uuid
order by updated_at desc, id asc
limit 51;

select 'test builder content: sections/questions/options for latest synthetic version' as plan_name;
explain (format json, analyze false, buffers false)
with fixture as (
  select '4042019d-0b25-43b8-a0c1-c44c55897a9d'::uuid as company_id
), target as (
  select version.id as test_version_id
  from public.test_versions version
  join public.test_templates template on template.id = version.test_template_id
  cross join fixture
  where template.company_id = fixture.company_id
    and template.title like 'PERF-STAGING-342e429f%'
  order by version.created_at desc, version.id
  limit 1
)
select section.id as section_id, section.order_index as section_order,
       question.id as question_id, question.order_index as question_order,
       option.id as option_id, option.order_index as option_order
from target
join public.test_sections section on section.test_version_id = target.test_version_id
left join public.questions question on question.section_id = section.id
left join public.answer_options option on option.question_id = question.id
order by section.order_index, section.id, question.order_index, question.id,
         option.order_index, option.id;

select 'index inventory for PERF-012 target tables' as plan_name;
select
  t.relname as table_name,
  c.relname as index_name,
  pg_get_indexdef(i.indexrelid) as definition,
  i.indisvalid as is_valid,
  i.indisready as is_ready,
  i.indisunique as is_unique,
  pg_relation_size(i.indexrelid) as index_bytes,
  pg_relation_size(i.indrelid) as table_bytes,
  s.idx_scan,
  s.idx_tup_read,
  s.idx_tup_fetch,
  d.stats_reset
from pg_index i
join pg_class c on c.oid = i.indexrelid
join pg_class t on t.oid = i.indrelid
join pg_namespace n on n.oid = t.relnamespace
left join pg_stat_user_indexes s on s.indexrelid = i.indexrelid
left join pg_stat_database d on d.datname = current_database()
where n.nspname = 'public'
  and t.relname in (
    'jobs', 'candidate_applications', 'test_sections', 'questions', 'answer_options',
    'employee_assessments', 'employee_assessment_participants', 'test_templates',
    'test_versions', 'assessment_packages', 'assessment_package_tests',
    'invitations', 'employee_assessment_invitations'
  )
order by t.relname, c.relname;

commit;
