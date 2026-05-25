import { redirect } from "next/navigation";

import { FeedbackMessage } from "@/components/feedback-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireAuthContext } from "@/lib/auth/context";
import { createFirstCompanyAction } from "@/lib/company/actions";

type OnboardingSearchParams = Promise<{
  error?: string;
}>;

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: OnboardingSearchParams;
}) {
  const context = await requireAuthContext();
  const params = await searchParams;

  if (context.companies.length > 0) {
    redirect("/dashboard");
  }

  return (
    <Card className="w-full max-w-xl">
      <CardHeader>
        <CardTitle className="text-2xl">Создайте компанию</CardTitle>
        <CardDescription>
          Это первое рабочее пространство. Вы станете владельцем компании.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <FeedbackMessage error={params.error} />
        <form action={createFirstCompanyAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Ваше имя</Label>
            <Input
              defaultValue={context.profile?.fullName ?? ""}
              id="fullName"
              name="fullName"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="companyName">Название компании</Label>
            <Input id="companyName" name="companyName" required />
          </div>
          <Button className="w-full" type="submit">
            Создать компанию и открыть dashboard
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

