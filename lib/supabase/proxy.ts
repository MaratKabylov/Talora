import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import { serverTimingValue } from "@/lib/observability/performance-core";

export async function updateSession(
  request: NextRequest,
  requestHeaders = new Headers(request.headers),
  correlationId = requestHeaders.get("x-request-id"),
) {
  let response = NextResponse.next({
    headers: correlationId ? { "x-request-id": correlationId } : undefined,
    request: { headers: requestHeaders },
  });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        requestHeaders.set("cookie", request.cookies.toString());
        response = NextResponse.next({
          headers: correlationId ? { "x-request-id": correlationId } : undefined,
          request: { headers: requestHeaders },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  const startedAt = performance.now();
  await supabase.auth.getClaims();
  if (process.env.PERFORMANCE_TELEMETRY_ENABLED === "true") {
    response.headers.append("Server-Timing", serverTimingValue("auth", performance.now() - startedAt));
  }

  return response;
}

