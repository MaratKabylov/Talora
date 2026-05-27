import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null) {
  if (!value || value.includes("\\") || value.includes("\r") || value.includes("\n")) {
    return "/onboarding";
  }

  try {
    const origin = "https://talora.local";
    const destination = new URL(value, origin);
    const isAllowedPath =
      destination.pathname === "/onboarding" ||
      destination.pathname === "/dashboard" ||
      destination.pathname.startsWith("/dashboard/") ||
      destination.pathname === "/admin" ||
      destination.pathname === "/admin/access-pending";

    return destination.origin === origin && isAllowedPath
      ? `${destination.pathname}${destination.search}${destination.hash}`
      : "/onboarding";
  } catch {
    return "/onboarding";
  }
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(request.nextUrl.searchParams.get("next"));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });

    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  const loginPath = next.startsWith("/admin") ? "/admin/login" : "/login";
  const params = new URLSearchParams({ error: "Не удалось подтвердить email. Повторите вход." });
  return NextResponse.redirect(new URL(`${loginPath}?${params.toString()}`, request.url));
}
