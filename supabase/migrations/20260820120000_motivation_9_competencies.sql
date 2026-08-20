-- Backward-compatible competency key expansion for Talvia Motivation-9 FC.
-- Existing motivation_structure data remains valid, while four new keys become
-- available to questions and option-level competency effects.

alter table public.questions
  drop constraint if exists questions_competency_key_supported;
alter table public.questions
  add constraint questions_competency_key_supported
  check (
    competency_key is null
    or competency_key in (
      'learning_ability', 'attention_to_detail', 'logical_reasoning', 'work_behavior',
      'communication', 'responsibility', 'work_organization', 'work_initiative',
      'work_result_orientation', 'work_collaboration', 'work_adaptability',
      'motivation_result', 'motivation_growth', 'motivation_autonomy',
      'motivation_influence', 'motivation_team', 'motivation_stability',
      'motivation_income', 'motivation_recognition', 'motivation_meaning',
      'motivation_structure'
    )
  );

create or replace function public.has_supported_competency_effects(effects jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(effects) = 'object'
    and not exists (
      select 1
      from jsonb_object_keys(effects) as keys(effect_key)
      where keys.effect_key not in (
        'learning_ability', 'attention_to_detail', 'logical_reasoning', 'work_behavior',
        'communication', 'responsibility', 'work_organization', 'work_initiative',
        'work_result_orientation', 'work_collaboration', 'work_adaptability',
        'motivation_result', 'motivation_growth', 'motivation_autonomy',
        'motivation_influence', 'motivation_team', 'motivation_stability',
        'motivation_income', 'motivation_recognition', 'motivation_meaning',
        'motivation_structure'
      )
    )
    and not exists (
      select 1
      from jsonb_each(effects) as effect
      where jsonb_typeof(effect.value) <> 'number'
    );
$$;
