import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

import {
  type AccessReason,
  type CompanyStatus,
  canViewCandidatePii,
} from "./constants";
import { requirePlatformContext, type PlatformContext } from "./context";

type Relation<T> = T | T[] | null;

type PersonSummary = {
  email?: string | null;
  full_name?: string | null;
  id?: string;
};

export type AdminCompanyMember = {
  created_at: string;
  id: string;
  profiles?: Relation<PersonSummary>;
  role: string;
  status: string;
};

export type AdminCompanyApplicationPreview = {
  candidates?: Relation<PersonSummary>;
  created_at: string;
  fit_score: number | null;
  id: string;
  overall_score: number | null;
  requires_review: boolean;
  status: string;
};

export type AdminCompanyNote = {
  created_at: string;
  id: string;
  note: string;
  profiles?: Relation<PersonSummary>;
};

export type AdminApplicationListItem = {
  candidates?: Relation<PersonSummary>;
  companies: Relation<{ id: string; name: string }>;
  company_id: string;
  completed_at: string | null;
  created_at: string;
  fit_score: number | null;
  id: string;
  jobs: Relation<{ id: string; title: string }>;
  overall_score: number | null;
  recommendation: string | null;
  requires_review: boolean;
  risk_level: string | null;
  status: string;
};

export type AdminAssessmentMonitoringItem = {
  candidate_reports: Array<{ id: string }> | null;
  candidates?: Relation<PersonSummary>;
  companies: Relation<{ name: string }>;
  completed_at: string | null;
  id: string;
  jobs: Relation<{ title: string }>;
  requires_review: boolean;
  status: string;
  test_sessions: Array<{ id: string; status: string }> | null;
};

export type AdminTenantUser = {
  companies: Relation<{ id: string; name: string }>;
  company_id: string;
  created_at: string;
  id: string;
  profiles: Relation<PersonSummary>;
  role: string;
  status: string;
};

function related<T>(value: Relation<T>) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

async function platformAccess() {
  const context = await requirePlatformContext();
  return { admin: createAdminClient(), context };
}

export async function recordPlatformAudit(
  context: PlatformContext,
  action: string,
  targetType: string,
  targetId?: string | null,
  companyId?: string | null,
  reason?: string | null,
  metadata: Record<string, unknown> = {},
) {
  const admin = createAdminClient();
  const { error } = await admin.from("platform_audit_logs").insert({
    action,
    actor_role: context.role,
    actor_user_id: context.user.id,
    company_id: companyId ?? null,
    metadata_json: metadata,
    reason: reason ?? null,
    target_id: targetId ?? null,
    target_type: targetType,
  });

  if (error) {
    throw new Error("Unable to write platform audit event.");
  }
}

function countValue(result: { count: number | null; error: unknown }, table: string) {
  const { count, error } = result;
  if (error) {
    throw new Error(`Unable to count ${table}.`);
  }
  return count ?? 0;
}

