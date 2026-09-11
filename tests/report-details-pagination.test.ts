import assert from "node:assert/strict";
import test from "node:test";

import {
  finishReportDetailsPage,
  normalizeReportDetailsPageParams,
  reportDetailsPageHref,
  reportDetailsRange,
} from "../lib/reports/details-pagination.ts";

test("normalizes independent report detail page parameters", () => {
  assert.deepEqual(normalizeReportDetailsPageParams(), { answersPage: 1, eventsPage: 1 });
  assert.deepEqual(
    normalizeReportDetailsPageParams({ answersPage: "3", eventsPage: ["2", "9"] }),
    { answersPage: 3, eventsPage: 2 },
  );
  assert.deepEqual(
    normalizeReportDetailsPageParams({ answersPage: "invalid", eventsPage: "-1" }),
    { answersPage: 1, eventsPage: 1 },
  );
});

test("uses an inclusive extra-row range to detect the next details page", () => {
  assert.deepEqual(reportDetailsRange(2, 50), { from: 50, to: 100 });

  const page = finishReportDetailsPage(Array.from({ length: 51 }, (_, index) => index), 2, 50);
  assert.equal(page.items.length, 50);
  assert.deepEqual(page.pagination, { hasNextPage: true, page: 2, pageSize: 50 });
});

test("details pagination links preserve the other independent page", () => {
  const path = "/dashboard/applications/example/report";
  const params = { answersPage: "2", eventsPage: "4" };

  assert.equal(
    reportDetailsPageHref(path, params, "answersPage", 1),
    `${path}?eventsPage=4`,
  );
  assert.equal(
    reportDetailsPageHref(path, params, "answersPage", 3),
    `${path}?answersPage=3&eventsPage=4`,
  );
});
