import { type NextRequest, NextResponse } from "next/server";

import { correlationIdFrom } from "@/lib/observability/performance-core";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const correlationId = correlationIdFrom(request.headers.get("x-request-id"));
  requestHeaders.set("x-request-id", correlationId);

  if (
    request.nextUrl.pathname.startsWith("/assessment/") ||
    request.nextUrl.pathname === "/api/telemetry/performance"
  ) {
    return NextResponse.next({
      headers: { "x-request-id": correlationId },
      request: { headers: requestHeaders },
    });
  }

  return updateSession(request, requestHeaders, correlationId);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

