import { createClient } from "@/lib/supabase/server";

import type { ApplicationStatus } from "@/lib/candidates/constants";
import type { CompetencyKey, JobStatus } from "@/lib/jobs/constants";

type Relation<T> = T | T[] | null;

type CandidateRecord = {
  email: string | null;
  full_name: string | null;
  id: string;
};

type SummaryRecord = {
  competency_key: CompetencyKey;
  percentage: number | null;
};

type ApplicationRecord = {
  application_competency_summary?: SummaryRecord[] | null;
  behavior_fit: number | null;
  candidates: Relation<CandidateRecord>;
  completed_at: string | null;
  fit_score: number | null;
  id: string;
  motivation_fit: number | null;
  overall_score: number | null;
  recommendation: string | null;
  requires_review: boolean;
  risk_level: "low" | "medium" | "high" | null;
  status: ApplicationStatus;
};

type JobRecord = {
  id: string;
  status: JobStatus;
  title: string;
};

export type ComparisonCandidate = {
  behaviorFit: number | null;
  candidate: {
    email: string | null;
    fullName: string;
    id: string;
  };
  competencies: Partial<Record<CompetencyKey, number | null>>;
  completedAt: string | null;
  fitScore: number | null;
  id: string;
  motivationFit: number | null;
  overallScore: number | null;
  recommendation: string | null;
  requiresReview: boolean;
  riskLevel: "low" | "medium" | "high" | null;
  status: ApplicationStatus;
};

export type JobComparisonData = {
  applications: ComparisonCandidate[];
  job: {
    id: string;
    status: JobStatus;
    title: string;
  };
};

function related<T>(value: Relation<T>) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function normalizeApplication(record: ApplicationRecord): ComparisonCandidate | null {
  const candidate = related(record.candidates);
  if (!candidate) {
    return null;
  }

  return {
    behaviorFit: record.behavior_fit,
    candidate: {
      email: candidate.email,
      fullName: candidate.full_name ?? "Без имени",
      id: candidate.id,
    },
    competencies: Object.fromEntries(
      (record.application_competency_summary ?? []).map((summary) => [
        summary.competency_key,
        summary.percentage,
      ]),
    ) as Partial<Record<CompetencyKey, number | null>>,
    completedAt: record.completed_at,
    fitScore: record.fit_score,
    id: record.id,
    motivationFit: record.motivation_fit,
    overallScore: record.overall_score,
    recommendation: record.recommendation,
    requiresReview: record.requires_review,
    riskLevel: record.risk_level,
    status: record.status,
  };
}

export async function getJobComparisonData(companyId: string, jobId: string) {
  const supabase = await createClient();
  const [jobResult, applicationsResult] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, status")
      .eq("company_id", companyId)
      .eq("id", jobId)
      .maybeSingle(),
    supabase
      .from("candidate_applications")
      .select(
        "id, status, completed_at, overall_score, fit_score, motivation_fit, behavior_fit, recommendation, risk_level, requires_review, candidates(id, full_name, email), application_competency_summary(competency_key, percentage)",
      )
      .eq("company_id", companyId)
      .eq("job_id", jobId)
      .order("fit_score", { ascending: false, nullsFirst: false })
      .order("completed_at", { ascending: false, nullsFirst: false }),
  ]);

  if (jobResult.error || applicationsResult.error) {
    throw new Error("Unable to load candidate comparison.");
  }

  if (!jobResult.data) {
    return null;
  }

  const applications = ((applicationsResult.data ?? []) as unknown as ApplicationRecord[])
    .map(normalizeApplication)
    .filter((application): application is ComparisonCandidate => application !== null);

  return {
    applications,
    job: jobResult.data as JobRecord,
  } satisfies JobComparisonData;
}
