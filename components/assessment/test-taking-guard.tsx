"use client";

import { useEffect, type ReactNode } from "react";

const BLOCKED_EVENTS = ["contextmenu", "copy", "cut", "paste"] as const;

export function TestTakingGuard({ children }: { children: ReactNode }) {
  useEffect(() => {
    const preventDefault = (event: Event) => event.preventDefault();

    document.body.classList.add("test-taking-protected");
    for (const eventName of BLOCKED_EVENTS) {
      document.addEventListener(eventName, preventDefault, { capture: true });
    }

    return () => {
      document.body.classList.remove("test-taking-protected");
      for (const eventName of BLOCKED_EVENTS) {
        document.removeEventListener(eventName, preventDefault, { capture: true });
      }
    };
  }, []);

  return children;
}
