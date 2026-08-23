-- Learning is a first-class V2 assessment domain. Raw initial and recovery
-- answers remain in the existing answer tables and are linked by versioned
-- question settings, so no destructive answer migration is required.

alter table public.test_versions
  drop constraint if exists test_versions_assessment_domain_check,
  add constraint test_versions_assessment_domain_check
    check (
      assessment_domain is null
      or assessment_domain in (
        'knowledge', 'skills', 'personality', 'motivation',
        'behavior', 'learning', 'attention', 'sjt', 'mixed', 'other'
      )
    );

comment on column public.test_versions.assessment_domain is
  'Validated V2 assessment domain. Learning metrics are stored in the immutable scoring result snapshot.';
