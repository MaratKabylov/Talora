import { redirect } from "next/navigation";

import { AssessmentShell, AssessmentUnavailable } from "@/components/assessment/assessment-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAssessmentByToken } from "@/lib/assessment/data";

type CompleteParams = Promise<{ token: string }>;

export default async function CandidateCompletePage({ params }: { params: CompleteParams }) {
  const { token } = await params;
  const assessment = await getAssessmentByToken(token);

  if (
    assessment.availability === "invalid" ||
    assessment.availability === "expired" ||
    assessment.availability === "cancelled"
  ) {
    return <AssessmentUnavailable state={assessment.availability} />;
  }

  if (assessment.availability !== "completed") {
    redirect(`/assessment/${token}`);
  }

  return (
    <AssessmentShell companyName={assessment.companyName}>
      <Card>
        <CardHeader>
          <p className="text-sm text-muted-foreground">{assessment.job.title}</p>
          <CardTitle className="text-xl sm:text-2xl">Оценка завершена</CardTitle>
          <CardDescription>
            Спасибо, {assessment.candidate.fullName || "кандидат"}. Ваши ответы сохранены и будут
            рассмотрены {assessment.companyName}.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <p className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
            Результаты используются как часть предварительной оценки. Работодатель свяжется с вами
            по дальнейшим шагам.
          </p>
        </CardContent>
      </Card>
    </AssessmentShell>
  );
}