export async function getAdminDashboardData() {
  await requirePlatformContext();
  const admin = createAdminClient();
  const [
    companies,
    activeCompanies,
    suspendedCompanies,
    users,
    activeJobs,
    applications,
    completed,
    reviewRequired,
    invited,
    started,
    recentCompaniesResult,
  ] = await Promise.all([
    admin.from("companies").select("*", { count: "exact", head: true }),
    admin.from("companies").select("*", { count: "exact", head: true }).eq("status", "active"),
    admin.from("companies").select("*", { count: "exact", head: true }).eq("status", "suspended"),
    admin.from("company_users").select("*", { count: "exact", head: true }).eq("status", "active"),
    admin.from("jobs").select("*", { count: "exact", head: true }).eq("status", "active"),
    admin.from("candidate_applications").select("*", { count: "exact", head: true }),
    admin.from("candidate_applications").select("*", { count: "exact", head: true }).in("status", ["completed", "shortlisted"]),
    admin.from("candidate_applications").select("*", { count: "exact", head: true }).eq("requires_review", true),
    admin.from("invitations").select("*", { count: "exact", head: true }).in("status", ["sent", "opened", "started", "completed"]),
    admin.from("invitations").select("*", { count: "exact", head: true }).in("status", ["started", "completed"]),
    admin
      .from("companies")
      .select("id, name, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (recentCompaniesResult.error) {
    throw new Error("Unable to load recent companies.");
  }

  return {
    activeCompanies: countValue(activeCompanies, "companies"),
    activeJobs: countValue(activeJobs, "jobs"),
    applications: countValue(applications, "candidate_applications"),
    companies: countValue(companies, "companies"),
    completed: countValue(completed, "candidate_applications"),
    funnel: {
      completed: countValue(completed, "candidate_applications"),
      invited: countValue(invited, "invitations"),
      started: countValue(started, "invitations"),
    },
    recentCompanies: (recentCompaniesResult.data ?? []) as Array<{
      created_at: string;
      id: string;
      name: string;
      status: CompanyStatus;
    }>,
    reviewRequired: countValue(reviewRequired, "candidate_applications"),
    suspendedCompanies: countValue(suspendedCompanies, "companies"),
    users: countValue(users, "company_users"),
  };
}

export async function listAdminCompanies(search?: string, status?: CompanyStatus | "") {
  const { admin } = await platformAccess();
  let query = admin
    .from("companies")
    .select(
      "id, name, industry, city, bin_or_iin, status, created_at, company_users(count), jobs(count), candidate_applications(count)",
    )
    .order("created_at", { ascending: false });

  if (search?.trim()) {
    query = query.ilike("name", `%${search.trim()}%`);
  }
  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error("Unable to load platform companies.");
  }

  return (data ?? []) as unknown as Array<{
    bin_or_iin: string | null;
    candidate_applications: Array<{ count: number }>;
    city: string | null;
    company_users: Array<{ count: number }>;
    created_at: string;
    id: string;
    industry: string | null;
    jobs: Array<{ count: number }>;
    name: string;
    status: CompanyStatus;
  }>;
}

export async function getAdminCompanyDetail(companyId: string) {
  const { admin, context } = await platformAccess();
  const includePii = canViewCandidatePii(context.role);
  const [companyResult, membersResult, jobsResult, applicationsResult, notesResult] =
    await Promise.all([
      admin
        .from("companies")
        .select(
          "id, name, bin_or_iin, industry, city, status, suspension_reason, suspended_at, created_at",
        )
        .eq("id", companyId)
        .maybeSingle(),
      admin
        .from("company_users")
        .select(includePii ? "id, role, status, created_at, profiles(id, full_name, email)" : "id, role, status, created_at")
        .eq("company_id", companyId)
        .order("created_at"),
      admin
        .from("jobs")
        .select("id, title, status, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(20),
      admin
        .from("candidate_applications")
        .select(
          includePii
            ? "id, status, overall_score, fit_score, requires_review, created_at, candidates(full_name), jobs(title)"
            : "id, status, overall_score, fit_score, requires_review, created_at, jobs(title)",
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(20),
      includePii
        ? admin
            .from("platform_company_notes")
            .select("id, note, created_at, profiles(full_name, email)")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (
    companyResult.error ||
    membersResult.error ||
    jobsResult.error ||
    applicationsResult.error ||
    notesResult.error
  ) {
    throw new Error("Unable to load company admin view.");
  }
  if (!companyResult.data) {
    return null;
  }

  await recordPlatformAudit(context, "view_company", "company", companyId, companyId);

  return {
    applications: (applicationsResult.data ?? []) as unknown as AdminCompanyApplicationPreview[],
    company: companyResult.data as {
      bin_or_iin: string | null;
      city: string | null;
      created_at: string;
      id: string;
      industry: string | null;
      name: string;
      status: CompanyStatus;
      suspended_at: string | null;
      suspension_reason: string | null;
    },
    jobs: jobsResult.data ?? [],
    members: (membersResult.data ?? []) as unknown as AdminCompanyMember[],
    notes: (notesResult.data ?? []) as unknown as AdminCompanyNote[],
  };
}

export async function listAdminApplications(filters: {
  companyId?: string;
  review?: boolean;
  status?: string;
}) {
  const { admin, context } = await platformAccess();
  const includePii = canViewCandidatePii(context.role);
  let query = admin
    .from("candidate_applications")
    .select(
      includePii
        ? "id, company_id, status, overall_score, fit_score, recommendation, risk_level, requires_review, created_at, completed_at, companies(id, name), candidates(full_name, email), jobs(id, title)"
        : "id, company_id, status, overall_score, fit_score, recommendation, risk_level, requires_review, created_at, completed_at, companies(id, name), jobs(id, title)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (filters.companyId) {
    query = query.eq("company_id", filters.companyId);
  }
  if (filters.status) {
    query = query.eq("status", filters.status);
  }
  if (filters.review) {
    query = query.eq("requires_review", true);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error("Unable to load platform applications.");
  }
  return (data ?? []) as unknown as AdminApplicationListItem[];
}

export async function getAdminApplicationDetail(applicationId: string, reason: AccessReason) {
  const { admin, context } = await platformAccess();
  if (!canViewCandidatePii(context.role)) {
    return null;
  }

  const [applicationResult, sessionsResult, summaryResult, risksResult] = await Promise.all([
    admin
      .from("candidate_applications")
      .select(
        "id, company_id, status, current_stage, overall_score, fit_score, recommendation, risk_level, requires_review, completed_at, companies(id, name), candidates(id, full_name, email, phone, city), jobs(id, title)",
      )
      .eq("id", applicationId)
      .maybeSingle(),
    admin
      .from("test_sessions")
      .select(
        "id, status, started_at, completed_at, percentage, test_versions(title), candidate_answers(id, answer_text, answer_json, is_correct, points_awarded, selected_option_id, questions(text, question_type, answer_options(id, text)))",
      )
      .eq("application_id", applicationId)
      .order("created_at"),
    admin
      .from("application_competency_summary")
      .select("competency_key, percentage, weighted_score, is_below_minimum")
      .eq("application_id", applicationId),
    admin
      .from("candidate_risk_flags")
      .select("id, title, description, risk_level")
      .eq("application_id", applicationId),
  ]);

  if (
    applicationResult.error ||
    sessionsResult.error ||
    summaryResult.error ||
    risksResult.error
  ) {
    throw new Error("Unable to load candidate platform view.");
  }
  if (!applicationResult.data) {
    return null;
  }

  const application = applicationResult.data as unknown as {
    candidates: Relation<{ city: string | null; email: string | null; full_name: string | null; phone: string | null }>;
    companies: Relation<{ id: string; name: string }>;
    company_id: string;
    completed_at: string | null;
    fit_score: number | null;
    id: string;
    jobs: Relation<{ id: string; title: string }>;
    overall_score: number | null;
    recommendation: string | null;
    requires_review: boolean;
    risk_level: string | null;
    status: string;
  };
  await recordPlatformAudit(
    context,
    "view_candidate_pii",
    "application",
    application.id,
    application.company_id,
    reason,
  );

  return {
    application: {
      ...application,
      candidate: related(application.candidates),
      company: related(application.companies),
      job: related(application.jobs),
    },
    competencies: summaryResult.data ?? [],
    risks: risksResult.data ?? [],
    sessions: sessionsResult.data ?? [],
  };
}

export async function listAdminUsers() {
  const { admin, context } = await platformAccess();
  if (!canViewCandidatePii(context.role)) {
    return [];
  }
  const { data, error } = await admin
    .from("company_users")
    .select("id, company_id, role, status, created_at, companies(id, name), profiles(id, full_name, email)")
    .order("created_at", { ascending: false })
    .limit(250);
  if (error) {
    throw new Error("Unable to load tenant users.");
  }
  return (data ?? []) as unknown as AdminTenantUser[];
}

export async function listAssessmentMonitoring() {
  const { admin, context } = await platformAccess();
  const includePii = canViewCandidatePii(context.role);
  const { data, error } = await admin
    .from("candidate_applications")
    .select(
      includePii
        ? "id, status, requires_review, completed_at, companies(name), jobs(title), candidates(full_name), candidate_reports(id), test_sessions(id, status)"
        : "id, status, requires_review, completed_at, companies(name), jobs(title), candidate_reports(id), test_sessions(id, status)",
    )
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) {
    throw new Error("Unable to load assessment monitoring.");
  }
  return (data ?? []) as unknown as AdminAssessmentMonitoringItem[];
}

export async function listPlatformTeam() {
  const { admin, context } = await platformAccess();
  const { data, error } = await admin
    .from("platform_users")
    .select("user_id, role, status, created_at, profiles!platform_users_user_id_fkey(full_name, email)")
    .order("created_at");
  if (error) {
    throw new Error("Unable to load platform team.");
  }
  return { context, users: data ?? [] };
}

export async function listPlatformAudit() {
  const { admin } = await platformAccess();
  const { data, error } = await admin
    .from("platform_audit_logs")
    .select("id, actor_role, action, target_type, target_id, company_id, reason, created_at, profiles(full_name, email), companies(name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    throw new Error("Unable to load platform audit.");
  }
  return data ?? [];
}
