import { createClient } from "@/lib/supabase/server";
import { sanitizeRichTextValue } from "@/lib/rich-text.server";

import type { TestTemplate, TestVersion } from "./data";
import { getTestTemplatePageData } from "./data";
import type { QuestionDifficulty, QuestionType, TestCompetencyKey } from "./builder-constants";
import type { QuestionSettings } from "./remediation";

type OptionRecord = {
  competency_effect_json: Record<string, number> | null;
  explanation: string | null;
  id: string;
  is_correct: boolean | null;
  order_index: number;
  points: number;
  text: string;
};

type QuestionRecord = {
  answer_options?: OptionRecord[] | null;
  competency_key: TestCompetencyKey | null;
  description: string | null;
  difficulty: QuestionDifficulty | null;
  id: string;
  order_index: number;
  points: number;
  question_type: QuestionType;
  settings_json: QuestionSettings | null;
  text: string;
};

type SectionRecord = {
  description: string | null;
  id: string;
  order_index: number;
  questions?: QuestionRecord[] | null;
  time_limit_minutes: number | null;
  title: string;
};

type SystemTestAccessRecord = {
  test_template_id: string;
};

export type BuilderOption = {
  competencyEffects: Record<string, number>;
  explanation: string | null;
  id: string;
  isCorrect: boolean | null;
  orderIndex: number;
  points: number;
  text: string;
};

export type BuilderQuestion = {
  competencyKey: TestCompetencyKey | null;
  description: string | null;
  difficulty: QuestionDifficulty | null;
  id: string;
  incorrectFeedback: string | null;
  isRequired: boolean;
  options: BuilderOption[];
  orderIndex: number;
  points: number;
  questionType: QuestionType;
  remediationQuestionId: string | null;
  scaleMax: number;
  scaleMin: number;
  text: string;
};

export type BuilderSection = {
  description: string | null;
  id: string;
  orderIndex: number;
  questions: BuilderQuestion[];
  timeLimitMinutes: number | null;
  title: string;
};

export type TestBuilderData = {
  sections: BuilderSection[];
  template: TestTemplate;
  version: TestVersion;
};

export type BuilderImportSource = {
  id: string;
  sections: BuilderSection[];
  title: string;
  versionNumber: number;
};

function normalizeOption(option: OptionRecord): BuilderOption {
  return {
    competencyEffects: option.competency_effect_json ?? {},
    explanation: option.explanation,
    id: option.id,
    isCorrect: option.is_correct,
    orderIndex: option.order_index,
    points: Number(option.points),
    text: option.text,
  };
}

function normalizeQuestion(question: QuestionRecord): BuilderQuestion {
  const settings = question.settings_json ?? {};

  return {
    competencyKey: question.competency_key,
    description: sanitizeRichTextValue(question.description),
    difficulty: question.difficulty,
    id: question.id,
    incorrectFeedback:
      typeof settings.incorrectFeedback === "string" ? settings.incorrectFeedback : null,
    isRequired: settings.required ?? true,
    options: (question.answer_options ?? [])
      .map(normalizeOption)
      .sort((left, right) => left.orderIndex - right.orderIndex),
    orderIndex: question.order_index,
    points: Number(question.points),
    questionType: question.question_type,
    remediationQuestionId:
      typeof settings.remediationQuestionId === "string"
        ? settings.remediationQuestionId
        : null,
    scaleMax: typeof settings.max === "number" ? settings.max : 5,
    scaleMin: typeof settings.min === "number" ? settings.min : 1,
    text: question.text,
  };
}

function normalizeSection(section: SectionRecord): BuilderSection {
  return {
    description: sanitizeRichTextValue(section.description),
    id: section.id,
    orderIndex: section.order_index,
    questions: (section.questions ?? [])
      .map(normalizeQuestion)
      .sort((left, right) => left.orderIndex - right.orderIndex),
    timeLimitMinutes: section.time_limit_minutes,
    title: section.title,
  };
}

async function listGrantedSystemTemplateIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
) {
  const { data, error } = await supabase
    .from("company_system_test_access")
    .select("test_template_id")
    .eq("company_id", companyId);

  if (error) {
    return [];
  }

  return ((data ?? []) as SystemTestAccessRecord[]).map((row) => row.test_template_id);
}

function importSourceSelect() {
  return "title, test_versions(id, version_number, status, test_sections(id, title, description, order_index, time_limit_minutes, questions(id, question_type, text, description, order_index, points, competency_key, difficulty, settings_json, answer_options(id, text, order_index, is_correct, points, competency_effect_json, explanation))))";
}

export async function getTestBuilderData(
  companyId: string,
  templateId: string,
  selectedVersionId?: string,
): Promise<TestBuilderData | null> {
  const template = await getTestTemplatePageData(companyId, templateId);

  if (!template) {
    return null;
  }

  const version =
    template.versions.find((entry) => entry.id === selectedVersionId) ??
    template.versions.find((entry) => entry.status === "draft") ??
    template.latestVersion;

  if (!version) {
    return null;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("test_sections")
    .select(
      "id, title, description, order_index, time_limit_minutes, questions(id, question_type, text, description, order_index, points, competency_key, difficulty, settings_json, answer_options(id, text, order_index, is_correct, points, competency_effect_json, explanation))",
    )
    .eq("test_version_id", version.id);

  if (error) {
    throw new Error("Unable to load test builder content.");
  }

  return {
    sections: ((data ?? []) as unknown as SectionRecord[])
      .map(normalizeSection)
      .sort((left, right) => left.orderIndex - right.orderIndex),
    template,
    version,
  };
}

export async function getBuilderImportSources(
  companyId: string,
  currentVersionId: string,
): Promise<BuilderImportSource[]> {
  const supabase = await createClient();
  const systemTemplateIds = await listGrantedSystemTemplateIds(supabase, companyId);
  const [companyTemplatesResult, systemTemplatesResult] = await Promise.all([
    supabase
      .from("test_templates")
      .select(importSourceSelect())
      .eq("company_id", companyId)
      .eq("is_system", false),
    systemTemplateIds.length > 0
      ? supabase
          .from("test_templates")
          .select(importSourceSelect())
          .in("id", systemTemplateIds)
          .eq("is_system", true)
          .is("company_id", null)
          .eq("status", "active")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (companyTemplatesResult.error || systemTemplatesResult.error) {
    return [];
  }

  type ImportTemplateRecord = {
    test_versions?: Array<{
      id: string;
      status: string;
      test_sections?: SectionRecord[] | null;
      version_number: number;
    }> | null;
    title: string;
  };

  const templates = [
    ...((systemTemplatesResult.data ?? []) as unknown as ImportTemplateRecord[]),
    ...((companyTemplatesResult.data ?? []) as unknown as ImportTemplateRecord[]),
  ];

  return templates
    .flatMap((template) =>
      (template.test_versions ?? [])
        .filter((version) => version.id !== currentVersionId && version.status === "published")
        .map((version) => ({
          id: version.id,
          sections: (version.test_sections ?? [])
            .map(normalizeSection)
            .sort((left, right) => left.orderIndex - right.orderIndex),
          title: template.title,
          versionNumber: version.version_number,
        })),
    )
    .filter((source) => source.sections.length > 0)
    .sort((left, right) => left.title.localeCompare(right.title, "ru"));
}
