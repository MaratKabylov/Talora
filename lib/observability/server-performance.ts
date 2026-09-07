import "server-only";

import { headers } from "next/headers";

import { correlationIdFrom, roundDuration } from "./performance-core";

export type ServerPerformanceOperation =
  | "assessment.autosave"
  | "assessment.claim"
  | "assessment.complete"
  | "assessment.event"
  | "assessment.expire"
  | "assessment.heartbeat"
  | "assessment.load_candidate"
  | "assessment.load_employee"
  | "assessment.load_question_candidate"
  | "assessment.load_question_employee"
  | "assessment.load_section"
  | "assessment.load_test_overview"
  | "auth.context"
  | "builder.clone"
  | "builder.import_sources"
  | "builder.load"
  | "builder.save"
  | "candidates.job_list"
  | "candidates.list"
  | "comparisons.employee"
  | "comparisons.candidate"
  | "employee_assessments.list"
  | "jobs.list"
  | "packages.list"
  | "reports.candidate"
  | "reports.employee"
  | "scoring.candidate.calculate"
  | "scoring.candidate.persist"
  | "scoring.employee.calculate"
  | "scoring.employee.persist"
  | "tests.list";

type MeasureOptions = {
  correlationId?: string;
};

function telemetryEnabled() {
  return process.env.PERFORMANCE_TELEMETRY_ENABLED === "true";
}

async function currentCorrelationId(provided?: string) {
  if (provided) return correlationIdFrom(provided);

  try {
    return correlationIdFrom((await headers()).get("x-request-id"));
  } catch {
    return correlationIdFrom(null);
  }
}

export async function recordServerPerformance(
  operation: ServerPerformanceOperation,
  durationMs: number,
  outcome: "failure" | "success",
  options: MeasureOptions = {},
) {
  if (!telemetryEnabled()) return;

  try {
    const correlationId = await currentCorrelationId(options.correlationId);
    console.info(
      JSON.stringify({
        correlationId,
        durationMs: roundDuration(durationMs),
        event: "performance.server_operation",
        operation,
        outcome,
        timestamp: new Date().toISOString(),
        version: 1,
      }),
    );
  } catch {
    // Observability must never break a user-facing operation.
  }
}

export async function measureServerOperation<T>(
  operation: ServerPerformanceOperation,
  task: () => Promise<T> | T,
  options: MeasureOptions = {},
): Promise<T> {
  if (!telemetryEnabled()) return await task();

  const startedAt = performance.now();
  try {
    const result = await task();
    await recordServerPerformance(operation, performance.now() - startedAt, "success", options);
    return result;
  } catch (error) {
    await recordServerPerformance(operation, performance.now() - startedAt, "failure", options);
    throw error;
  }
}
