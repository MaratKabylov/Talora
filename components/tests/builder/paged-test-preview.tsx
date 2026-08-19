"use client";

import { useState } from "react";

import { TestPreview } from "@/components/tests/builder/test-preview";
import type { BuilderSection } from "@/lib/tests/builder-data";
import type { TestVersion } from "@/lib/tests/data";

export function PagedTestPreview({
  sections,
  version,
}: {
  sections: BuilderSection[];
  version: TestVersion;
}) {
  const [pageIndex, setPageIndex] = useState(0);

  return (
    <TestPreview
      currentPageIndex={pageIndex}
      onPageChange={setPageIndex}
      sections={sections}
      version={version}
    />
  );
}
