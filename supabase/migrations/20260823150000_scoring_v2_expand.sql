-- Talvia scoring v2 expand phase.
-- Legacy definitions/results remain untouched; no completed session is rescored.

alter table public.test_versions
  add column if not exists scoring_schema_version text,
  add column if not exists assessment_domain text,
  add column if not exists result_shape text,
  add column if not exists scoring_config_json jsonb;

alter table public.test_versions
  drop constraint if exists test_versions_scoring_schema_version_check,
  add constraint test_versions_scoring_schema_version_check
    check (scoring_schema_version is null or scoring_schema_version = '2.0'),
  drop constraint if exists test_versions_assessment_domain_check,
  add constraint test_versions_assessment_domain_check
    check (
      assessment_domain is null
      or assessment_domain in (
        'knowledge', 'skills', 'personality', 'motivation',
        'behavior', 'mixed', 'other'
      )
    ),
  drop constraint if exists test_versions_result_shape_check,
  add constraint test_versions_result_shape_check
    check (result_shape is null or result_shape in ('score', 'profile', 'hybrid')),
  drop constraint if exists test_versions_scoring_config_object_check,
  add constraint test_versions_scoring_config_object_check
    check (
      scoring_config_json is null
      or jsonb_typeof(scoring_config_json) = 'object'
    ),
  drop constraint if exists test_versions_v2_definition_fields_check,
  add constraint test_versions_v2_definition_fields_check
    check (
      (
        scoring_schema_version is null
        and assessment_domain is null
        and result_shape is null
        and scoring_config_json is null
      )
      or (
        scoring_schema_version = '2.0'
        and assessment_domain is not null
        and result_shape is not null
        and scoring_config_json is not null
        and scoring_config_json ->> 'schemaVersion' = '2.0'
      )
    );

comment on column public.test_versions.scoring_schema_version is
  'Null selects legacy scoring_type semantics; 2.0 selects the versioned scoring definition.';
comment on column public.test_versions.scoring_config_json is
  'Trusted v2 scale/composite/norm/overall definition. Never expose through public assessment loaders.';

alter table public.questions
  add column if not exists scoring_model text,
  add column if not exists scoring_config_json jsonb;

alter table public.questions
  drop constraint if exists questions_scoring_model_check,
  add constraint questions_scoring_model_check
    check (scoring_model is null or scoring_model in ('criterion', 'scale', 'forced_choice')),
  drop constraint if exists questions_scoring_config_object_check,
  add constraint questions_scoring_config_object_check
    check (
      scoring_config_json is null
      or jsonb_typeof(scoring_config_json) = 'object'
    ),
  drop constraint if exists questions_scoring_fields_consistent_check,
  add constraint questions_scoring_fields_consistent_check
    check (
      (scoring_model is null and scoring_config_json is null)
      or (scoring_model is not null and scoring_config_json is not null)
    );

comment on column public.questions.scoring_model is
  'Trusted scoring dispatch key, independent from question_type. Null preserves legacy behavior.';
comment on column public.questions.scoring_config_json is
  'Trusted item scoring config. Must not be serialized to candidate or employee clients.';

alter table public.test_results
  add column if not exists scoring_result_json jsonb,
  add column if not exists scoring_engine_version text,
  add column if not exists scored_at timestamptz;

alter table public.test_results
  drop constraint if exists test_results_scoring_result_object_check,
  add constraint test_results_scoring_result_object_check
    check (
      scoring_result_json is null
      or (
        jsonb_typeof(scoring_result_json) = 'object'
        and scoring_result_json ->> 'schemaVersion' = '2.0'
        and scoring_result_json ->> 'engineVersion' = scoring_engine_version
        and scoring_result_json ->> 'definitionVersionId' = test_version_id::text
        and scoring_result_json ? 'overallScore'
        and scoring_result_json ->> 'status' in (
          'complete', 'partial', 'insufficient_data', 'requires_review'
        )
      )
    ),
  drop constraint if exists test_results_scoring_snapshot_fields_check,
  add constraint test_results_scoring_snapshot_fields_check
    check (
      (scoring_result_json is null and scoring_engine_version is null and scored_at is null)
      or (
        scoring_result_json is not null
        and scoring_engine_version is not null
        and scored_at is not null
      )
    );

alter table public.employee_assessment_test_results
  add column if not exists scoring_result_json jsonb,
  add column if not exists scoring_engine_version text,
  add column if not exists scored_at timestamptz;

alter table public.employee_assessment_test_results
  drop constraint if exists employee_test_results_scoring_result_object_check,
  add constraint employee_test_results_scoring_result_object_check
    check (
      scoring_result_json is null
      or (
        jsonb_typeof(scoring_result_json) = 'object'
        and scoring_result_json ->> 'schemaVersion' = '2.0'
        and scoring_result_json ->> 'engineVersion' = scoring_engine_version
        and scoring_result_json ->> 'definitionVersionId' = test_version_id::text
        and scoring_result_json ? 'overallScore'
        and scoring_result_json ->> 'status' in (
          'complete', 'partial', 'insufficient_data', 'requires_review'
        )
      )
    ),
  drop constraint if exists employee_test_results_scoring_snapshot_fields_check,
  add constraint employee_test_results_scoring_snapshot_fields_check
    check (
      (scoring_result_json is null and scoring_engine_version is null and scored_at is null)
      or (
        scoring_result_json is not null
        and scoring_engine_version is not null
        and scored_at is not null
      )
    );

