import { cn } from "@/lib/utils";

export function EmptyState({
  action,
  className,
  description,
  title,
}: {
  action?: React.ReactNode;
  className?: string;
  description: string;
  title: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg border border-dashed px-5 py-8 text-center",
        className,
      )}
    >
      <p className="font-medium">{title}</p>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
