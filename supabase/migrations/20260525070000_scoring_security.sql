-- Scoring outputs: review state, bounded percentages and tenant-visible read access.

alter table public.test_results
  add column if not exists requires_review boolean not null default false;

alter table public.candidate_applications
  add column if not exists requires_review boolean not null default false;

alter table public.test_sessions
  drop constraint if exists test_sessions_percentage_range;
alter table public.test_sessions
  add constraint test_sessions_percentage_range
  check (percentage is null or percentage between 0 and 100);

alter table public.test_results
  drop constraint if exists test_results_percentage_range;
alter table public.test_results
  add constraint test_results_percentage_range
  check (percentage is null or percentage between 0 and 100);

alter table public.competency_scores
  drop constraint if exists competency_scores_percentage_range;
alter table public.competency_scores
  add constraint competency_scores_percentage_range
  check (percentage is null or percentage between 0 and 100);

alter table public.application_competency_summary
  drop constraint if exists application_competency_summary_percentage_range;
alter table public.application_competency_summary
  add constraint application_competency_summary_percentage_range
  check (percentage is null or percentage between 0 and 100);

create unique index if not exists idx_competency_scores_result_key_unique
  on public.competency_scores(result_id, competency_key)
  where result_id is not null;

drop policy if exists "members can read test results" on public.test_results;
create policy "members can read test results"
on public.test_results for select to authenticated
using (
  exists (
    select 1
    from public.candidate_applications application
    where application.id = test_results.application_id
      and public.is_company_member(application.company_id)
  )
);

drop policy if exists "members can read competency scores" on public.competency_scores;
create policy "members can read competency scores"
on public.competency_scores for select to authenticated
using (
  exists (
    select 1
    from public.candidate_applications application
    where application.id = competency_scores.application_id
      and public.is_company_member(application.company_id)
  )
);

drop policy if exists "members can read application competency summary" on public.application_competency_summary;
create policy "members can read application competency summary"
on public.application_competency_summary for select to authenticated
using (
  exists (
    select 1
    from public.candidate_applications application
    where application.id = application_competency_summary.application_id
      and public.is_company_member(application.company_id)
  )
);

drop policy if exists "members can read comparison scores" on public.application_comparison_scores;
create policy "members can read comparison scores"
on public.application_comparison_scores for select to authenticated
using (
  exists (
    select 1
    from public.candidate_applications application
    where application.id = application_comparison_scores.application_id
      and public.is_company_member(application.company_id)
  )
);

drop policy if exists "members can read candidate risk flags" on public.candidate_risk_flags;
create policy "members can read candidate risk flags"
on public.candidate_risk_flags for select to authenticated
using (
  exists (
    select 1
    from public.candidate_applications application
    where application.id = candidate_risk_flags.application_id
      and public.is_company_member(application.company_id)
  )
);
