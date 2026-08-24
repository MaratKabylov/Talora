# Scoring Framework V2: recommendation, interpretation and atomic persistence

## Scoring lifecycle

```text
Raw answers
→ calculation
→ immutable scoring snapshot
→ atomic persistence
→ scoring revision
→ reporting interpretation
```

Calculation finishes before the first derived write. Candidate and employee
completion both call `persist_scoring_snapshot`, a service-role-only PostgreSQL
RPC. The function locks the parent application/participant row, verifies the
expected `scoring_revision`, and writes scored answer fields, session totals,
test results, competencies, summaries, fit/composite/overall values, risks,
recommendation and the generated report in one database transaction.

A persistence error leaves every previous derived row unchanged. Raw response
payloads (`selected_option_id`, `answer_text`, `answer_json` and response time)
are never written by scoring. Replacing child collections is idempotent and
cannot create duplicate competency rows.

The parent `scoring_revision` starts at `0` when no result exists. The first
successful snapshot becomes revision `1`; every successful recalculation adds
exactly one. A row lock plus compare-and-set rejects concurrent calculations
that started from the same revision. `scored_at` remains the initial scoring
time, while `recalculated_at` records the latest successful recalculation.

For recalculation, the completed audit row is inserted by the same RPC after
all derived writes. An audit insert failure therefore rolls back the scoring
snapshot. Failed attempts are recorded separately after rollback and never
contain `new_result_json` or `new_revision`.

## Three independent policies

- Test `thresholds` interpret the score of one concrete test version, such as
  `basic`, `proficient` or `advanced`.
- Recommendation Policy selects the hiring recommendation from aggregate
  `fit_score`, `overall_score` or `composite_score`.
- Interpretation Policy classifies report indicators as `strength`, `neutral`
  or `development_area` and drives threshold-based interview guidance.

The three configurations do not fall back to one another.

## Interpretation policy

Report interpretation belongs to the hiring/assessment workflow and is stored
on `jobs.interpretation_policy_json` or
`employee_assessments.interpretation_policy_json`. A null value uses
`DEFAULT_INTERPRETATION_POLICY`, preserving the deployed boundaries:

```json
{
  "bands": [
    { "min": 0, "max": 64.99, "code": "development_area" },
    { "min": 65, "max": 74.99, "code": "neutral" },
    { "min": 75, "max": 100, "code": "strength" }
  ]
}
```

Policies must cover `0..100` without gaps or overlaps and use unique codes.
Report generation calls `interpretReportScore`; it does not compare scores to
local numeric thresholds. Personality and motivation dimensions default to
the non-evaluative `neutral` direction and yield `low`, `medium` or `high`
expression bands. Knowledge and performance indicators default to
`higher_is_better`. Explicit directions are limited to
`higher_is_better`, `lower_is_better`, `neutral` and `target_range`.
The resolved direction is persisted on the aggregate competency summary so a
later report read retains the original domain semantics.

### Threshold audit

- `65/85` in `LEGACY_SCORE_THRESHOLDS` remain test-result thresholds.
- `50/65/75/85` live only in `DEFAULT_RECOMMENDATION_POLICY`.
- `65/75` live only in `DEFAULT_INTERPRETATION_POLICY` for legacy report
  compatibility.
- `0.75/0.9` in coverage confidence remain confidence-level classification,
  not report or hiring thresholds; changing them would alter an existing
  Scoring V2 output.
- Limits such as collection size `50`, normalization `0..100`, and rounding to
  two decimals are validation or mathematical constants, not business policy.

## Recommendation policy

Test `thresholds` belong to a concrete version and only interpret that test's
own score. Aggregate hiring recommendation is a separate policy owned by the
job (`jobs.recommendation_policy_json`) or employee assessment
(`employee_assessments.recommendation_policy_json`).

The runtime policy has one primary `source`: `fit_score`, `overall_score` or
`composite_score`, plus complete non-overlapping `bands` over `0..100`. Invalid
sources, duplicate codes, gaps, overlaps and inverted bounds stop scoring with
a validation error. They never silently fall back to arbitrary bands.

Null policy values use `DEFAULT_RECOMMENDATION_POLICY`. It centralizes the
historical 50/65/75/85 bands and, only for backward compatibility, falls back
from `fit_score` to `overall_score` when fit is unavailable. A custom policy has
no implicit fallback unless `fallbackSource` is explicitly configured.

Example:

```json
{
  "source": "composite_score",
  "bands": [
    { "min": 0, "max": 64.99, "code": "not_recommended", "label": "Не рекомендуется" },
    { "min": 65, "max": 79.99, "code": "consider", "label": "Рассмотреть" },
    { "min": 80, "max": 89.99, "code": "invite", "label": "Пригласить" },
    { "min": 90, "max": 100, "code": "strong_candidate", "label": "Сильный кандидат" }
  ]
}
```

## Attention signal classification

FP/FN are produced only for V2 attention criterion items with explicit trusted
configuration:

```json
{
  "signal_classification": {
    "target_present": true
  }
}
```

The import parser converts this to
`scoring_config_json.signalClassification.targetPresent`. It is allowed only
for choice questions in the `attention` domain. The scorer uses the structured
flag and the scored correctness outcome; it never parses option text.

- target present + correct response: TP;
- target present + wrong or omitted response: FN;
- target absent + wrong response: FP;
- target absent + correct response: TN.

`hit_rate` and `false_alarm_rate` are ratios in `0..1`; either is `null` when
its denominator is zero. If a test has no classified items, all classification
counts and rates are `null`. Existing accuracy, error, omission and observed
time metrics are unchanged.

## Session recalculation

Server-only callers use:

```ts
await recalculateSessionScore({
  sessionId,
  reason: "scoring_upgrade",
  actorId,
});
```

Allowed reasons are `manual`, `scoring_upgrade`, `definition_change` and
`admin_repair`. The legacy string signature remains available and means a
manual internal recalculation.

Only completed candidate or employee sessions are accepted. Recalculation
loads the persisted raw answers and delegates to the same
`scoreCompletedApplication` or `scoreCompletedEmployeeAssessmentParticipant`
pipeline used by normal completion. This recalculates item/test results,
competencies, fit, assessment composite, risks, reports and recommendation.

Raw response fields (`selected_option_id`, `answer_json`, `answer_text`, timing
and structured response payloads) are never updated. Existing derived manual
values on open-text answers are preserved. V2 result rows store both the engine
and schema versions.

The previous session result and parent aggregate are loaded before calculation.
On success the RPC stores the previous and new snapshots, engine/schema
versions, `previous_revision` and `new_revision` atomically with scoring. A
scorer failure is recorded as `failed`; because all scorers run before the first
derived write, the active result remains untouched. The history table is
tenant-scoped, RLS-readable by company members and writable only by the
server-side service.
