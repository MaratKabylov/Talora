-- PERF-014: materialize employee comparison dimensions in the atomic scoring snapshot.

create table if not exists public.employee_assessment_dimension_scores (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  employee_assessment_id uuid not null references public.employee_assessments(id) on delete cascade,
  participant_id uuid not null references public.employee_assessment_participants(id) on delete cascade,
  session_id uuid references public.employee_assessment_sessions(id) on delete cascade,
  test_version_id uuid references public.test_versions(id) on delete restrict,
  dimension_id text not null,
  dimension_key text not null,
  group_key text not null check (group_key in (
    'cognitive', 'work_competencies', 'behavior', 'motivation',
    'personality', 'knowledge_skills', 'other'
  )),
  title text not null,
  percentage numeric(5,2) check (percentage is null or percentage between 0 and 100),
  interpretation_direction text not null check (
    interpretation_direction in ('higher_better', 'lower_better', 'neutral')
  ),
  assessment_domain text not null check (assessment_domain in (
    'knowledge', 'skills', 'personality', 'motivation', 'behavior',
    'learning', 'attention', 'sjt', 'mixed', 'other'
  )),
  source_type text not null check (source_type in (
    'criterion', 'scale', 'forced_choice', 'composite', 'legacy_competency'
  )),
  display_order integer,
  scoring_revision integer not null check (scoring_revision > 0),
  created_at timestamptz not null default now(),
  constraint employee_dimension_id_not_blank check (
    char_length(dimension_id) between 1 and 500
  ),
  constraint employee_dimension_key_not_blank check (
    char_length(dimension_key) between 1 and 200
  ),
  constraint employee_dimension_title_not_blank check (
    char_length(title) between 1 and 500
  ),
  constraint employee_dimension_session_version_pair check (
    (session_id is null and test_version_id is null)
    or (session_id is not null and test_version_id is not null)
  ),
  unique (participant_id, scoring_revision, dimension_id)
);

create index if not exists employee_dimension_scores_assessment_participant
  on public.employee_assessment_dimension_scores
  (company_id, employee_assessment_id, participant_id, display_order, dimension_id);

comment on table public.employee_assessment_dimension_scores is
  'Current normalized employee comparison dimensions, replaced atomically with each scoring revision.';

alter table public.employee_assessment_dimension_scores enable row level security;

drop policy if exists "members can read employee assessment dimensions"
  on public.employee_assessment_dimension_scores;
create policy "members can read employee assessment dimensions"
on public.employee_assessment_dimension_scores for select to authenticated
using (public.is_company_member(company_id));

revoke all on table public.employee_assessment_dimension_scores from anon, authenticated;
grant select on table public.employee_assessment_dimension_scores to authenticated;

