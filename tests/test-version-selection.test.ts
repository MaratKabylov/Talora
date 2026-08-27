import assert from "node:assert/strict";
import test from "node:test";

import { getLatestPublishedVersion } from "../lib/tests/version-selection.ts";

test("selects the highest published version and ignores newer drafts and archives", () => {
  const versions = [
    { id: "draft-v6", status: "draft", versionNumber: 6 },
    { id: "published-v5", status: "published", versionNumber: 5 },
    { id: "archived-v7", status: "archived", versionNumber: 7 },
    { id: "published-v3", status: "published", versionNumber: 3 },
  ];

  assert.equal(getLatestPublishedVersion(versions)?.id, "published-v5");
});

test("returns null when a test has no published versions", () => {
  const versions = [
    { status: "draft", versionNumber: 2 },
    { status: "archived", versionNumber: 1 },
  ];

  assert.equal(getLatestPublishedVersion(versions), null);
});
