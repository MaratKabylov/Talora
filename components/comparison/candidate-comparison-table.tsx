import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { addApplicationToShortlistAction } from "@/lib/comparison/actions";
import type { ComparisonCandidate } from "@/lib/comparison/data";
import {
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_VALUES,
  RECOMMENDATION_LABELS,
  RECOMMENDATION_VALUES,
  RISK_LEVEL_LABELS,
  RISK_LEVEL_VALUES,
} from "@/lib/candidates/constants";
import { COMPETENCIES, type CompetencyKey } from "@/lib/jobs/constants";

export type ComparisonFilters = {
  recommendation: string;
  riskLevel: string;
  sort: "fit_asc" | "fit_desc";
  status: string;
};

const DISPLAY_COMPETENCY_KEYS: CompetencyKey[] = [
  "learning_ability",
  "attention_to_detail",
  "logical_reasoning",
  "work_behavior",
  "communication",
];

const COMPETENCY_LABELS = new Map(
  COMPETENCIES.map((competency) => [competency.key, competency.label]),
);

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : "-";
}

function formatScore(value: number | null | undefined) {
  return value === null || value === undefined
    ? "-"
    : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

function hasReport(application: ComparisonCandidate) {
  return (
    application.status === "completed" ||
    application.status === "shortlisted" ||
    application.overallScore !== null ||
    application.fitScore !== null ||
    application.requiresReview
  );
}

export function ComparisonFilterForm({
  filters,
  jobId,
}: {
  filters: ComparisonFilters;
  jobId: string;
}) {
  return (
    <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <Select defaultValue={filters.sort} name="sort">
        <option value="fit_desc">Fit score: сначала высокий</option>
        <option value="fit_asc">Fit score: сначала низкий</option>
      </Select>
      <Select defaultValue={filters.status} name="status">
        <option value="">Все статусы</option>
        {APPLICATION_STATUS_VALUES.map((status) => (
          <option key={status} value={status}>
            {APPLICATION_STATUS_LABELS[status]}
          </option>
        ))}
      </Select>
      <Select defaultValue={filters.recommendation} name="recommendation">
        <option value="">Все рекомендации</option>
        {RECOMMENDATION_VALUES.map((recommendation) => (
          <option key={recommendation} value={recommendation}>
            {RECOMMENDATION_LABELS[recommendation]}
          </option>
        ))}
      </Select>
      <Select defaultValue={filters.riskLevel} name="risk">
        <option value="">Все риски</option>
        {RISK_LEVEL_VALUES.map((risk) => (
          <option key={risk} value={risk}>
            {RISK_LEVEL_LABELS[risk]}
          </option>
        ))}
      </Select>
      <div className="flex gap-2">
        <Button className="flex-1" type="submit" variant="outline">
          Применить
        </Button>
        <Link className={buttonVariants({ variant: "ghost" })} href={`/dashboard/jobs/${jobId}/compare`}>
          Сбросить
        </Link>
      </div>
    </form>
  );
}

export function CandidateComparisonTable({
  applications,
  jobId,
  mayManage,
}: {
  applications: ComparisonCandidate[];
  jobId: string;
  mayManage: boolean;
}) {
  if (applications.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Кандидаты с выбранными фильтрами не найдены.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-[1280px] w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Кандидат</th>
            <th className="px-4 py-3 font-medium">Дата прохождения</th>
            <th className="px-4 py-3 font-medium">Статус</th>
            <th className="px-4 py-3 font-medium">Overall</th>
            <th className="px-4 py-3 font-medium">Fit</th>
            {DISPLAY_COMPETENCY_KEYS.map((key) => (
              <th className="px-4 py-3 font-medium" key={key}>
                {COMPETENCY_LABELS.get(key)}
              </th>
            ))}
            <th className="px-4 py-3 font-medium">Риск</th>
            <th className="px-4 py-3 font-medium">Рекомендация</th>
            <th className="px-4 py-3 text-right font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {applications.map((application) => (
            <tr className="border-t align-top" key={application.id}>
              <td className="px-4 py-3">
                <p className="font-medium">{application.candidate.fullName}</p>
                <p className="text-muted-foreground">{application.candidate.email ?? "Email не указан"}</p>
              </td>
              <td className="px-4 py-3">{formatDate(application.completedAt)}</td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                  {APPLICATION_STATUS_LABELS[application.status]}
                </span>
              </td>
              <td className="px-4 py-3">{formatScore(application.overallScore)}</td>
              <td className="px-4 py-3 font-medium">{formatScore(application.fitScore)}</td>
              {DISPLAY_COMPETENCY_KEYS.map((key) => (
                <td className="px-4 py-3" key={key}>
                  {formatScore(application.competencies[key])}
                </td>
              ))}
              <td className="px-4 py-3">
                {application.riskLevel ? RISK_LEVEL_LABELS[application.riskLevel] : "-"}
              </td>
              <td className="px-4 py-3">
                {application.requiresReview
                  ? RECOMMENDATION_LABELS.requires_review
                  : application.recommendation && application.recommendation in RECOMMENDATION_LABELS
                    ? RECOMMENDATION_LABELS[
                        application.recommendation as keyof typeof RECOMMENDATION_LABELS
                      ]
                    : application.recommendation ?? "-"}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap justify-end gap-2">
                  {hasReport(application) ? (
                    <Link
                      className={buttonVariants({ size: "sm", variant: "outline" })}
                      href={`/dashboard/applications/${application.id}/report`}
                    >
                      Отчет
                    </Link>
                  ) : null}
                  {application.status === "shortlisted" ? (
                    <span className="rounded-md bg-muted px-3 py-2 text-xs font-medium">
                      В шорт-листе
                    </span>
                  ) : mayManage && application.status === "completed" ? (
                    <form action={addApplicationToShortlistAction}>
                      <input name="applicationId" type="hidden" value={application.id} />
                      <input name="jobId" type="hidden" value={jobId} />
                      <Button size="sm" type="submit">
                        В шорт-лист
                      </Button>
                    </form>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
