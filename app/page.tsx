import Link from "next/link";
import { ArrowRight, ChartNoAxesColumnIncreasing, ClipboardCheck } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center gap-12 px-6 py-16">
      <div className="max-w-3xl space-y-6">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
          Talora
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-6xl">
          Оценка кандидатов для понятных решений о найме
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Стартовый каркас HR Assessment SaaS. Вакансии, тесты и отчеты будут
          добавляться по milestone.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link className={buttonVariants({ size: "lg" })} href="/login">
            Войти
            <ArrowRight />
          </Link>
          <Link className={buttonVariants({ size: "lg", variant: "outline" })} href="/dashboard">
            Открыть dashboard
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <ClipboardCheck className="size-6 text-primary" />
            <CardTitle>Тесты и версии</CardTitle>
            <CardDescription>
              Будущая библиотека системных и кастомных оценок.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <ChartNoAxesColumnIncreasing className="size-6 text-primary" />
            <CardTitle>Отчеты и сравнение</CardTitle>
            <CardDescription>
              Будущие результаты кандидатов внутри вакансии.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </main>
  );
}
