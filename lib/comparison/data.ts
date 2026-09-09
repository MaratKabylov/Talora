import { comparisonPage, COMPARISON_PAGE_SIZE, DEFAULT_COMPARISON_FILTERS, type ComparisonPageFilters } from "./pagination";
import { createClient } from "@/lib/supabase/server";
import { measureServerOperation } from "@/lib/observability/server-performance";

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
  composite_score: number | null;
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
  compositeScore: number | null;
  fitScore: number | null;
  id: string;
  motivationFit: number | null;
  overallScore: number | null;
  recommendation: string | null;
  requiresReview: boolean;
  riskLevel: "low" | "medium" | "high" | null;
  status: ApplicationStatus;
};

export type ComparisonSummary = { participantCount: number; completedCount: number; shortlistedCount: number; averageFitScore: number | null };

export type JobComparisonData = {
  nextCursor: string | null;
  summary: ComparisonSummary;
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
    compositeScore: record.composite_score,
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

async function getJobComparisonDataUninstrumented(companyId: string, jobId: string, filters: ComparisonPageFilters, cursor?: string) {
  const supabase = await createClient();
  const page = comparisonPage(companyId, jobId, filters, cursor);
  let query = supabase.from("candidate_applications")
    .select("id, status, completed_at, overall_score, fit_score, motivation_fit, behavior_fit, composite_score, recommendation, risk_level, requires_review, candidates!inner(id, full_name, email), application_competency_summary(competency_key, percentage)")
    .eq("company_id", companyId).eq("job_id", jobId);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.recommendation) query = query.eq("recommendation", filters.recommendation);
  if (filters.riskLevel) query = query.eq("risk_level", filters.riskLevel);
  if (page.predicate) query = query.or(page.predicate);
  const [jobResult, applicationsResult, summaryResult] = await Promise.all([
    supabase.from("jobs").select("id, title, status").eq("company_id", companyId).eq("id", jobId).maybeSingle(),
    query.order("fit_score", { ascending: page.ascending, nullsFirst: false })
      .order("id", { ascending: true }).limit(COMPARISON_PAGE_SIZE + 1),
    supabase.from("job_comparison_summary")
      .select("participant_count, completed_count, shortlisted_count, average_fit_score")
      .eq("company_id", companyId).eq("id", jobId).maybeSingle(),
  ]);

  if (jobResult.error || applicationsResult.error || summaryResult.error) {
    throw new Error("Unable to load candidate comparison.");
  }

  if (!jobResult.data) {
    return null;
  }

  const resultPage = page.finish((applicationsResult.data ?? []) as unknown as ApplicationRecord[]);
  const applications = resultPage.items
    .map(normalizeApplication)
    .filter((application): application is ComparisonCandidate => application !== null);

  return {
    applications,
    nextCursor: resultPage.nextCursor,
    summary: {
      participantCount: Number(summaryResult.data?.participant_count ?? 0),
      completedCount: Number(summaryResult.data?.completed_count ?? 0),
      shortlistedCount: Number(summaryResult.data?.shortlisted_count ?? 0),
      averageFitScore: summaryResult.data?.average_fit_score == null ? null : Number(summaryResult.data.average_fit_score),
    },
    job: jobResult.data as JobRecord,
  } satisfies JobComparisonData;
}

export function getJobComparisonData(companyId: string, jobId: string, filters: ComparisonPageFilters = DEFAULT_COMPARISON_FILTERS, cursor?: string) {
  return measureServerOperation("comparisons.candidate", () =>
    getJobComparisonDataUninstrumented(companyId, jobId, filters, cursor),
  );
}
