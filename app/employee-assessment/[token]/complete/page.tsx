import { redirect } from "next/navigation";

import { AssessmentShell, AssessmentUnavailable } from "@/components/assessment/assessment-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getEmployeeAssessmentByToken } from "@/lib/employee-assessments/public-data";

type CompleteParams = Promise<{ token: string }>;

export default async function EmployeeAssessmentCompletePage({ params }: { params: CompleteParams }) {
  const { token } = await params;
  const assessment = await getEmployeeAssessmentByToken(token);

  if (
    assessment.availability === "invalid" ||
    assessment.availability === "expired" ||
    assessment.availability === "cancelled"
  ) {
    return <AssessmentUnavailable state={assessment.availability} />;
  }

  if (assessment.availability !== "completed") {
    redirect(`/employee-assessment/${token}`);
  }

  return (
    <AssessmentShell companyName={assessment.companyName}>
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">{assessment.assessment.title}</p>
          <CardTitle className="text-xl sm:text-2xl">Оценка завершена</CardTitle>
          <CardDescription>
            Спасибо, {assessment.employee.fullName}. Ваши ответы сохранены и будут рассмотрены {assessment.companyName}.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <p className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
            Результаты используются как часть внутренней оценки компетенций и не являются автоматическим кадровым решением.
          </p>
        </CardContent>
      </Card>
    </AssessmentShell>
  );
}
