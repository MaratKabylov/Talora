import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function NotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-lg rounded-xl border bg-background p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold">Страница не найдена</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Запрашиваемая страница недоступна или ссылка больше не актуальна.
        </p>
        <Link className={`${buttonVariants()} mt-6`} href="/">
          На главную
        </Link>
      </div>
    </main>
  );
}
