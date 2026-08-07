import Link from "next/link";
import { notFound } from "next/navigation";

import { CandidateImportWizard } from "@/components/candidates/candidate-import-wizard";
import { buttonVariants } from "@/components/ui/button";
import { requireCompanyContext } from "@/lib/auth/context";
import { canManageCandidates } from "@/lib/candidates/constants";
import { JOB_STATUS_LABELS } from "@/lib/jobs/constants";
import { getJobPageData } from "@/lib/jobs/data";

type JobCandidateImportParams = Promise<{ id: string }>;

export default async function JobCandidateImportPage({
  params,
}: {
  params: JobCandidateImportParams;
}) {
  const context = await requireCompanyContext();
  const { id } = await params;
  const data = await getJobPageData(context.activeCompany.id, id);

  if (!data) {
    notFound();
  }

  const mayManage = canManageCandidates(context.activeCompany.role);
  const mayImport =
    mayManage &&
    Boolean(data.job.assessmentPackageId) &&
    data.job.status !== "closed" &&
    data.job.status !== "archived";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Импорт кандидатов</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.job.title} / {JOB_STATUS_LABELS[data.job.status]}
          </p>
        </div>
        <Link
          className={buttonVariants({ variant: "outline" })}
          href={`/dashboard/jobs/${data.job.id}/candidates`}
        >
          К кандидатам
        </Link>
      </div>

      {mayImport ? <CandidateImportWizard jobId={data.job.id} /> : null}
      {!mayManage ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          У вашей роли нет права импортировать кандидатов.
        </p>
      ) : null}
      {mayManage && !data.job.assessmentPackageId ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Чтобы импортировать кандидатов, сначала назначьте вакансии пакет оценки.
        </p>
      ) : null}
      {mayManage && (data.job.status === "closed" || data.job.status === "archived") ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          В закрытую или архивную вакансию импорт недоступен.
        </p>
      ) : null}
    </div>
  );
}
