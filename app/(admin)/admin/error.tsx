"use client";

import { Button } from "@/components/ui/button";

export default function AdminError({ reset }: { reset: () => void }) {
  return (
    <div className="rounded-xl border bg-background p-8 text-center shadow-sm">
      <h1 className="text-2xl font-semibold">Не удалось загрузить admin-данные</h1>
      <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
        Повторите запрос. При сохранении ошибки проверьте миграцию platform backoffice и доступ сотрудника.
      </p>
      <Button className="mt-6" onClick={reset} type="button">
        Повторить
      </Button>
    </div>
  );
}
