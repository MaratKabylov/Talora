import assert from "node:assert/strict";
import test from "node:test";

import {
  createOptionShuffleSeed,
  getDisplayOptions,
  hasUniqueOptionIds,
  hashOptionShuffleSeed,
} from "../lib/answers/option-shuffle.ts";

const options = [
  { id: "o1", orderIndex: 1 },
  { id: "o2", orderIndex: 2 },
  { id: "o3", orderIndex: 3 },
  { id: "o4", orderIndex: 4 },
  { id: "o5", orderIndex: 5 },
];

test("shuffle=false keeps canonical order and returns a new array", () => {
  const displayed = getDisplayOptions({
    attemptId: "a1",
    options,
    questionId: "q1",
    shuffle: false,
  });

  assert.deepEqual(displayed, options);
  assert.notEqual(displayed, options);
});

test("seeded Fisher-Yates is stable within an attempt and never mutates options", () => {
  const before = structuredClone(options);
  const results = Array.from({ length: 10 }, () =>
    getDisplayOptions({
      attemptId: "a1",
      options,
      questionId: "q1",
      shuffle: true,
    }),
  );

  for (const result of results) {
    assert.deepEqual(result, results[0]);
    assert.deepEqual(
      result.map((option) => option.id).sort(),
      options.map((option) => option.id).sort(),
    );
  }
  assert.deepEqual(options, before);
  assert.notDeepEqual(results[0], options);
});

test("attempt and question IDs are namespaced into distinct seeds", () => {
  const first = createOptionShuffleSeed("a1", "q1");
  const otherAttempt = createOptionShuffleSeed("a2", "q1");
  const otherQuestion = createOptionShuffleSeed("a1", "q2");

  assert.notEqual(first, otherAttempt);
  assert.notEqual(first, otherQuestion);
  assert.notEqual(hashOptionShuffleSeed(first), hashOptionShuffleSeed(otherAttempt));
  assert.notEqual(hashOptionShuffleSeed(first), hashOptionShuffleSeed(otherQuestion));
});

test("different attempts can produce different display positions", () => {
  const permutations = new Set(
    Array.from({ length: 12 }, (_, index) =>
      getDisplayOptions({
        attemptId: `attempt-${index}`,
        options,
        questionId: "q1",
        shuffle: true,
      })
        .map((option) => option.id)
        .join(","),
    ),
  );

  assert.ok(permutations.size > 1);
});

test("duplicate option IDs are rejected by the shared domain guard", () => {
  assert.equal(hasUniqueOptionIds(options), true);
  assert.equal(
    hasUniqueOptionIds([{ id: "o1" }, { id: "o1" }]),
    false,
  );
});
