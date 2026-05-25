import { createClient } from "@/lib/supabase/server";

import type { CompetencyKey, EmploymentType, JobStatus } from "./constants";

type PackageRecord = {
  id: string;
  is_system: boolean;
  title: string;
};

type PackageRelation = PackageRecord | PackageRecord[] | null;

type JobRecord = {
  assessment_package_id: string | null;
  assessment_packages: PackageRelation;
  created_at: string;
  department: string | null;
  description: string | null;
  employment_type: EmploymentType | null;
  id: string;
  location: string | null;
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

export type AssessmentPackageOption = {
  id: string;
  isSystem: boolean;
  title: string;
};

export type JobDetails = {
  assessmentPackageId: string | null;
  assessmentPackageTitle: string | null;
  createdAt: string;
  department: string | null;
  description: string | null;
  employmentType: EmploymentType | null;
  id: string;
  location: string | null;
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
    createdAt: record.created_at,
    department: record.department,
    description: record.description,
    employmentType: record.employment_type,
    id: record.id,
    location: record.location,
    passingScore: record.passing_score,
    status: record.status,
    title: record.title,
    updatedAt: record.updated_at,
  };
}

export async function listJobs(companyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, title, description, department, location, employment_type, status, assessment_package_id, passing_score, created_at, updated_at, assessment_packages(id, title, is_system)",
    )
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error("Unable to load jobs.");
  }

  return ((data ?? []) as unknown as JobRecord[]).map(normalizeJob);
}

export async function listAssessmentPackages(companyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assessment_packages")
    .select("id, title, is_system")
    .or(`company_id.eq.${companyId},is_system.eq.true`)
    .order("is_system", { ascending: false })
    .order("title");

  if (error) {
    throw new Error("Unable to load assessment packages.");
  }

  return ((data ?? []) as PackageRecord[]).map((assessmentPackage) => ({
    id: assessmentPackage.id,
    isSystem: assessmentPackage.is_system,
    title: assessmentPackage.title,
  }));
}

export async function getJobPageData(companyId: string, jobId: string) {
  const supabase = await createClient();
  const [jobResult, weightsResult, packagesResult] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, title, description, department, location, employment_type, status, assessment_package_id, passing_score, created_at, updated_at, assessment_packages(id, title, is_system)",
      )
      .eq("company_id", companyId)
      .eq("id", jobId)
      .maybeSingle(),
    supabase
      .from("job_competency_weights")
      .select("competency_key, weight, minimum_score, is_required")
      .eq("company_id", companyId)
      .eq("job_id", jobId),
    supabase
      .from("assessment_packages")
      .select("id, title, is_system")
      .or(`company_id.eq.${companyId},is_system.eq.true`)
      .order("is_system", { ascending: false })
      .order("title"),
  ]);

  if (jobResult.error || weightsResult.error || packagesResult.error) {
    throw new Error("Unable to load job details.");
  }

  if (!jobResult.data) {
    return null;
  }

  return {
    job: normalizeJob(jobResult.data as unknown as JobRecord),
    packages: ((packagesResult.data ?? []) as PackageRecord[]).map((assessmentPackage) => ({
      id: assessmentPackage.id,
      isSystem: assessmentPackage.is_system,
      title: assessmentPackage.title,
    })),
    weights: ((weightsResult.data ?? []) as WeightRecord[]).map((weight) => ({
      competencyKey: weight.competency_key,
      isRequired: weight.is_required,
      minimumScore: weight.minimum_score,
      weightPercent: Number(weight.weight) * 100,
    })),
  };
}
