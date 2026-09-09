import { JOB_LIST_SELECT } from "@/lib/lists/read-models";
import { createClient } from "@/lib/supabase/server";
import { measureServerOperation } from "@/lib/observability/server-performance";
import { normalizeProfileTargets, type ProfileTarget } from "@/lib/scoring/profile-fit";
import {
  normalizeAssessmentCompositeConfig,
  type AssessmentCompositeConfig,
} from "@/lib/scoring/models/assessment-composite";

import type { CompetencyKey, EmploymentType, JobStatus } from "./constants";
import { listAccessibleAssessmentPackages } from "./package-access";

export type { AssessmentPackageOption } from "./package-access";

type PackageRecord = {
  id: string;
  is_system: boolean;
  title: string;
};

type PackageRelation = PackageRecord | PackageRecord[] | null;

type JobRecord = {
  assessment_package_id: string | null;
  assessment_packages: PackageRelation;
  behavior_target_profile_json: unknown;
  composite_scoring_config_json: unknown;
  created_at: string;
  department: string | null;
  description: string | null;
  employment_type: EmploymentType | null;
  id: string;
  location: string | null;
  motivation_target_profile_json: unknown;
  passing_score: number | null;
  status: JobStatus;
  title: string;
  updated_at: string;
};

type WeightRecord = {
  competency_key: CompetencyKey;
  is_required: boolean;
  minimum_score: number | null;
  weight: number;
};

export type JobDetails = {
  assessmentPackageId: string | null;
  assessmentPackageTitle: string | null;
  behaviorTargetProfile: ProfileTarget[];
  compositeScoringConfig: AssessmentCompositeConfig | null;
  createdAt: string;
  department: string | null;
  description: string | null;
  employmentType: EmploymentType | null;
  id: string;
  location: string | null;
  motivationTargetProfile: ProfileTarget[];
  passingScore: number | null;
  status: JobStatus;
  title: string;
  updatedAt: string;
};

export type JobWeight = {
  competencyKey: CompetencyKey;
  isRequired: boolean;
  minimumScore: number | null;
  weightPercent: number;
};

function getRelatedPackage(value: PackageRelation) {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function normalizeJob(record: JobRecord): JobDetails {
  const assessmentPackage = getRelatedPackage(record.assessment_packages);

  return {
    assessmentPackageId: record.assessment_package_id,
    assessmentPackageTitle: assessmentPackage?.title ?? null,
    behaviorTargetProfile: normalizeProfileTargets(record.behavior_target_profile_json),
    compositeScoringConfig: normalizeAssessmentCompositeConfig(record.composite_scoring_config_json),
    createdAt: record.created_at,
    department: record.department,
    description: record.description,
    employmentType: record.employment_type,
    id: record.id,
    location: record.location,
    motivationTargetProfile: normalizeProfileTargets(record.motivation_target_profile_json),
    passingScore: record.passing_score,
    status: record.status,
    title: record.title,
    updatedAt: record.updated_at,
  };
}

export type JobListItem = Pick<JobDetails, "id" | "title" | "department" | "location" | "status" | "updatedAt" | "assessmentPackageTitle">;

async function listJobsUninstrumented(companyId: string): Promise<JobListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("jobs").select(JOB_LIST_SELECT)
    .eq("company_id", companyId).order("updated_at", { ascending: false });
  if (error) throw new Error("Unable to load jobs.");
  type Row = Pick<JobRecord, "id" | "title" | "department" | "location" | "status" | "updated_at"> & {
    assessment_packages: { title: string } | { title: string }[] | null;
  };
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id, title: row.title, department: row.department, location: row.location,
    status: row.status, updatedAt: row.updated_at,
    assessmentPackageTitle: (Array.isArray(row.assessment_packages)
      ? row.assessment_packages[0] : row.assessment_packages)?.title ?? null,
  }));
}

export function listJobs(companyId: string) {
  return measureServerOperation("jobs.list", () => listJobsUninstrumented(companyId));
}

export async function getJobCandidateListContext(companyId: string, jobId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("jobs")
    .select("id, title, status, assessment_package_id")
    .eq("company_id", companyId).eq("id", jobId).maybeSingle();
  if (error) throw new Error("Unable to load job summary.");
  if (!data) return null;
  return { job: { id: data.id as string, title: data.title as string,
    status: data.status as JobStatus, assessmentPackageId: data.assessment_package_id as string | null } };
}

export async function listAssessmentPackages(companyId: string) {
  const supabase = await createClient();
  return listAccessibleAssessmentPackages(supabase, companyId);
}

export async function getJobPageData(companyId: string, jobId: string) {
  const supabase = await createClient();
  const [jobResult, weightsResult, packages] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, title, description, department, location, employment_type, status, assessment_package_id, passing_score, motivation_target_profile_json, behavior_target_profile_json, composite_scoring_config_json, created_at, updated_at, assessment_packages(id, title, is_system)",
      )
      .eq("company_id", companyId)
      .eq("id", jobId)
      .maybeSingle(),
    supabase
      .from("job_competency_weights")
      .select("competency_key, weight, minimum_score, is_required")
      .eq("company_id", companyId)
      .eq("job_id", jobId),
    listAccessibleAssessmentPackages(supabase, companyId),
  ]);

  if (jobResult.error || weightsResult.error) {
    throw new Error("Unable to load job details.");
  }

  if (!jobResult.data) {
    return null;
  }

  return {
    job: normalizeJob(jobResult.data as unknown as JobRecord),
    packages,
    weights: ((weightsResult.data ?? []) as WeightRecord[]).map((weight) => ({
      competencyKey: weight.competency_key,
      isRequired: weight.is_required,
      minimumScore: weight.minimum_score,
      weightPercent: Number(weight.weight) * 100,
    })),
  };
}
