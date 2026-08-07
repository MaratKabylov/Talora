import Link from "next/link";

import { FeedbackMessage } from "@/components/feedback-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { platformSignInAction } from "@/lib/auth/actions";

type AdminLoginSearchParams = Promise<{
  error?: string;
  message?: string;
}>;

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: AdminLoginSearchParams;
}) {
  const params = await searchParams;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">Войти в Talvia Admin</CardTitle>
        <CardDescription>
          Внутренняя панель владельца и команды платформы.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <FeedbackMessage error={params.error} message={params.message} />

        <form action={platformSignInAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input autoComplete="email" id="email" name="email" required type="email" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Пароль</Label>
            <Input
              autoComplete="current-password"
              id="password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </div>

          <Button className="w-full" type="submit">
            Войти в админ-панель
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          Нет аккаунта сотрудника?{" "}
          <Link className="font-medium text-primary hover:underline" href="/admin/register">
            Зарегистрироваться
          </Link>
        </p>
        <p className="border-t pt-4 text-center text-sm text-muted-foreground">
          <Link className="font-medium text-primary hover:underline" href="/login">
            Перейти ко входу для HR
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

