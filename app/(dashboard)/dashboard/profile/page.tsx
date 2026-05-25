import { FeedbackMessage } from "@/components/feedback-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction } from "@/lib/auth/actions";
import { requireCompanyContext } from "@/lib/auth/context";

type ProfileSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: ProfileSearchParams;
}) {
  const context = await requireCompanyContext();
  const params = await searchParams;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">Аккаунт</p>
        <h1 className="text-3xl font-semibold tracking-tight">Профиль</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Контактные данные</CardTitle>
          <CardDescription>
            Email управляется через Supabase Auth; имя и телефон можно обновить здесь.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <FeedbackMessage error={params.error} message={params.message} />
          <form action={updateProfileAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                disabled
                id="email"
                value={context.profile?.email ?? context.user.email ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fullName">Имя</Label>
              <Input
                defaultValue={context.profile?.fullName ?? ""}
                id="fullName"
                name="fullName"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Телефон</Label>
              <Input
                defaultValue={context.profile?.phone ?? ""}
                id="phone"
                name="phone"
                type="tel"
              />
            </div>
            <Button type="submit">Сохранить профиль</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

