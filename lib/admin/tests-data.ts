import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeRichTextValue } from "@/lib/rich-text.server";
import type {
  BuilderImportSource,
  BuilderQuestion,
  BuilderSection,
  TestBuilderData,
} from "@/lib/tests/builder-data";
import type {
  QuestionDifficulty,
  QuestionType,
  TestCompetencyKey,
} from "@/lib/tests/builder-constants";
import type { ScoringType, TestTemplateStatus, TestVersionStatus } from "@/lib/tests/constants";
import type { TestTemplate, TestVersion } from "@/lib/tests/data";

import { requirePlatformContext } from "./context";

type VersionRecord = {
  created_at: string;
  description: string | null;
  duration_minutes: number | null;
  id: string;
  instructions: string | null;
  published_at: string | null;
  scoring_type: ScoringType;
  status: TestVersionStatus;
  title: string;
  version_number: number;
};

type TemplateRecord = {
  category: string | null;
  created_at: string;
  description: string | null;
  id: string;
  is_system: boolean;
  status: TestTemplateStatus;
  test_versions?: VersionRecord[] | null;
  title: string;
  updated_at: string;
};

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
  settings_json: { max?: number; min?: number; required?: boolean } | null;
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

function normalizeVersion(record: VersionRecord): TestVersion {
  return {
    createdAt: record.created_at,
    description: sanitizeRichTextValue(record.description),
    durationMinutes: record.duration_minutes,
    id: record.id,
    instructions: sanitizeRichTextValue(record.instructions),
    publishedAt: record.published_at,
    scoringType: record.scoring_type,
    status: record.status,
    title: record.title,
    versionNumber: record.version_number,
  };
}

function normalizeTemplate(record: TemplateRecord): TestTemplate {
  const versions = (record.test_versions ?? [])
    .map(normalizeVersion)
    .sort((left, right) => right.versionNumber - left.versionNumber);

  return {
    category: record.category,
    createdAt: record.created_at,
    description: record.description,
    id: record.id,
    isSystem: record.is_system,
    latestVersion: versions[0] ?? null,
    status: record.status,
    title: record.title,
    updatedAt: record.updated_at,
    versions,
  };
}

function normalizeOption(option: OptionRecord) {
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
    isRequired: settings.required ?? true,
    options: (question.answer_options ?? [])
      .map(normalizeOption)
      .sort((left, right) => left.orderIndex - right.orderIndex),
    orderIndex: question.order_index,
    points: Number(question.points),
    questionType: question.question_type,
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

function systemTemplateQuery() {
  return createAdminClient()
    .from("test_templates")
    .select(
      "id, title, description, category, is_system, status, created_at, updated_at, test_versions(id, version_number, title, description, instructions, duration_minutes, scoring_type, status, published_at, created_at)",
    )
    .eq("is_system", true)
    .is("company_id", null);
}

export async function listAdminSystemTests() {
  await requirePlatformContext();
  const { data, error } = await systemTemplateQuery().order("updated_at", { ascending: false });

  if (error) {
    throw new Error("Unable to load system tests.");
  }

  return ((data ?? []) as unknown as TemplateRecord[]).map(normalizeTemplate);
}

export async function getAdminSystemTest(templateId: string) {
  await requirePlatformContext();
  const { data, error } = await systemTemplateQuery().eq("id", templateId).maybeSingle();

  if (error) {
    throw new Error("Unable to load system test.");
  }

  return data ? normalizeTemplate(data as unknown as TemplateRecord) : null;
}

export async function getAdminSystemTestBuilderData(
  templateId: string,
  selectedVersionId?: string,
): Promise<TestBuilderData | null> {
  const template = await getAdminSystemTest(templateId);
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

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("test_sections")
    .select(
      "id, title, description, order_index, time_limit_minutes, questions(id, question_type, text, description, order_index, points, competency_key, difficulty, settings_json, answer_options(id, text, order_index, is_correct, points, competency_effect_json, explanation))",
    )
    .eq("test_version_id", version.id);

  if (error) {
    throw new Error("Unable to load system test builder content.");
  }

  return {
    sections: ((data ?? []) as unknown as SectionRecord[])
      .map(normalizeSection)
      .sort((left, right) => left.orderIndex - right.orderIndex),
    template,
    version,
  };
}

export async function getAdminSystemBuilderImportSources(
  currentVersionId: string,
): Promise<BuilderImportSource[]> {
  await requirePlatformContext();
  const admin = createAdminClient();
  const { data: templates, error } = await admin
    .from("test_templates")
    .select(
      "title, test_versions(id, version_number, status, test_sections(id, title, description, order_index, time_limit_minutes, questions(id, question_type, text, description, order_index, points, competency_key, difficulty, settings_json, answer_options(id, text, order_index, is_correct, points, competency_effect_json, explanation))))",
    )
    .eq("is_system", true)
    .is("company_id", null);

  if (error) {
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

  return ((templates ?? []) as unknown as ImportTemplateRecord[])
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
