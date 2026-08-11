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
  const [sectionIndex, setSectionIndex] = useState(0);

  return (
    <TestPreview
      currentSectionIndex={sectionIndex}
      onSectionChange={setSectionIndex}
      sections={sections}
      version={version}
    />
  );
}
