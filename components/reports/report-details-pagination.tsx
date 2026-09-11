import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import {
  reportDetailsPageHref,
  type ReportDetailsPageParams,
  type ReportDetailsPageState,
} from "@/lib/reports/details-pagination";

export function ReportDetailsPagination({
  pageParam,
  pagination,
  params,
  path,
}: {
  pageParam: "answersPage" | "eventsPage";
  pagination: ReportDetailsPageState;
  params: ReportDetailsPageParams;
  path: string;
}) {
  const href = (page: number) => reportDetailsPageHref(path, params, pageParam, page);

  if (pagination.page === 1 && !pagination.hasNextPage) return null;

  return (
    <nav aria-label="Страницы подробностей отчёта" className="mt-4 flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted-foreground">
        Страница {pagination.page} · до {pagination.pageSize} записей
      </span>
      {pagination.page > 1 ? (
        <Link
          className={buttonVariants({ size: "sm", variant: "outline" })}
          href={href(pagination.page - 1)}
        >
          Предыдущая страница
        </Link>
      ) : null}
      {pagination.hasNextPage ? (
        <Link
          className={buttonVariants({ size: "sm", variant: "outline" })}
          href={href(pagination.page + 1)}
        >
          Следующая страница
        </Link>
      ) : null}
    </nav>
  );
}
