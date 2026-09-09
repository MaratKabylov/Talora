import type { TestTemplateStatus, TestVersionStatus } from "../tests/constants";

export const TEST_TEMPLATE_LIST_SELECT = "id, title, category, is_system, status, updated_at, latest_version_id, latest_version_number, latest_version_status, published_version_id, published_version_number, published_version_status, version_count, has_draft";
export const PACKAGE_LIST_SELECT = "id, title, is_system, updated_at, test_count, required_count, duration_minutes";
export const EMPLOYEE_ASSESSMENT_LIST_SELECT = "id, title, status, updated_at, assessment_package_title, participant_count, completed_count, average_fit_score";
export const JOB_LIST_SELECT = "id, title, department, location, status, updated_at, assessment_packages(title)";

export type TestVersionSummary = { id: string; versionNumber: number; status: TestVersionStatus };
export type TestTemplateListItem = {
  id: string; title: string; category: string | null; isSystem: boolean;
  status: TestTemplateStatus; updatedAt: string; versionCount: number; hasDraft: boolean;
  latestVersion: TestVersionSummary | null;
  latestPublishedVersion: TestVersionSummary | null;
};
export type TestTemplateListRecord = {
  id: string; title: string; category: string | null; is_system: boolean;
  status: TestTemplateStatus; updated_at: string; version_count: number; has_draft: boolean;
  latest_version_id: string | null; latest_version_number: number | null;
  latest_version_status: TestVersionStatus | null;
  published_version_id: string | null; published_version_number: number | null;
  published_version_status: TestVersionStatus | null;
};
export function normalizeTestTemplateList(record: TestTemplateListRecord): TestTemplateListItem {
  return {
    id: record.id, title: record.title, category: record.category, isSystem: record.is_system,
    status: record.status, updatedAt: record.updated_at, versionCount: Number(record.version_count), hasDraft: record.has_draft,
    latestVersion: record.latest_version_id && record.latest_version_number !== null && record.latest_version_status
      ? { id: record.latest_version_id, versionNumber: record.latest_version_number, status: record.latest_version_status } : null,
    latestPublishedVersion: record.published_version_id && record.published_version_number !== null && record.published_version_status
      ? { id: record.published_version_id, versionNumber: record.published_version_number, status: record.published_version_status } : null,
  };
}

export type AssessmentPackageListRecord = {
  id: string; title: string; is_system: boolean; updated_at: string; test_count: number; required_count: number; duration_minutes: number;
};
export type AssessmentPackageListItem = {
  id: string; title: string; isSystem: boolean; updatedAt: string; testCount: number; requiredCount: number; durationMinutes: number;
};
export function normalizeAssessmentPackageList(record: AssessmentPackageListRecord): AssessmentPackageListItem {
  return { id: record.id, title: record.title, isSystem: record.is_system,
    updatedAt: record.updated_at, testCount: Number(record.test_count), requiredCount: Number(record.required_count), durationMinutes: Number(record.duration_minutes) };
}
