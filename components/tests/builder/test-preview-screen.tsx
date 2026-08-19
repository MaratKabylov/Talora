import Link from "next/link";

import { PagedTestPreview } from "@/components/tests/builder/paged-test-preview";
import { buttonVariants } from "@/components/ui/button";
import type { BuilderSection } from "@/lib/tests/builder-data";
import type { TestVersion } from "@/lib/tests/data";

export function TestPreviewScreen({
  backHref,
  sections,
  templateTitle,
  version,
}: {
  backHref: string;
  sections: BuilderSection[];
  templateTitle: string;
  version: TestVersion;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{templateTitle}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Предпросмотр для кандидата</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Кнопки ответов отключены. Вопросы и навигация показаны в режиме, выбранном в конструкторе.
          </p>
        </div>
        <Link className={buttonVariants({ variant: "outline" })} href={backHref}>
          Вернуться в конструктор
        </Link>
      </div>
      <PagedTestPreview sections={sections} version={version} />
    </div>
  );
}
