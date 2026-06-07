import type { CompanyRole } from "@/lib/auth/context";

export function canManageAssessmentPackages(role: CompanyRole) {
  return role === "owner" || role === "admin" || role === "recruiter" || role === "super_admin";
}
