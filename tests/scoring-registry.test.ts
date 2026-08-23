import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { domainScoringRegistry } from "../lib/scoring/domain-registry.ts";
import { scoringModelRegistry } from "../lib/scoring/model-registry.ts";
import { SCORING_MODELS } from "../lib/scoring/types.ts";

test("primary scoring models are registered exactly once", () => {
  const registered = scoringModelRegistry.map((adapter) => adapter.model);
  const primaryModels = SCORING_MODELS.filter((model) => model !== "composite");

  assert.equal(new Set(registered).size, registered.length);
  assert.deepEqual([...registered].sort(), [...primaryModels].sort());
});

test("domain-specific scoring is registered outside the session orchestrator", () => {
  assert.deepEqual(
    [...domainScoringRegistry.keys()].sort(),
    ["attention", "learning"],
  );
});

test("scoreSession depends on registries instead of concrete v2 scorers", () => {
  const source = readFileSync(
    new URL("../lib/scoring/session.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /score(?:Attention|Learning|Scales|Sjt)|getForcedChoiceScorer/,
  );
  assert.match(source, /scoreRegisteredModels/);
  assert.match(source, /scoreRegisteredDomain/);
});
