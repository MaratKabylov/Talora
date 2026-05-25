import Link from "next/link";

import { CandidateApplicationsTable } from "@/components/candidates/candidate-applications-table";
import { FeedbackMessage } from "@/components/feedback-message";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCompanyContext } from "@/lib/auth/context";
import { canManageCandidates } from "@/lib/candidates/constants";
import { listCandidateApplications } from "@/lib/candidates/data";

type CandidatesSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

export default async function CandidatesPage({
  searchParams,
}: {
  searchParams: CandidatesSearchParams;
}) {
  const context = await requireCompanyContext();
  const params = await searchParams;
  const applications = await listCandidateApplications(context.activeCompany.id);
  const mayManage = canManageCandidates(context.activeCompany.role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{context.activeCompany.name}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Кандидаты</h1>
        </div>
        {mayManage ? (
          <Link className={buttonVariants({ variant: "outline" })} href="/dashboard/jobs">
            Добавить через вакансию
          </Link>
        ) : null}
      </div>

      <FeedbackMessage error={params.error} message={params.message} />

      <Card>
        <CardHeader>
          <CardTitle>Кандидаты по вакансиям</CardTitle>
          <CardDescription>
            Статус оценки и приглашения отслеживаются отдельно для каждой вакансии.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <CandidateApplicationsTable
            applications={applications}
            mayManage={mayManage}
            returnTo="/dashboard/candidates"
            showJob
          />
        </CardContent>
      </Card>
    </div>
  );
}
