import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import {
  getSystemTestGroup,
  SYSTEM_TEST_GROUPS,
  TEST_TEMPLATE_STATUS_LABELS,
  TEST_VERSION_STATUS_LABELS,
  type SystemTestGroup,
} from "@/lib/tests/constants";
import type { TestTemplate } from "@/lib/tests/data";
import { getLatestPublishedVersion } from "@/lib/tests/version-selection";

type SystemTestGroupsProps = {
  emptyText: string;
  hrefBase: "/admin/tests" | "/dashboard/tests";
  statusMode: "system-badge" | "template-status";
  templates: TestTemplate[];
};

function groupTemplates(templates: TestTemplate[]) {
  const groups = new Map<SystemTestGroup, TestTemplate[]>(
    SYSTEM_TEST_GROUPS.map((group) => [group.key, []]),
  );

  for (const template of templates) {
    groups.get(getSystemTestGroup(template.category))?.push(template);
  }

  return SYSTEM_TEST_GROUPS.map((group) => ({
    ...group,
    templates: groups.get(group.key) ?? [],
  }));
}

function SystemTestsTable({
  hrefBase,
  statusMode,
  templates,
}: Pick<SystemTestGroupsProps, "hrefBase" | "statusMode" | "templates">) {
  return (
    <div className="overflow-x-auto border-t">
      <table className="w-full min-w-[680px] text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Тест</th>
            <th className="px-4 py-3 font-medium">Статус</th>
            <th className="px-4 py-3 font-medium">Последняя версия</th>
            <th className="px-4 py-3 text-right font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => {
            const latestPublishedVersion = getLatestPublishedVersion(template.versions);

            return (
              <tr className="border-t first:border-t-0" key={template.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{template.title}</p>
                  <p className="text-muted-foreground">
                    {template.category ?? "Без категории"}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                    {statusMode === "system-badge"
                      ? "Системный"
                      : TEST_TEMPLATE_STATUS_LABELS[template.status]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {latestPublishedVersion ? (
                    <>
                      v{latestPublishedVersion.versionNumber} ·{" "}
                      {TEST_VERSION_STATUS_LABELS[latestPublishedVersion.status]}
                    </>
                  ) : (
                    "Опубликованных версий нет"
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                    href={`${hrefBase}/${template.id}`}
                  >
                    Открыть
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SystemTestGroups({
  emptyText,
  hrefBase,
  statusMode,
  templates,
}: SystemTestGroupsProps) {
  if (templates.length === 0) {
    return <EmptyState description={emptyText} title="Системных тестов пока нет" />;
  }

  return (
    <div className="space-y-3">
      {groupTemplates(templates).map((group) => (
        <details className="group overflow-hidden rounded-lg border" key={group.key} open>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 bg-muted/30 px-4 py-3 [&::-webkit-details-marker]:hidden">
            <div className="min-w-0">
              <p className="font-medium">{group.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{group.description}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="rounded-full bg-background px-2.5 py-1 text-xs font-medium">
                {group.templates.length}
              </span>
              <ChevronDown
                aria-hidden="true"
                className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
              />
            </div>
          </summary>
          {group.templates.length > 0 ? (
            <SystemTestsTable
              hrefBase={hrefBase}
              statusMode={statusMode}
              templates={group.templates}
            />
          ) : (
            <div className="border-t px-4 py-6 text-sm text-muted-foreground">
              {group.emptyText}
            </div>
          )}
        </details>
      ))}
    </div>
  );
}
