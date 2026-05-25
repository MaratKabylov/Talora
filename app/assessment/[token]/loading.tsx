import { AssessmentShell } from "@/components/assessment/assessment-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AssessmentLoading() {
  return (
    <AssessmentShell>
      <div aria-label="Загрузка оценки" className="space-y-6" role="status">
        <div className="space-y-3">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Card className="space-y-5 px-6">
          <Skeleton className="h-6 w-48 max-w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-11 w-full sm:w-44" />
        </Card>
        <span className="sr-only">Загрузка...</span>
      </div>
    </AssessmentShell>
  );
}
