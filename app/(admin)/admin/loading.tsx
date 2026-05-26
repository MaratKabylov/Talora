import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div aria-label="Загрузка админ-панели" className="space-y-6" role="status">
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Card className="space-y-3 px-6" key={item}>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-16" />
          </Card>
        ))}
      </div>
      <Card className="space-y-4 px-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </Card>
    </div>
  );
}
