import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createDeterministicShuffledIds,
  scoreMatchingAnswer,
  scoreOrderingAnswer,
  validateMatchingAnswer,
  validateOrderingAnswer,
} from "../lib/structured-questions.ts";
import { getAllowedImportScoringTypes } from "../lib/tests/import-scoring.ts";

const orderingIds = ["a", "b", "c", "d"];

test("ordering: a complete permutation is accepted", () => {
  assert.deepEqual(validateOrderingAnswer({ orderedOptionIds: ["b", "a", "d", "c"] }, orderingIds), {
    answer: { orderedOptionIds: ["b", "a", "d", "c"] },
    ok: true,
  });
});

test("ordering: duplicate, missing, and foreign options are rejected", () => {
  assert.equal(validateOrderingAnswer({ orderedOptionIds: ["a", "a", "c", "d"] }, orderingIds).ok, false);
  assert.equal(validateOrderingAnswer({ orderedOptionIds: ["a", "b", "c"] }, orderingIds).ok, false);
  assert.equal(validateOrderingAnswer({ orderedOptionIds: ["a", "b", "c", "x"] }, orderingIds).ok, false);
});

test("ordering: pairwise scoring gives proportional credit for an adjacent swap", () => {
  const score = scoreOrderingAnswer(orderingIds, { orderedOptionIds: ["a", "c", "b", "d"] }, "pairwise");
  assert.equal(score, 5 / 6);
  assert.equal(scoreOrderingAnswer(orderingIds, { orderedOptionIds: ["a", "c", "b", "d"] }, "exact"), 0);
  assert.equal(scoreOrderingAnswer(orderingIds, { orderedOptionIds: orderingIds }, "exact"), 1);
});

const matchingOptions = [
  { id: "left-a", matchTargetId: "right-a" },
  { id: "left-b", matchTargetId: "right-b" },
  { id: "left-c", matchTargetId: "right-c" },
];

test("matching: a complete one-to-one answer is accepted", () => {
  const matches = [
    { optionId: "left-a", targetId: "right-b" },
    { optionId: "left-b", targetId: "right-a" },
    { optionId: "left-c", targetId: "right-c" },
  ];
  assert.deepEqual(validateMatchingAnswer({ matches }, matchingOptions), {
    answer: { matches },
    ok: true,
  });
});

test("matching: reused and foreign targets are rejected", () => {
  assert.equal(
    validateMatchingAnswer(
      {
        matches: [
          { optionId: "left-a", targetId: "right-a" },
          { optionId: "left-b", targetId: "right-a" },
          { optionId: "left-c", targetId: "right-c" },
        ],
      },
      matchingOptions,
    ).ok,
    false,
  );
  assert.equal(
    validateMatchingAnswer(
      {
        matches: [
          { optionId: "left-a", targetId: "right-a" },
          { optionId: "left-b", targetId: "right-b" },
          { optionId: "left-c", targetId: "foreign" },
        ],
      },
      matchingOptions,
    ).ok,
    false,
  );
});

test("matching: partial and exact modes score independently", () => {
  const answer = {
    matches: [
      { optionId: "left-a", targetId: "right-a" },
      { optionId: "left-b", targetId: "right-c" },
      { optionId: "left-c", targetId: "right-b" },
    ],
  };
  assert.equal(scoreMatchingAnswer(matchingOptions, answer, "per_pair"), 1 / 3);
  assert.equal(scoreMatchingAnswer(matchingOptions, answer, "exact"), 0);
});

test("shuffle: the same seed is stable and a canonical order is never returned unchanged", () => {
  const first = createDeterministicShuffledIds(orderingIds, "session:question");
  const second = createDeterministicShuffledIds(orderingIds, "session:question");
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, orderingIds);
  assert.deepEqual([...first].sort(), [...orderingIds].sort());
});

test("import: ordering and matching are point-scored question types", () => {
  assert.deepEqual(getAllowedImportScoringTypes(["ordering", "matching"]), [
    "points",
    "competency_profile",
  ]);
  assert.deepEqual(getAllowedImportScoringTypes(["forced_choice", "matching"]), ["mixed"]);
  assert.deepEqual(getAllowedImportScoringTypes(["open_text", "ordering"]), ["mixed"]);
});

test("import: public JSON Schema exposes ordering and matching definitions", () => {
  const schema = JSON.parse(
    readFileSync(
      new URL("../docs/08_TALVIA_TEST_IMPORT_SCHEMA_V1.json", import.meta.url),
      "utf8",
    ),
  ) as { $defs: Record<string, unknown> };

  assert.ok(schema.$defs.orderingQuestion);
  assert.ok(schema.$defs.matchingQuestion);
  assert.ok(schema.$defs.orderingItem);
  assert.ok(schema.$defs.matchingPair);
});
