"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

export function PendingSubmitButton({
  children,
  disabled,
  pendingText,
  ...props
}: React.ComponentProps<typeof Button> & {
  pendingText: string;
}) {
  const { pending } = useFormStatus();

  return (
    <Button aria-disabled={pending} disabled={disabled || pending} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}