-- Keep the original persistence function as the inner snapshot writer. Only this
-- wrapper remains callable by service_role so dimensions cannot be omitted.
revoke all on function public.persist_scoring_snapshot(text, uuid, integer, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.replace_employee_assessment_dimensions(
  p_parent_id uuid,
  p_expected_revision integer,
  p_dimensions jsonb,
  p_replace_existing boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry jsonb;
  affected integer;
  inserted_count integer := 0;
  current_revision integer;
  parent_company_id uuid;
  parent_assessment_id uuid;
begin
  if jsonb_typeof(p_dimensions) is distinct from 'array'
     or jsonb_array_length(p_dimensions) > 10000
  then
    raise exception 'Employee scoring dimensions must be a bounded array';
  end if;

  select participant.scoring_revision, participant.company_id,
         participant.employee_assessment_id
  into current_revision, parent_company_id, parent_assessment_id
  from public.employee_assessment_participants participant
  where participant.id = p_parent_id
  for update;

  if not found then
    raise exception 'Employee assessment participant was not found';
  end if;
  if current_revision <> p_expected_revision then
    return jsonb_build_object(
      'conflict', true,
      'expected_revision', p_expected_revision,
      'revision', current_revision
    );
  end if;
  if not p_replace_existing and exists (
    select 1
    from public.employee_assessment_dimension_scores dimension
    where dimension.participant_id = p_parent_id
      and dimension.scoring_revision = current_revision
  ) then
    return jsonb_build_object(
      'conflict', false,
      'inserted_count', 0,
      'revision', current_revision,
      'status', 'already_materialized'
    );
  end if;

  delete from public.employee_assessment_dimension_scores dimension
  where dimension.participant_id = p_parent_id;

  for entry in
    select item.value
    from jsonb_array_elements(p_dimensions) item(value)
  loop
    insert into public.employee_assessment_dimension_scores (
      company_id, employee_assessment_id, participant_id,
      session_id, test_version_id, dimension_id, dimension_key,
      group_key, title, percentage, interpretation_direction,
      assessment_domain, source_type, display_order, scoring_revision
    )
    select parent_company_id, parent_assessment_id, p_parent_id,
           nullif(entry ->> 'session_id', '')::uuid,
           nullif(entry ->> 'test_version_id', '')::uuid,
           entry ->> 'dimension_id', entry ->> 'dimension_key',
           entry ->> 'group_key', entry ->> 'title',
           (entry ->> 'percentage')::numeric,
           entry ->> 'interpretation_direction',
           entry ->> 'assessment_domain', entry ->> 'source_type',
           (entry ->> 'display_order')::integer, current_revision
    where (
      entry ->> 'session_id' is null
      and entry ->> 'test_version_id' is null
    ) or exists (
      select 1
      from public.employee_assessment_sessions session
      where session.id = (entry ->> 'session_id')::uuid
        and session.participant_id = p_parent_id
        and session.test_version_id = (entry ->> 'test_version_id')::uuid
    );
    get diagnostics affected = row_count;
    if affected <> 1 then
      raise exception 'Employee dimension does not belong to scoring parent';
    end if;
    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object(
    'conflict', false,
    'inserted_count', inserted_count,
    'revision', current_revision,
    'status', 'materialized'
  );
end;
$$;

revoke all on function public.replace_employee_assessment_dimensions(uuid, integer, jsonb, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.backfill_employee_assessment_dimensions(
  p_parent_id uuid,
  p_expected_revision integer,
  p_dimensions jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.replace_employee_assessment_dimensions(
    p_parent_id,
    p_expected_revision,
    p_dimensions,
    false
  );
$$;

revoke all on function public.backfill_employee_assessment_dimensions(uuid, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.backfill_employee_assessment_dimensions(uuid, integer, jsonb)
  to service_role;

create or replace function public.try_persist_scoring_snapshot(
  p_scope text,
  p_parent_id uuid,
  p_expected_revision integer,
  p_snapshot jsonb,
  p_audit jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_revision integer;
  persisted jsonb;
begin
  if p_scope = 'candidate' then
    select application.scoring_revision
    into current_revision
    from public.candidate_applications application
    where application.id = p_parent_id
    for update;
  elsif p_scope = 'employee' then
    select participant.scoring_revision
    into current_revision
    from public.employee_assessment_participants participant
    where participant.id = p_parent_id
    for update;
  else
    raise exception 'Invalid scoring persistence scope';
  end if;

  if not found then
    raise exception 'Scoring persistence parent was not found';
  end if;

  if current_revision <> p_expected_revision then
    return jsonb_build_object(
      'audit_id', null,
      'conflict', true,
      'expected_revision', p_expected_revision,
      'revision', current_revision
    );
  end if;

  if p_scope = 'employee' and (
    jsonb_typeof(p_snapshot -> 'dimensions') is distinct from 'array'
    or jsonb_array_length(p_snapshot -> 'dimensions') > 10000
  ) then
    raise exception 'Employee scoring dimensions must be a bounded array';
  end if;

  persisted := public.persist_scoring_snapshot(
    p_scope,
    p_parent_id,
    p_expected_revision,
    p_snapshot,
    p_audit
  );

  if p_scope = 'employee' then
    perform public.replace_employee_assessment_dimensions(
      p_parent_id,
      (persisted ->> 'revision')::integer,
      p_snapshot -> 'dimensions',
      true
    );
  end if;

  return persisted || jsonb_build_object('conflict', false);
end;
$$;

revoke all on function public.try_persist_scoring_snapshot(text, uuid, integer, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.try_persist_scoring_snapshot(text, uuid, integer, jsonb, jsonb)
  to service_role;
