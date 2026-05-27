import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { getAuthContext } from "@/lib/auth/context";
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
  status: "active" | "disabled" | "invited";
};

export const getPlatformContext = cache(async (): Promise<PlatformContext | null> => {
  const auth = await getAuthContext();
  if (!auth) {
    return null;
  }

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
  const auth = await getAuthContext();
  if (!auth) {
    redirect("/admin/login");
  }

  const context = await getPlatformContext();

  if (!context) {
    const admin = createAdminClient();
    const { data } = await admin
      .from("platform_users")
      .select("status")
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (data?.status === "invited") {
      redirect("/admin/accept-invitation");
    }

    redirect("/admin/access-pending");
  }

  return context;
}
