"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

export function CopyEmployeeInvitationLinkButton({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopy() {
    const invitationUrl = new URL(`/employee-assessment/${token}`, window.location.origin).toString();

    try {
      await navigator.clipboard.writeText(invitationUrl);
      setState("copied");
      window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  return (
    <Button onClick={handleCopy} size="sm" type="button" variant="outline">
      {state === "copied" ? "Скопировано" : state === "error" ? "Не удалось скопировать" : "Скопировать ссылку"}
    </Button>
  );
}
