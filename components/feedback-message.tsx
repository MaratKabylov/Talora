import { cn } from "@/lib/utils";

export function FeedbackMessage({
  error,
  message,
}: {
  error?: string;
  message?: string;
}) {
  const text = error ?? message;

  if (!text) {
    return null;
  }

  return (
    <p
      className={cn(
        "rounded-md border px-3 py-2 text-sm",
        error
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-primary/20 bg-primary/5 text-foreground",
      )}
    >
      {text}
    </p>
  );
}

