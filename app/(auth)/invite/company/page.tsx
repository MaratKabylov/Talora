import { redirect } from "next/navigation";

import { FeedbackMessage } from "@/components/feedback-message";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAuthContext } from "@/lib/auth/context";
import { acceptCompanyInvitationAction } from "@/lib/company/member-actions";
import { createAdminClient } from "@/lib/supabase/admin";

type SearchParams = Promise<{
  error?: string;
  organizationId?: string;
}>;

type Relation<T> = T | T[] | null;

function one<T>(value: Relation<T>) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function AcceptCompanyInvitationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const auth = await getAuthContext();
  if (!auth) {
    redirect("/login");
  }
  if (!params.organizationId) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();
  const { data: membership, error } = await admin
    .from("company_users")
    .select("role, status, companies(name)")
    .eq("company_id", params.organizationId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error || !membership) {
    redirect("/dashboard");
  }
  if (membership.status === "active") {
    redirect("/dashboard");
  }
  if (membership.status !== "invited") {
    redirect(`/login?${new URLSearchParams({ error: "Приглашение больше не активно." }).toString()}`);
  }

  const company = one(membership.companies as Relation<{ name: string }>);

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">Принять приглашение</CardTitle>
        <CardDescription>
          Завершите настройку аккаунта для доступа к организации {company?.name ?? "Talora"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <FeedbackMessage error={params.error} />

        <form action={acceptCompanyInvitationAction} className="space-y-4">
          <input name="companyId" type="hidden" value={params.organizationId} />
          <div className="space-y-2">
            <Label htmlFor="fullName">Ваше имя</Label>
            <Input
              autoComplete="name"
              defaultValue={auth.profile?.fullName ?? ""}
              id="fullName"
              name="fullName"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Создайте пароль</Label>
            <Input
              autoComplete="new-password"
              id="password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </div>

          <PendingSubmitButton className="w-full" pendingText="Активируем доступ..." type="submit">
            Войти в организацию
          </PendingSubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
