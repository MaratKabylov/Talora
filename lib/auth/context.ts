import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ACTIVE_COMPANY_COOKIE } from "@/lib/company/constants";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type CompanyRole = "owner" | "admin" | "recruiter" | "viewer" | "super_admin";

export type CompanyMembership = {
  id: string;
  name: string;
  role: CompanyRole;
};

export type ViewerProfile = {
  id: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
};

export type AuthContext = {
  companies: CompanyMembership[];
  activeCompany: CompanyMembership | null;
  profile: ViewerProfile | null;
  user: {
    id: string;
    email: string | null;
  };
};

type ProfileRecord = {
  email: string | null;
  full_name: string | null;
  id: string;
  phone: string | null;
};

type MembershipRecord = {
  company_id: string;
  company_name: string;
  role: CompanyRole;
};

type LegacyMembershipRecord = {
  company_id: string;
  companies: { id: string; name: string } | { id: string; name: string }[] | null;
  role: CompanyRole;
};

async function readCompanyMemberships(userId: string): Promise<MembershipRecord[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_my_company_memberships");

  if (!error) {
    return (data ?? []) as MembershipRecord[];
  }

  // Keep deployments usable while the accompanying migration is being applied.
  // The fallback remains server-only and is constrained to the verified JWT subject.
  if (error.code === "PGRST202") {
    const admin = createAdminClient();
    const { data: legacyData, error: legacyError } = await admin
      .from("company_users")
      .select("company_id, role, companies(id, name)")
      .eq("user_id", userId)
      .eq("status", "active");

    if (legacyError) {
      throw new Error("Unable to read company memberships.", { cause: legacyError });
    }

    return ((legacyData ?? []) as LegacyMembershipRecord[]).flatMap((membership) => {
      const company = Array.isArray(membership.companies)
        ? membership.companies[0]
        : membership.companies;

      return company
        ? [{ company_id: company.id, company_name: company.name, role: membership.role }]
        : [];
    });
  }

  throw new Error("Unable to read company memberships.", { cause: error });
}

export const getAuthContext = cache(async (): Promise<AuthContext | null> => {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;

  if (claimsError || !userId) {
    return null;
  }

  const [{ data: profileData }, membershipData] = await Promise.all([
    supabase.from("profiles").select("id, email, full_name, phone").eq("id", userId).maybeSingle(),
    readCompanyMemberships(userId),
  ]);

  const companies = membershipData.map((membership) => ({
    id: membership.company_id,
    name: membership.company_name,
    role: membership.role,
  }));

  const cookieStore = await cookies();
  const activeCompanyId = cookieStore.get(ACTIVE_COMPANY_COOKIE)?.value;
  const activeCompany =
    companies.find((company) => company.id === activeCompanyId) ?? companies[0] ?? null;
  const profile = profileData as ProfileRecord | null;

  return {
    user: {
      id: userId,
      email: typeof claimsData.claims.email === "string" ? claimsData.claims.email : null,
    },
    profile: profile
      ? {
          id: profile.id,
          email: profile.email,
          fullName: profile.full_name,
          phone: profile.phone,
        }
      : null,
    companies,
    activeCompany,
  };
});

export async function requireAuthContext() {
  const context = await getAuthContext();

  if (!context) {
    redirect("/login");
  }

  return context;
}

export async function requireCompanyContext() {
  const context = await requireAuthContext();

  if (!context.activeCompany) {
    redirect("/onboarding");
  }

  return {
    ...context,
    activeCompany: context.activeCompany,
  };
}

