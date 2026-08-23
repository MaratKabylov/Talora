import { createClient } from "@/lib/supabase/server";

import type { ApplicationStatus, InvitationStatus } from "./constants";

type CandidateRecord = {
  city: string | null;
  email: string | null;
  full_name: string | null;
  id: string;
  phone: string | null;
  source: string | null;
};

type JobRecord = {
  id: string;
  title: string;
};

type InvitationRecord = {
  created_at: string;
  expires_at: string | null;
  id: string;
  opened_at: string | null;
  sent_at: string | null;
  status: InvitationStatus;
  token: string;
};

type Relation<T> = T | T[] | null;

type ApplicationRecord = {
  candidate_id: string;
  candidates: Relation<CandidateRecord>;
  created_at: string;
  composite_score: number | null;
  current_stage: string | null;
  fit_score: number | null;
  id: string;
  invitations?: InvitationRecord[] | null;
  jobs: Relation<JobRecord>;
  overall_score: number | null;
  recommendation: string | null;
  requires_review: boolean;
  risk_level: string | null;
  status: ApplicationStatus;
};

export type CandidateApplication = {
  candidate: {
    city: string | null;
    email: string | null;
    fullName: string;
    id: string;
    phone: string | null;
    source: string | null;
  };
  createdAt: string;
  compositeScore: number | null;
  currentStage: string | null;
  fitScore: number | null;
  id: string;
  job: {
    id: string;
    title: string;
  } | null;
  latestInvitation: {
    createdAt: string;
    expiresAt: string | null;
    id: string;
    openedAt: string | null;
    sentAt: string | null;
    status: InvitationStatus;
    token: string;
  } | null;
  overallScore: number | null;
  recommendation: string | null;
  requiresReview: boolean;
  riskLevel: string | null;
  status: ApplicationStatus;
};

function related<T>(value: Relation<T>) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function normalizeApplication(record: ApplicationRecord): CandidateApplication {
  const candidate = related(record.candidates);
  const job = related(record.jobs);
  const invitation = (record.invitations ?? [])
    .slice()
    .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];

  return {
    candidate: {
      city: candidate?.city ?? null,
      email: candidate?.email ?? null,
      fullName: candidate?.full_name ?? "Без имени",
      id: candidate?.id ?? record.candidate_id,
      phone: candidate?.phone ?? null,
      source: candidate?.source ?? null,
    },
    createdAt: record.created_at,
    compositeScore: record.composite_score,
    currentStage: record.current_stage,
    fitScore: record.fit_score,
    id: record.id,
    job: job ? { id: job.id, title: job.title } : null,
    latestInvitation: invitation
      ? {
          createdAt: invitation.created_at,
          expiresAt: invitation.expires_at,
          id: invitation.id,
          openedAt: invitation.opened_at,
          sentAt: invitation.sent_at,
          status: invitation.status,
          token: invitation.token,
        }
      : null,
    overallScore: record.overall_score,
    recommendation: record.recommendation,
    requiresReview: record.requires_review,
    riskLevel: record.risk_level,
    status: record.status,
  };
}

async function queryApplications(companyId: string, jobId?: string) {
  const supabase = await createClient();
  let query = supabase
    .from("candidate_applications")
    .select(
      "id, candidate_id, status, current_stage, overall_score, fit_score, composite_score, recommendation, risk_level, requires_review, created_at, candidates(id, full_name, email, phone, city, source), jobs(id, title), invitations(id, token, status, expires_at, sent_at, opened_at, created_at)",
    )
    .eq("company_id", companyId);

  if (jobId) {
    query = query.eq("job_id", jobId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new Error("Unable to load candidate applications.");
  }

  return ((data ?? []) as unknown as ApplicationRecord[]).map(normalizeApplication);
}

export function listCandidateApplications(companyId: string) {
  return queryApplications(companyId);
}

export function listJobCandidateApplications(companyId: string, jobId: string) {
  return queryApplications(companyId, jobId);
}
