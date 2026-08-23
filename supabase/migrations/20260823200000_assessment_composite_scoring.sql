alter table public.jobs
  add column if not exists composite_scoring_config_json jsonb;

alter table public.jobs
  drop constraint if exists jobs_composite_scoring_config_json_object,
  add constraint jobs_composite_scoring_config_json_object
    check (
      composite_scoring_config_json is null
      or jsonb_typeof(composite_scoring_config_json) = 'object'
    );

alter table public.candidate_applications
  add column if not exists composite_score numeric(5,2),
  add column if not exists composite_result_json jsonb,
  drop constraint if exists candidate_applications_composite_score_range,
  add constraint candidate_applications_composite_score_range
    check (composite_score is null or composite_score between 0 and 100),
  drop constraint if exists candidate_applications_composite_result_json_object,
  add constraint candidate_applications_composite_result_json_object
    check (composite_result_json is null or jsonb_typeof(composite_result_json) = 'object');

alter table public.application_comparison_scores
  add column if not exists composite_score numeric(5,2),
  drop constraint if exists application_comparison_scores_composite_score_range,
  add constraint application_comparison_scores_composite_score_range
    check (composite_score is null or composite_score between 0 and 100);

alter table public.candidate_reports
  add column if not exists composite_score numeric(5,2),
  add column if not exists composite_result_json jsonb,
  drop constraint if exists candidate_reports_composite_score_range,
  add constraint candidate_reports_composite_score_range
    check (composite_score is null or composite_score between 0 and 100),
  drop constraint if exists candidate_reports_composite_result_json_object,
  add constraint candidate_reports_composite_result_json_object
    check (composite_result_json is null or jsonb_typeof(composite_result_json) = 'object');

create index if not exists idx_comparison_job_composite
  on public.application_comparison_scores(job_id, composite_score desc);

comment on column public.jobs.composite_scoring_config_json is
  'Assessment-level composite configuration evaluated over test, dimension, and fit results.';
comment on column public.candidate_applications.composite_result_json is
  'Reproducible calculation snapshot with resolved sources, weights, coverage, and missing policy.';
