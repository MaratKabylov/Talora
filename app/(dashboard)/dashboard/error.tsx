"use client";

import { Button } from "@/components/ui/button";

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-xl border bg-background p-8 text-center shadow-sm">
      <h1 className="text-2xl font-semibold">Не удалось загрузить данные</h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        Повторите запрос. Если ошибка сохраняется, проверьте подключение к базе и права доступа.
      </p>
      <Button className="mt-6" onClick={reset} type="button">
        Повторить
      </Button>
    </div>
  );
}
