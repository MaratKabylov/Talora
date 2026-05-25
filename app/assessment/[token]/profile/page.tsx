import { redirect } from "next/navigation";

import { AssessmentShell, AssessmentUnavailable } from "@/components/assessment/assessment-shell";
import { FeedbackMessage } from "@/components/feedback-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitCandidateProfileAction } from "@/lib/assessment/actions";
import { getAssessmentByToken } from "@/lib/assessment/data";

type ProfileParams = Promise<{ token: string }>;
type ProfileSearchParams = Promise<{ error?: string }>;

export default async function CandidateProfilePage({
  params,
  searchParams,
}: {
  params: ProfileParams;
  searchParams: ProfileSearchParams;
}) {
  const { token } = await params;
  const feedback = await searchParams;
  const assessment = await getAssessmentByToken(token);

  if (assessment.availability !== "active") {
    if (assessment.availability === "completed") {
      redirect(`/assessment/${token}/complete`);
    }

    return <AssessmentUnavailable state={assessment.availability} />;
  }

  if (!assessment.consentGivenAt) {
    redirect(`/assessment/${token}`);
  }

  const activeSession = assessment.sessions.find((session) => session.status === "in_progress");
  if (activeSession) {
    redirect(`/assessment/${token}/test/${activeSession.id}`);
  }

  return (
    <AssessmentShell companyName={assessment.companyName}>
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">{assessment.job.title}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Анкета кандидата</h1>
          <p className="mt-2 text-muted-foreground">
            Проверьте контактные данные перед началом оценки.
          </p>
        </div>

        <FeedbackMessage error={feedback.error} />

        <Card>
          <CardHeader>
            <CardTitle>Контактная информация</CardTitle>
            <CardDescription>
              Эти сведения используются только для связи по данной вакансии и просмотра результата
              работодателем.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <form action={submitCandidateProfileAction} className="space-y-5">
              <input name="token" type="hidden" value={token} />
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="fullName">Имя и фамилия</Label>
                  <Input
                    defaultValue={assessment.candidate.fullName}
                    id="fullName"
                    name="fullName"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    defaultValue={assessment.candidate.email ?? ""}
                    id="email"
                    name="email"
                    required
                    type="email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Телефон</Label>
                  <Input
                    defaultValue={assessment.candidate.phone ?? ""}
                    id="phone"
                    name="phone"
                    type="tel"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">Город</Label>
                  <Input defaultValue={assessment.candidate.city ?? ""} id="city" name="city" />
                </div>
              </div>
              <Button type="submit">Начать оценку</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AssessmentShell>
  );
}
