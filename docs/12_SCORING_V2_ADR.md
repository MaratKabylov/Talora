# ADR: Talvia scoring v2 boundary and rollout

Status: accepted for incremental implementation (2026-08-23).

## Context

The repository has one server-only scoring module, `lib/scoring/service.ts`. Its
private `scoreSession` function is shared by candidate and employee flows, but
loading and persistence are duplicated. Item dispatch currently uses
`questions.question_type`. `test_versions.scoring_type` is a legacy test-level
switch (`points`, `competency_profile`, `manual`, `mixed`) and also controls
review/profile behavior. Candidate results use `test_results`; employee results
use `employee_assessment_test_results`.

The only import contract is `talvia.test.v1`. Preview and confirm share its
strict parser and the database import is atomic through v1 RPCs. There is no
test-definition exporter. Published versions and their nested content are
protected by database triggers, with a narrow audited rollback for an unused
system version.

## Decision

### Dispatch and version boundary

- `question_type` remains the response/UI contract.
- v2 adds a separate nullable `questions.scoring_model` and trusted
  `questions.scoring_config_json`.
- `test_versions.scoring_type` is retained unchanged for legacy versions.
- The v2 engine is selected only when `test_versions.scoring_schema_version =
  '2.0'`; all other rows continue through the legacy semantics.
- `talvia.test.v1` remains unchanged. `talvia.test.v2` will use a separate parser,
  normalized document, import path and export contract.

### Physical definition storage

Add nullable columns to `test_versions`:

- `scoring_schema_version text`;
- `assessment_domain text`;
- `result_shape text`;
- `scoring_config_json jsonb`.

Scale definitions, norm assignments, composites and the explicit overall
mapping live in `test_versions.scoring_config_json`. Presentation remains in
`settings_json`. Keeping the scoring document separate prevents trusted keys,
reverse flags and norm assignments from leaking through public presentation
loaders and avoids scattered JSON casts.

Add nullable columns to `questions`:

- `scoring_model text`;
- `scoring_config_json jsonb`.

Legacy rows are not inferred or backfilled. A legacy published version must be
cloned to a draft and configured explicitly before becoming v2.

### Result snapshot

Add the same nullable fields to `test_results` and
`employee_assessment_test_results`:

- `scoring_result_json jsonb`;
- `scoring_engine_version text`;
- `scored_at timestamptz`.

`test_version_id` is the physical `definitionVersionId`. Compatibility scalar
columns remain available. A v2 result always stores `overallScore` as JSON null
when no explicit mapping exists; legacy completed results are never rescored or
rewritten.

Candidate and employee writes will converge on one database persistence RPC so
the immutable snapshot and compatibility columns are committed atomically.

### Norms

Create platform-owned `norm_sets` and `norm_scale_definitions`. Norm versions are
immutable after publication and identified by exact `(code, version)`. They do
not have `company_id`: companies may select published platform norms but cannot
edit them. Authenticated tenant users receive only the intended published read
surface; writes remain platform-admin/server-only.

Ipsative forced-choice output is always `within_person_only`, never receives a
norm score and is excluded from cross-person ranking.

## Rollout

1. Land pure TypeScript contracts, validators and model helpers with unit tests.
2. Add an expand-only migration after `20260822130000_choice_option_shuffle.sql`:
   nullable definition/result columns, norm entities, constraints, indexes, RLS
   and immutability.
3. Add v2 import/export and publication validation while retaining v1 RPCs.
4. Add builder controls for model, scales, reverse keys, composites and norms.
5. Route v2 candidate and employee finalization through the shared engine and
   atomic persistence RPC.
6. Add versioned report readers, nullable-overall UI behavior and ranking guards.
7. Remove no legacy columns or paths until a separate contract phase.

## Consequences

The expand phase is safe for existing rows and historical reports. During the
rollout, readers must discriminate legacy and v2 definitions/results. The
temporary cost is dual read support; the benefit is that scoring semantics are
versioned, reproducible and no longer coupled to the response widget.
