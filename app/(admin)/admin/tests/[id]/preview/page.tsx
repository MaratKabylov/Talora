import { notFound } from "next/navigation";

import { TestPreviewScreen } from "@/components/tests/builder/test-preview-screen";
import { requirePlatformContext } from "@/lib/admin/context";
import { getAdminSystemTestBuilderData } from "@/lib/admin/tests-data";

type PreviewParams = Promise<{ id: string }>;
type PreviewSearchParams = Promise<{ version?: string }>;

export default async function AdminTestPreviewPage({
  params,
  searchParams,
}: {
  params: PreviewParams;
  searchParams: PreviewSearchParams;
}) {
  await requirePlatformContext();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const data = await getAdminSystemTestBuilderData(id, query.version);

  if (!data) notFound();

  return (
    <TestPreviewScreen
      backHref={`/admin/tests/${data.template.id}/builder?version=${data.version.id}`}
      sections={data.sections}
      templateTitle={data.template.title}
      version={data.version}
    />
  );
}