create table if not exists public.norm_sets (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Za-z][A-Za-z0-9_.-]{0,159}$'),
  version integer not null check (version > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  title text not null check (char_length(btrim(title)) between 1 and 240),
  population_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(population_json) = 'object'
    and char_length(btrim(coalesce(population_json ->> 'label', ''))) between 1 and 240
  ),
  locale text,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  sample_size integer not null check (sample_size > 0),
  methodology text not null check (char_length(btrim(methodology)) between 1 and 20000),
  source_reference text,
  published_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(code, version),
  constraint norm_sets_published_at_check check (
    (status = 'draft' and published_at is null)
    or (status in ('published', 'retired') and published_at is not null)
  )
);

create table if not exists public.norm_scale_definitions (
  id uuid primary key default gen_random_uuid(),
  norm_set_id uuid not null references public.norm_sets(id) on delete cascade,
  scale_code text not null check (scale_code ~ '^[A-Za-z][A-Za-z0-9_.-]{0,159}$'),
  score_basis text not null check (score_basis in ('raw_score', 'normalized_score')),
  conversion_method text not null check (conversion_method in ('percentile_table', 'z_score')),
  parameters_json jsonb not null check (jsonb_typeof(parameters_json) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(norm_set_id, scale_code)
);

create index if not exists idx_norm_sets_status_code_version
  on public.norm_sets(status, code, version desc);
create index if not exists idx_norm_scale_definitions_norm_set
  on public.norm_scale_definitions(norm_set_id);

drop trigger if exists set_norm_sets_updated_at on public.norm_sets;
create trigger set_norm_sets_updated_at
before update on public.norm_sets
for each row execute function public.set_updated_at();

drop trigger if exists set_norm_scale_definitions_updated_at on public.norm_scale_definitions;
create trigger set_norm_scale_definitions_updated_at
before update on public.norm_scale_definitions
for each row execute function public.set_updated_at();

create or replace function public.protect_published_norm_set()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.published_at is not null then
      raise exception 'Norm sets must be created as drafts';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status in ('published', 'retired') then
      raise exception 'Published or retired norm sets cannot be deleted';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.status in ('published', 'retired') then
    if old.status = 'published'
      and new.status = 'retired'
      and new.published_at = old.published_at
      and (
        to_jsonb(new) - array['status', 'updated_at']
        = to_jsonb(old) - array['status', 'updated_at']
      )
    then
      return new;
    end if;
    raise exception 'Published or retired norm sets are immutable';
  end if;

  if new.status = 'published' then
    if not exists (
      select 1
      from public.norm_scale_definitions definition
      where definition.norm_set_id = new.id
    ) then
      raise exception 'A norm set must contain at least one scale definition before publication';
    end if;
    new.published_at = coalesce(new.published_at, now());
  elsif new.status = 'draft' then
    new.published_at = null;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_published_norm_set on public.norm_sets;
create trigger protect_published_norm_set
before insert or update or delete on public.norm_sets
for each row execute function public.protect_published_norm_set();

create or replace function public.protect_published_norm_scale_definition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_norm_set_id uuid;
begin
  selected_norm_set_id := case when tg_op = 'DELETE' then old.norm_set_id else new.norm_set_id end;

  if exists (
    select 1
    from public.norm_sets norm_set
    where norm_set.id = selected_norm_set_id
      and norm_set.status in ('published', 'retired')
  ) then
    raise exception 'Definitions of published or retired norm sets are immutable';
  end if;

  if tg_op = 'UPDATE' and old.norm_set_id <> new.norm_set_id and exists (
    select 1
    from public.norm_sets norm_set
    where norm_set.id = old.norm_set_id
      and norm_set.status in ('published', 'retired')
  ) then
    raise exception 'Definitions cannot be moved from a published or retired norm set';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_published_norm_scale_definition
on public.norm_scale_definitions;
create trigger protect_published_norm_scale_definition
before insert or update or delete on public.norm_scale_definitions
for each row execute function public.protect_published_norm_scale_definition();

alter table public.norm_sets enable row level security;
alter table public.norm_scale_definitions enable row level security;

drop policy if exists "authenticated users can read published norm sets"
on public.norm_sets;
create policy "authenticated users can read published norm sets"
on public.norm_sets for select to authenticated
using (status = 'published');

drop policy if exists "authenticated users can read published norm definitions"
on public.norm_scale_definitions;
create policy "authenticated users can read published norm definitions"
on public.norm_scale_definitions for select to authenticated
using (
  exists (
    select 1
    from public.norm_sets norm_set
    where norm_set.id = norm_scale_definitions.norm_set_id
      and norm_set.status = 'published'
  )
);

revoke all on table public.norm_sets from anon;
revoke all on table public.norm_scale_definitions from anon;
revoke insert, update, delete on table public.norm_sets from authenticated;
revoke insert, update, delete on table public.norm_scale_definitions from authenticated;
grant select on table public.norm_sets to authenticated;
grant select on table public.norm_scale_definitions to authenticated;

revoke all on function public.protect_published_norm_set() from public, anon, authenticated;
revoke all on function public.protect_published_norm_scale_definition()
  from public, anon, authenticated;
