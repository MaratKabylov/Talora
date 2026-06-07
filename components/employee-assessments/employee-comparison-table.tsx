import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  RECOMMENDATION_LABELS,
  RECOMMENDATION_VALUES,
  RISK_LEVEL_LABELS,
  RISK_LEVEL_VALUES,
} from "@/lib/candidates/constants";
import {
  EMPLOYEE_PARTICIPANT_STATUS_LABELS,
  EMPLOYEE_PARTICIPANT_STATUS_VALUES,
} from "@/lib/employee-assessments/constants";
import type { EmployeeComparisonParticipant } from "@/lib/employee-assessments/data";
import { COMPETENCIES, type CompetencyKey } from "@/lib/jobs/constants";

export type EmployeeComparisonFilters = {
  department: string;
  recommendation: string;
  riskLevel: string;
  roleTitle: string;
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

function hasReport(participant: EmployeeComparisonParticipant) {
  return (
    participant.status === "completed" ||
    participant.overallScore !== null ||
    participant.fitScore !== null ||
    participant.requiresReview
  );
}

export function EmployeeComparisonFilterForm({
  assessmentId,
  departments,
  filters,
  roleTitles,
}: {
  assessmentId: string;
  departments: string[];
  filters: EmployeeComparisonFilters;
  roleTitles: string[];
}) {
  return (
    <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
      <Select defaultValue={filters.sort} name="sort">
        <option value="fit_desc">Fit score: сначала высокий</option>
        <option value="fit_asc">Fit score: сначала низкий</option>
      </Select>
      <Select defaultValue={filters.status} name="status">
        <option value="">Все статусы</option>
        {EMPLOYEE_PARTICIPANT_STATUS_VALUES.map((status) => (
          <option key={status} value={status}>
            {EMPLOYEE_PARTICIPANT_STATUS_LABELS[status]}
          </option>
        ))}
      </Select>
      <Select defaultValue={filters.department} name="department">
        <option value="">Все отделы</option>
        {departments.map((department) => (
          <option key={department} value={department}>
            {department}
          </option>
        ))}
      </Select>
      <Select defaultValue={filters.roleTitle} name="role">
        <option value="">Все должности</option>
        {roleTitles.map((roleTitle) => (
          <option key={roleTitle} value={roleTitle}>
            {roleTitle}
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
        <Link
          className={buttonVariants({ variant: "ghost" })}
          href={`/dashboard/employee-assessments/${assessmentId}/compare`}
        >
          Сбросить
        </Link>
      </div>
    </form>
  );
}

export function EmployeeComparisonTable({
  participants,
}: {
  participants: EmployeeComparisonParticipant[];
}) {
  if (participants.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
        Сотрудники с выбранными фильтрами не найдены.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-[1320px] w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Сотрудник</th>
            <th className="px-4 py-3 font-medium">Отдел</th>
            <th className="px-4 py-3 font-medium">Должность</th>
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
          {participants.map((participant) => (
            <tr className="border-t align-top" key={participant.id}>
              <td className="px-4 py-3">
                <p className="font-medium">{participant.employee.fullName}</p>
                <p className="text-muted-foreground">{participant.employee.email}</p>
              </td>
              <td className="px-4 py-3">{participant.employee.department ?? "-"}</td>
              <td className="px-4 py-3">{participant.employee.roleTitle ?? "-"}</td>
              <td className="px-4 py-3">{formatDate(participant.completedAt)}</td>
              <td className="px-4 py-3">
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
                  {EMPLOYEE_PARTICIPANT_STATUS_LABELS[participant.status]}
                </span>
              </td>
              <td className="px-4 py-3">{formatScore(participant.overallScore)}</td>
              <td className="px-4 py-3 font-medium">{formatScore(participant.fitScore)}</td>
              {DISPLAY_COMPETENCY_KEYS.map((key) => (
                <td className="px-4 py-3" key={key}>
                  {formatScore(participant.competencies[key])}
                </td>
              ))}
              <td className="px-4 py-3">
                {participant.riskLevel ? RISK_LEVEL_LABELS[participant.riskLevel] : "-"}
              </td>
              <td className="px-4 py-3">
                {participant.requiresReview
                  ? RECOMMENDATION_LABELS.requires_review
                  : participant.recommendation && participant.recommendation in RECOMMENDATION_LABELS
                    ? RECOMMENDATION_LABELS[
                        participant.recommendation as keyof typeof RECOMMENDATION_LABELS
                      ]
                    : participant.recommendation ?? "-"}
              </td>
              <td className="px-4 py-3 text-right">
                {hasReport(participant) ? (
                  <Link
                    className={buttonVariants({ size: "sm", variant: "outline" })}
                    href={`/dashboard/employee-assessments/participants/${participant.id}/report`}
                  >
                    Отчет
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
