import Link from "next/link";

import { FeedbackMessage } from "@/components/feedback-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { platformSignUpAction } from "@/lib/auth/actions";

type AdminRegisterSearchParams = Promise<{
  error?: string;
}>;

export default async function AdminRegisterPage({
  searchParams,
}: {
  searchParams: AdminRegisterSearchParams;
}) {
  const params = await searchParams;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">Регистрация в Talora Admin</CardTitle>
        <CardDescription>
          Создайте аккаунт сотрудника платформы. Организация для этого не требуется.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <FeedbackMessage error={params.error} />

        <form action={platformSignUpAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Ваше имя</Label>
            <Input autoComplete="name" id="fullName" name="fullName" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input autoComplete="email" id="email" name="email" required type="email" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Пароль</Label>
            <Input
              autoComplete="new-password"
              id="password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </div>

          <Button className="w-full" type="submit">
            Создать admin-аккаунт
          </Button>
        </form>

        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Доступ к данным SaaS откроется после назначения платформенной роли.
        </p>

        <p className="text-center text-sm text-muted-foreground">
          Уже зарегистрированы?{" "}
          <Link className="font-medium text-primary hover:underline" href="/admin/login">
            Войти
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

