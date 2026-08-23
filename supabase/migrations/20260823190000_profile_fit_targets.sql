alter table public.jobs
  add column if not exists motivation_target_profile_json jsonb not null default '[]'::jsonb,
  add column if not exists behavior_target_profile_json jsonb not null default '[]'::jsonb;

alter table public.jobs
  drop constraint if exists jobs_motivation_target_profile_json_array,
  add constraint jobs_motivation_target_profile_json_array
    check (jsonb_typeof(motivation_target_profile_json) = 'array'),
  drop constraint if exists jobs_behavior_target_profile_json_array,
  add constraint jobs_behavior_target_profile_json_array
    check (jsonb_typeof(behavior_target_profile_json) = 'array');

alter table public.candidate_applications
  add column if not exists motivation_fit numeric(5,2),
  add column if not exists behavior_fit numeric(5,2),
  drop constraint if exists candidate_applications_motivation_fit_range,
  add constraint candidate_applications_motivation_fit_range
    check (motivation_fit is null or motivation_fit between 0 and 100),
  drop constraint if exists candidate_applications_behavior_fit_range,
  add constraint candidate_applications_behavior_fit_range
    check (behavior_fit is null or behavior_fit between 0 and 100);

alter table public.application_comparison_scores
  add column if not exists motivation_fit numeric(5,2),
  add column if not exists behavior_fit numeric(5,2),
  drop constraint if exists application_comparison_scores_motivation_fit_range,
  add constraint application_comparison_scores_motivation_fit_range
    check (motivation_fit is null or motivation_fit between 0 and 100),
  drop constraint if exists application_comparison_scores_behavior_fit_range,
  add constraint application_comparison_scores_behavior_fit_range
    check (behavior_fit is null or behavior_fit between 0 and 100);

alter table public.candidate_reports
  add column if not exists motivation_fit numeric(5,2),
  add column if not exists behavior_fit numeric(5,2),
  drop constraint if exists candidate_reports_motivation_fit_range,
  add constraint candidate_reports_motivation_fit_range
    check (motivation_fit is null or motivation_fit between 0 and 100),
  drop constraint if exists candidate_reports_behavior_fit_range,
  add constraint candidate_reports_behavior_fit_range
    check (behavior_fit is null or behavior_fit between 0 and 100);

comment on column public.jobs.motivation_target_profile_json is
  'Weighted preferred ranges for motivation dimensions used only by motivation_fit.';
comment on column public.jobs.behavior_target_profile_json is
  'Weighted preferred ranges for behavior dimensions used only by behavior_fit.';
