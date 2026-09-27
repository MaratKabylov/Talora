import assert from "node:assert/strict";
import test from "node:test";

import { assignCompetitionRanks } from "../lib/reports/profile-ranking.ts";

test("profile ranking gives equal values equal competition ranks", () => {
  const values = [72.2, 72.2, 61.1, 61.1, 50];

  assert.deepEqual(
    assignCompetitionRanks(values, (value) => value).map((entry) => entry.rank),
    [1, 1, 3, 3, 5],
  );
});

test("profile ranking leaves unavailable values unranked", () => {
  const values = [72.2, 61.1, null];

  assert.deepEqual(
    assignCompetitionRanks(values, (value) => value).map((entry) => entry.rank),
    [1, 2, null],
  );
});
