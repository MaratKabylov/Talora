# Scoring Framework V2 — acceptance audit

Audit date: 2026-08-23.

## Formal acceptance criteria

| # | Status | Evidence |
|---|---|---|
| 1 | Pass | Non-v2 versions are routed to the frozen legacy scorer; legacy regression tests cover points, remediation and Forced Choice. |
| 2 | Pass | Versioned `assessmentDomain` and per-item `scoringModel` are runtime-validated discriminated contracts. |
| 3 | Pass | Scale/profile scoring supports personality, motivation and behavior domains without requiring correctness. |
| 4 | Pass | Reverse transformation uses configured response bounds. |
| 5 | Pass | Mathematical normalization supports arbitrary valid min/max ranges and clamps to `0..100`. |
| 6 | Pass | Scale bindings and SJT dimension effects are independent from `is_correct`. |
| 7 | Pass | `resultShape = profile` permits and preserves `overallScore = null`. |
| 8 | Pass | Interpretation thresholds are version configuration and are validated for ranges, overlap and coverage. |
| 9 | Pass | Learning domain scorer is registered separately from question scoring. |
| 10 | Pass | Initial, recovery, gain, final and item-level recovery metrics are stored in the v2 snapshot. |
| 11 | Pass | Attention stores accuracy, completion, errors, omissions and observed response-time metrics; explicit signal items also store TP/TN/FP/FN, hit rate and false-alarm rate without heuristics. |
| 12 | Pass | Forced Choice is a registered primary model and retains the legacy ipsative mathematics. |
| 13 | Pass | Result snapshots store schema, engine and physical definition version identifiers. |
| 14 | Pass | Raw candidate and employee answers remain stored separately and are not replaced by scoring output. |
| 15 | Pass | `recalculateSessionScore` rebuilds completed results through the normal parent pipeline, preserves raw/manual response data and records reasoned pre/post audit snapshots with schema and engine versions. |
| 16 | Pass | `talvia.test.v2` schema/parser/import RPC support dimensions, item configs, thresholds, composites, profile targets and SJT. |
| 17 | Pass | AI generation guidance documents model-specific trusted scoring fields. |
| 18 | Pass | Unit, integration, import, result, registry and legacy regression tests are present. |
| 19 | Pass | `scoreSession` delegates primary models and domain calculations through registries and imports no concrete v2 scorer. |
| 20 | Pass | Typecheck, lint, tests and production build pass. |

## Result presentation

Candidate and employee reports parse the immutable v2 snapshot through the
same runtime schema and use one result component. The component renders:

- configured interpretation;
- learning initial, recovery, gain and final metrics;
- attention accuracy, errors, omissions, completion and observed time;
- profile/SJT dimensions with normalized score and answer coverage.

Profile results do not manufacture an overall percentage.

## Deliberately deferred

The specification explicitly excludes IRT/Rasch, Thurstonian IRT, inferred
percentiles or sten scores, runtime reliability estimation and complex
speed-accuracy modelling. Their extension points remain in the contracts.

The final hardening centralizes aggregate recommendation bands, adds explicit
attention signal classification and retains a tenant-scoped recalculation
history. Bulk recalculation UI and job scheduling remain future operational
work; the single-session service is the reusable foundation for them.
