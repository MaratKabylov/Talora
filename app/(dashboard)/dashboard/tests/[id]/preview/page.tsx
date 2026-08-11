import { notFound } from "next/navigation";

import { TestPreviewScreen } from "@/components/tests/builder/test-preview-screen";
import { requireCompanyContext } from "@/lib/auth/context";
import { getTestBuilderData } from "@/lib/tests/builder-data";

type PreviewParams = Promise<{ id: string }>;
type PreviewSearchParams = Promise<{ version?: string }>;

export default async function TestPreviewPage({
  params,
  searchParams,
}: {
  params: PreviewParams;
  searchParams: PreviewSearchParams;
}) {
  const context = await requireCompanyContext();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const data = await getTestBuilderData(context.activeCompany.id, id, query.version);

  if (!data) notFound();

  return (
    <TestPreviewScreen
      backHref={`/dashboard/tests/${data.template.id}/builder?version=${data.version.id}`}
      sections={data.sections}
      templateTitle={data.template.title}
      version={data.version}
    />
  );
}
