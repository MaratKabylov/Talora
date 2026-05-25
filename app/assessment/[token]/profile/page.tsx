import { redirect } from "next/navigation";

import { AssessmentShell, AssessmentUnavailable } from "@/components/assessment/assessment-shell";
import { FeedbackMessage } from "@/components/feedback-message";
import { PendingSubmitButton } from "@/components/pending-submit-button";
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
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Анкета кандидата</h1>
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
                    className="h-11"
                    defaultValue={assessment.candidate.fullName}
                    id="fullName"
                    name="fullName"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    className="h-11"
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
                    className="h-11"
                    defaultValue={assessment.candidate.phone ?? ""}
                    id="phone"
                    name="phone"
                    type="tel"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">Город</Label>
                  <Input className="h-11" defaultValue={assessment.candidate.city ?? ""} id="city" name="city" />
                </div>
              </div>
              <PendingSubmitButton className="w-full sm:w-auto" pendingText="Готовим тесты..." type="submit">
                Начать оценку
              </PendingSubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>
    </AssessmentShell>
  );
}
