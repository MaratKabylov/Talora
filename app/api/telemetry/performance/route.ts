import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  CLIENT_PERFORMANCE_OPERATIONS,
  correlationIdFrom,
  roundDuration,
  sanitizeRoutePath,
  WEB_VITAL_NAMES,
} from "@/lib/observability/performance-core";

const routeSchema = z.string().min(1).max(512);
const finiteMetric = z.number().finite().min(0).max(3_600_000);

const payloadSchema = z.discriminatedUnion("kind", [
  z.object({
    durationMs: finiteMetric,
    kind: z.literal("client-operation"),
    name: z.enum(CLIENT_PERFORMANCE_OPERATIONS),
    outcome: z.enum(["failure", "success"]),
    route: routeSchema,
  }),
  z.object({
    delta: z.number().finite().min(-10_000).max(3_600_000),
    id: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
    kind: z.literal("web-vital"),
    name: z.enum(WEB_VITAL_NAMES),
    navigationType: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
    rating: z.enum(["good", "needs-improvement", "poor"]),
    route: routeSchema,
    value: finiteMetric,
  }),
]);

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (process.env.PERFORMANCE_TELEMETRY_ENABLED !== "true") {
    return new NextResponse(null, { status: 204 });
  }

  if (!isSameOrigin(request) || Number(request.headers.get("content-length") ?? 0) > 4096) {
    return new NextResponse(null, { status: 400 });
  }

  const rawBody = await request.text();
  if (rawBody.length > 4096) {
    return new NextResponse(null, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(
    (() => {
      try {
        return JSON.parse(rawBody);
      } catch {
        return null;
      }
    })(),
  );
  if (!parsed.success) {
    return new NextResponse(null, { status: 400 });
  }

  const correlationId = correlationIdFrom(request.headers.get("x-request-id"));
  const payload = parsed.data;
  const common = {
    correlationId,
    route: sanitizeRoutePath(payload.route),
    timestamp: new Date().toISOString(),
    version: 1,
  };

  console.info(
    JSON.stringify(
      payload.kind === "client-operation"
        ? {
            ...common,
            durationMs: roundDuration(payload.durationMs),
            event: "performance.client_operation",
            operation: payload.name,
            outcome: payload.outcome,
          }
        : {
            ...common,
            delta: Math.round(payload.delta * 100) / 100,
            event: "performance.web_vital",
            name: payload.name,
            navigationType: [
              "back-forward",
              "back-forward-cache",
              "navigate",
              "prerender",
              "reload",
              "restore",
            ].includes(payload.navigationType)
              ? payload.navigationType
              : "unknown",
            rating: payload.rating,
            value: roundDuration(payload.value),
          },
    ),
  );

  return new NextResponse(null, {
    headers: { "Cache-Control": "no-store" },
    status: 204,
  });
}
