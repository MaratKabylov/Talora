import { richTextValueToHtml } from "@/lib/rich-text";
import { cn } from "@/lib/utils";

export function RichTextContent({
  className,
  value,
}: {
  className?: string;
  value: string | null | undefined;
}) {
  if (!value) return null;

  return (
    <div
      className={cn("rich-text-content", className)}
      dangerouslySetInnerHTML={{ __html: richTextValueToHtml(value) }}
    />
  );
}
