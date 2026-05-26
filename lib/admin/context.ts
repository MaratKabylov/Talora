import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { requireAuthContext } from "@/lib/auth/context";
import { createAdminClient } from "@/lib/supabase/admin";

import type { PlatformRole } from "./constants";

export type PlatformContext = {
  role: PlatformRole;
  user: {
    email: string | null;
    id: string;
    name: string | null;
  };
};

type PlatformUserRecord = {
  role: PlatformRole;
  status: "active" | "disabled";
};

export const getPlatformContext = cache(async (): Promise<PlatformContext | null> => {
  const auth = await requireAuthContext();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("platform_users")
    .select("role, status")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const platformUser = data as PlatformUserRecord;
  if (platformUser.status !== "active") {
    return null;
  }

  return {
    role: platformUser.role,
    user: {
      email: auth.profile?.email ?? auth.user.email,
      id: auth.user.id,
      name: auth.profile?.fullName ?? null,
    },
  };
});

export async function requirePlatformContext() {
  const context = await getPlatformContext();

  if (!context) {
    redirect("/dashboard");
  }

  return context;
}
