import Link from "next/link";
import { redirect } from "next/navigation";

import { FeedbackMessage } from "@/components/feedback-message";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlatformContext } from "@/lib/admin/context";
import { platformSignOutAction } from "@/lib/auth/actions";
import { getAuthContext } from "@/lib/auth/context";

type AdminAccessPendingSearchParams = Promise<{
  message?: string;
}>;

export default async function AdminAccessPendingPage({
  searchParams,
}: {
  searchParams: AdminAccessPendingSearchParams;
}) {
  const auth = await getAuthContext();
  if (!auth) {
    redirect("/admin/login");
  }

  const platform = await getPlatformContext();
  if (platform) {
    redirect("/admin");
  }

  const params = await searchParams;

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle className="text-2xl">Доступ к Talora Admin ожидает активации</CardTitle>
        <CardDescription>
          Аккаунт создан без организации. Для доступа к backoffice ему нужна платформенная роль.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <FeedbackMessage message={params.message} />
        <p className="text-sm text-muted-foreground">
          Попросите владельца платформы назначить вам роль, затем проверьте доступ снова.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link className={buttonVariants()} href="/admin">
            Проверить доступ
          </Link>
          <form action={platformSignOutAction}>
            <Button type="submit" variant="outline">
              Выйти
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}

