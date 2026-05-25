"use client";

import { AssessmentShell } from "@/components/assessment/assessment-shell";
import { Button } from "@/components/ui/button";

export default function AssessmentError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AssessmentShell>
      <div className="rounded-xl border bg-background p-6 text-center shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold sm:text-2xl">Не удалось открыть оценку</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Попробуйте загрузить страницу снова. Ваши ранее сохраненные ответы не теряются.
        </p>
        <Button className="mt-6 w-full sm:w-auto" onClick={reset} type="button">
          Повторить
        </Button>
      </div>
    </AssessmentShell>
  );
}
