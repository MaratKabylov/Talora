import type { AssessmentDomain, ResultShape } from "@/lib/scoring/types";

import { getLegacyAssessmentDimension } from "./legacy-registry.ts";
import type { AssessmentDimensionResult, AssessmentReportGroup } from "./types";

export const ASSESSMENT_REPORT_GROUP_TITLES: Record<AssessmentReportGroup, string> = {
  behavior: "Поведенческий профиль",
  cognitive: "Когнитивные показатели",
  knowledge_skills: "Профессиональные знания и навыки",
  motivation: "Мотивационный профиль",
  other: "Прочие измерения",
  personality: "Личностный профиль",
  work_competencies: "Рабочие компетенции",
};

export function resolveAssessmentReportGroup(input: {
  assessmentDomain: AssessmentDomain;
  legacyKey?: string | null;
  resultShape: ResultShape;
  sourceType: AssessmentDimensionResult["sourceType"];
}): AssessmentReportGroup {
  if (input.sourceType === "legacy_competency" && input.legacyKey) {
    return getLegacyAssessmentDimension(input.legacyKey)?.group ?? "other";
  }

  if (input.assessmentDomain === "learning" || input.assessmentDomain === "attention") {
    return "cognitive";
  }
  if (input.assessmentDomain === "motivation") return "motivation";
  if (input.assessmentDomain === "personality") return "personality";
  if (input.assessmentDomain === "behavior") return "behavior";
  if (["knowledge", "skills", "sjt"].includes(input.assessmentDomain)) {
    return "knowledge_skills";
  }
  return "other";
}

export function isProfileReportGroup(group: AssessmentReportGroup) {
  return group === "motivation" || group === "personality" || group === "behavior";
}
