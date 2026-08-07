import Link from "next/link";

import { FeedbackMessage } from "@/components/feedback-message";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction, signUpAction } from "@/lib/auth/actions";

type LoginSearchParams = Promise<{
  error?: string;
  message?: string;
  mode?: string;
}>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: LoginSearchParams;
}) {
  const params = await searchParams;
  const isSignUp = params.mode === "signup";

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle className="text-2xl">
          {isSignUp ? "Создать HR-аккаунт" : "Войти в Talvia"}
        </CardTitle>
        <CardDescription>
          {isSignUp
            ? "После регистрации настройте компанию и рабочее пространство."
            : "Используйте рабочий email и пароль."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <FeedbackMessage error={params.error} message={params.message} />

        <form action={isSignUp ? signUpAction : signInAction} className="space-y-4">
          {isSignUp ? (
            <div className="space-y-2">
              <Label htmlFor="fullName">Ваше имя</Label>
              <Input autoComplete="name" id="fullName" name="fullName" required />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input autoComplete="email" id="email" name="email" required type="email" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Пароль</Label>
            <Input
              autoComplete={isSignUp ? "new-password" : "current-password"}
              id="password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </div>

          <Button className="w-full" type="submit">
            {isSignUp ? "Зарегистрироваться" : "Войти"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {isSignUp ? "Уже есть аккаунт? " : "Еще нет аккаунта? "}
          <Link
            className="font-medium text-primary hover:underline"
            href={isSignUp ? "/login" : "/login?mode=signup"}
          >
            {isSignUp ? "Войти" : "Зарегистрироваться"}
          </Link>
        </p>
        <p className="border-t pt-4 text-center text-sm text-muted-foreground">
          Управляете платформой?{" "}
          <Link className="font-medium text-primary hover:underline" href="/admin/login">
            Войти в Talvia Admin
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

