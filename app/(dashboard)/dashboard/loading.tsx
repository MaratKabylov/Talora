import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div aria-label="Загрузка данных" className="space-y-6" role="status">
      <div className="space-y-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-9 w-64 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Card className="space-y-3 px-6" key={item}>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-20" />
          </Card>
        ))}
      </div>
      <Card className="space-y-4 px-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </Card>
      <span className="sr-only">Загрузка...</span>
    </div>
  );
}
