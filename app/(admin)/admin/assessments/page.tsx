import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listAssessmentMonitoring } from "@/lib/admin/data";
import { canViewCandidatePii } from "@/lib/admin/constants";
import { requirePlatformContext } from "@/lib/admin/context";

type Named = { full_name?: string | null; name?: string; title?: string };
type Session = { id: string; status: string };

function one<T>(value: T | T[] | null) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function anomaly(application: {
  candidate_reports: Array<{ id: string }> | null;
  completed_at: string | null;
  requires_review: boolean;
  status: string;
  test_sessions: Session[] | null;
}) {
  const sessions = application.test_sessions ?? [];
  if ((application.status === "completed" || application.status === "shortlisted") && !(application.candidate_reports ?? []).length) {
    return "Нет сформированного отчета";
  }
  if (
    application.status === "in_progress" &&
    sessions.length > 0 &&
    sessions.every((session) => session.status === "completed")
  ) {
    return "Сессии завершены, application еще в работе";
  }
  if (application.requires_review) {
    return "Требуется ручная проверка";
  }
  return null;
}

export default async function AdminAssessmentsPage() {
  const [applications, context] = await Promise.all([listAssessmentMonitoring(), requirePlatformContext()]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Operations</p>
        <h1 className="text-3xl font-semibold tracking-tight">Мониторинг прохождений</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Последние applications</CardTitle>
          <CardDescription>Проблемные состояния выделены для проверки командой.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Компания / вакансия</th>
                  <th className="px-4 py-3 font-medium">Кандидат</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">Сессии</th>
                  <th className="px-4 py-3 font-medium">Проверка</th>
                  <th className="px-4 py-3 text-right font-medium">Действие</th>
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => {
                  const company = one(application.companies as Named | Named[] | null);
                  const job = one(application.jobs as Named | Named[] | null);
                  const candidate = one(application.candidates as Named | Named[] | null);
                  const issue = anomaly(application as Parameters<typeof anomaly>[0]);
                  const sessions = (application.test_sessions ?? []) as Session[];
                  return (
                    <tr className="border-t align-top" key={application.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{company?.name ?? "-"}</p>
                        <p className="text-muted-foreground">{job?.title ?? "-"}</p>
                      </td>
                      <td className="px-4 py-3">
                        {canViewCandidatePii(context.role) ? candidate?.full_name ?? "Кандидат" : "PII скрыты"}
                      </td>
                      <td className="px-4 py-3">{application.status}</td>
                      <td className="px-4 py-3">
                        {sessions.map((session) => session.status).join(", ") || "Не созданы"}
                      </td>
                      <td className="px-4 py-3">
                        {issue ? <span className="text-primary">{issue}</span> : "Без аномалий"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          className={buttonVariants({ size: "sm", variant: "outline" })}
                          href={`/admin/applications/${application.id}`}
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
        </CardContent>
      </Card>
    </div>
  );
}
