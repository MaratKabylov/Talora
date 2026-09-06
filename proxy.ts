import { type NextRequest, NextResponse } from "next/server";

import { correlationIdFrom } from "@/lib/observability/performance-core";
import { updateSession } from "@/lib/supabase/proxy";
import { shouldRefreshAuthSession } from "@/lib/supabase/proxy-routes";

export async function proxy(request: NextRequest) {
  const requestHeaders = new Headers(request.headers);
  const correlationId = correlationIdFrom(request.headers.get("x-request-id"));
  requestHeaders.set("x-request-id", correlationId);

  // Keep request correlation on public routes without creating an Auth client.
  if (!shouldRefreshAuthSession(request.nextUrl.pathname)) {
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

