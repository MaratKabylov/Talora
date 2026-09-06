"use client";

import type {
  ClientPerformanceOperation,
  PerformanceOutcome,
  WebVitalName,
} from "./performance-core";
import { sanitizeRoutePath } from "./performance-core";

type ClientOperationPayload = {
  durationMs: number;
  kind: "client-operation";
  name: ClientPerformanceOperation;
  outcome: PerformanceOutcome;
  route: string;
};

type WebVitalPayload = {
  delta: number;
  id: string;
  kind: "web-vital";
  name: WebVitalName;
  navigationType: string;
  rating: "good" | "needs-improvement" | "poor";
  route: string;
  value: number;
};

function enabled() {
  return process.env.NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED === "true";
}

function report(payload: ClientOperationPayload | WebVitalPayload) {
  if (!enabled() || typeof window === "undefined") return;

  try {
    const body = JSON.stringify(payload);
    if (typeof navigator.sendBeacon === "function") {
      const queued = navigator.sendBeacon(
        "/api/telemetry/performance",
        new Blob([body], { type: "application/json" }),
      );
      if (queued) return;
    }

    void fetch("/api/telemetry/performance", {
      body,
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    }).catch(() => undefined);
  } catch {
    // Telemetry failures must not affect the measured interaction.
  }
}

function currentRoute() {
  return sanitizeRoutePath(window.location.pathname);
}

export function reportClientOperation(
  name: ClientPerformanceOperation,
  durationMs: number,
  outcome: PerformanceOutcome,
) {
  try {
    report({ durationMs, kind: "client-operation", name, outcome, route: currentRoute() });
  } catch {
    // Telemetry failures must not affect the measured interaction.
  }
}

export function reportWebVital(metric: {
  delta: number;
  id: string;
  name: string;
  navigationType?: string;
  rating: "good" | "needs-improvement" | "poor";
  value: number;
}) {
  if (!(["CLS", "FCP", "INP", "LCP", "TTFB"] as string[]).includes(metric.name)) return;

  try {
    report({
      delta: metric.delta,
      id: metric.id,
      kind: "web-vital",
      name: metric.name as WebVitalName,
      navigationType: metric.navigationType ?? "unknown",
      rating: metric.rating,
      route: currentRoute(),
      value: metric.value,
    });
  } catch {
    // Telemetry failures must not affect the measured interaction.
  }
}
