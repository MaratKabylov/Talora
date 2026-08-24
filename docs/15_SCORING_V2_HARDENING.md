# Scoring Framework V2: recommendation, attention and recalculation

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

Before scoring starts, `scoring_recalculation_history` stores the previous
session result and parent aggregate snapshot together with reason and actor.
After success it stores the new snapshots and versions. A scorer failure is
recorded as `failed`; because all scorers run before the first derived write,
the active result remains untouched on a scoring exception. The history table
is tenant-scoped, RLS-readable by company members and writable only by the
server-side service.

