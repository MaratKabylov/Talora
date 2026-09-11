export const REPORT_ANSWERS_PAGE_SIZE = 50;
export const REPORT_INTEGRITY_EVENTS_PAGE_SIZE = 100;

export type ReportDetailsPageParams = {
  answersPage?: number | string | string[];
  eventsPage?: number | string | string[];
};

export type ReportDetailsPageState = {
  hasNextPage: boolean;
  page: number;
  pageSize: number;
};

function normalizePage(value: number | string | string[] | undefined) {
  const scalar = Array.isArray(value) ? value[0] : value;
  const page = typeof scalar === "number" ? scalar : Number(scalar);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10_000) : 1;
}

export function normalizeReportDetailsPageParams(params: ReportDetailsPageParams = {}) {
  return {
    answersPage: normalizePage(params.answersPage),
    eventsPage: normalizePage(params.eventsPage),
  };
}

export function reportDetailsRange(page: number, pageSize: number) {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize };
}

export function finishReportDetailsPage<T>(rows: T[], page: number, pageSize: number) {
  return {
    items: rows.slice(0, pageSize),
    pagination: {
      hasNextPage: rows.length > pageSize,
      page,
      pageSize,
    } satisfies ReportDetailsPageState,
  };
}

export function reportDetailsPageHref(
  path: string,
  params: ReportDetailsPageParams,
  pageParam: "answersPage" | "eventsPage",
  page: number,
) {
  const pages = normalizeReportDetailsPageParams(params);
  const query = new URLSearchParams();
  const nextPages = { ...pages, [pageParam]: page };
  if (nextPages.answersPage > 1) query.set("answersPage", String(nextPages.answersPage));
  if (nextPages.eventsPage > 1) query.set("eventsPage", String(nextPages.eventsPage));
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}
