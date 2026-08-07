import { redirect } from "next/navigation";

import { FeedbackMessage } from "@/components/feedback-message";
import { PendingSubmitButton } from "@/components/pending-submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptPlatformInvitationAction } from "@/lib/admin/actions";
import { getAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";

type SearchParams = Promise<{ error?: string }>;

export default async function AcceptAdminInvitationPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const auth = await getAuthContext();
  if (!auth) {
    redirect("/admin/login");
  }

  const admin = createAdminClient();
  const { data: platformUser, error } = await admin
    .from("platform_users")
    .select("status")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to load platform invitation.");
  }
  if (platformUser?.status === "active") {
    redirect("/admin");
  }
  if (platformUser?.status !== "invited") {
    redirect("/admin/access-pending");
  }

  const params = await searchParams;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">Принять приглашение</CardTitle>
        <CardDescription>
          Завершите настройку аккаунта сотрудника Talvia Admin.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <FeedbackMessage error={params.error} />

        <form action={acceptPlatformInvitationAction} className="space-y-4">
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
            Активировать доступ
          </PendingSubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
