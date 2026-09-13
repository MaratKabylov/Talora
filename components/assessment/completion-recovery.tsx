"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { requestAssessmentCompletionUntilSettled } from "@/lib/assessment/completion-contract";

// Shown only for an already-completed session with an active invitation and no
// running successor. GET never starts scoring; recovery requires an explicit POST.
export function AssessmentCompletionRecovery({ assessmentType, token, sessionId }: {
  assessmentType: "candidate" | "employee"; token: string; sessionId: string;
}) {
  const router = useRouter();
  const mounted = useRef(true);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function resume() {
    if (submitting.current) return;
    submitting.current = true; setPending(true); setError(null);
    let navigating = false;
    try {
      // Completed retries cannot edit answers or reclaim a lease. IDs are required
      // by the request contract; SQL ignores ownership only for completed sessions.
      const result = await requestAssessmentCompletionUntilSettled({ assessmentType, token, sessionId,
        clientId: crypto.randomUUID(), deviceId: crypto.randomUUID(), retryScoring: true });
      if (!mounted.current) return;
      if (result.status === "redirect") { router.replace(result.redirectTo); navigating = true; return; }
      setError(result.status === "processing"
        ? "Результаты ещё обрабатываются. Повторите через несколько секунд."
        : result.status === "scoring_failed"
          ? "Расчёт результатов временно не выполнен. Повторите обработку."
          : "Не удалось продолжить оценку. Повторите попытку.");
    } catch { if (mounted.current) setError("Не удалось завершить оценку. Ответы сохранены — повторите попытку."); }
    finally { if (!navigating) { submitting.current = false; if (mounted.current) setPending(false); } }
  }
  return <div className="space-y-4 rounded-lg border bg-background p-6" aria-busy={pending}>
    <h1 className="text-xl font-semibold">Ответы теста сохранены</h1>
    <p className="text-sm text-muted-foreground">Продолжите оценку, чтобы перейти дальше или завершить обработку результатов.</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <Button disabled={pending} onClick={() => void resume()}>{pending ? "Продолжаем..." : "Продолжить оценку"}</Button>
  </div>;
}
