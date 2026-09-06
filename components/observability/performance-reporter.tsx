"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";

import {
  reportClientOperation,
  reportWebVital,
} from "@/lib/observability/client-performance";

export function PerformanceReporter() {
  useReportWebVitals(reportWebVital);

  useEffect(() => {
    function reportNavigation() {
      const navigation = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (navigation?.duration) {
        reportClientOperation("navigation.document", navigation.duration, "success");
      }
    }

    if (document.readyState === "complete") {
      reportNavigation();
      return;
    }

    window.addEventListener("load", reportNavigation, { once: true });
    return () => window.removeEventListener("load", reportNavigation);
  }, []);

  return null;
}
