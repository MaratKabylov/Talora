import { createClient } from "@/lib/supabase/server";
import { measureServerOperation } from "@/lib/observability/server-performance";
import { sanitizeRichTextValue } from "@/lib/rich-text.server";

import type { TestTemplate, TestVersion } from "./data";
import { getTestTemplatePageData } from "./data";
import type { QuestionDifficulty, QuestionType, TestCompetencyKey } from "./builder-constants";
import { getTestContentBlocks, type TestContentBlock } from "./content-blocks";
import type { QuestionSettings } from "./remediation";
import {
  isStructuredQuestion,
  normalizeMatchingScoringMode,
  normalizeOrderingScoringMode,
  type MatchingScoringMode,
  type OrderingScoringMode,
} from "../structured-questions";

type OptionRecord = {
  competency_effect_json: Record<string, number> | null;
  explanation: string | null;
  id: string;
  is_correct: boolean | null;
  match_text: string | null;
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

export type SectionRecord = {
  description: string | null;
  id: string;
  order_index: number;
  questions?: QuestionRecord[] | null;
  settings_json: unknown;
  time_limit_minutes: number | null;
  title: string;
};

export type BuilderOption = {
  competencyEffects: Record<string, number>;
  explanation: string | null;
  id: string;
  isCorrect: boolean | null;
  matchText: string | null;
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
  isStructured: boolean;
  matchingScoringMode: MatchingScoringMode;
  options: BuilderOption[];
  orderIndex: number;
  orderingScoringMode: OrderingScoringMode;
  points: number;
  questionType: QuestionType;
  remediationQuestionId: string | null;
  scaleMax: number;
  scaleMin: number;
  shuffleOptions: boolean;
  text: string;
};

export type BuilderContentBlock = TestContentBlock;

export type BuilderSection = {
  contentBlocks: BuilderContentBlock[];
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
  templateId: string;
  versionId: string;
  templateTitle: string;
  versionNumber: number;
  questionCount: number;
};

export const BUILDER_SECTION_SELECT = "id, title, description, order_index, settings_json, time_limit_minutes, questions(id, question_type, text, description, order_index, points, competency_key, difficulty, settings_json, answer_options(id, text, match_text, order_index, is_correct, points, competency_effect_json, explanation))";

function normalizeOption(option: OptionRecord): BuilderOption {
  return {
    competencyEffects: option.competency_effect_json ?? {},
    explanation: option.explanation,
    id: option.id,
    isCorrect: option.is_correct,
    matchText: option.match_text,
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
    isStructured: isStructuredQuestion(settings),
    matchingScoringMode: normalizeMatchingScoringMode(settings.matchingScoringMode),
    options: (question.answer_options ?? [])
      .map(normalizeOption)
      .sort((left, right) => left.orderIndex - right.orderIndex),
    orderIndex: question.order_index,
    orderingScoringMode: normalizeOrderingScoringMode(settings.orderingScoringMode),
    points: Number(question.points),
    questionType: question.question_type,
    remediationQuestionId:
      typeof settings.remediationQuestionId === "string"
        ? settings.remediationQuestionId
        : null,
    scaleMax: typeof settings.max === "number" ? settings.max : 5,
    scaleMin: typeof settings.min === "number" ? settings.min : 1,
    shuffleOptions: settings.shuffleOptions === true,
    text: question.text,
  };
}

function normalizeSection(section: SectionRecord): BuilderSection {
  return {
    contentBlocks: getTestContentBlocks(section.settings_json).map((block) => ({
      ...block,
      description: sanitizeRichTextValue(block.description),
    })),
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

export function normalizeBuilderSections(sections: SectionRecord[]): BuilderSection[] {
  return sections.map(normalizeSection).sort((left, right) => left.orderIndex - right.orderIndex);
}

async function getTestBuilderDataUninstrumented(
  companyId: string,
  templateId: string,
  selectedVersionId?: string,
  options?: { metadataOnly?: boolean },
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
  if (options?.metadataOnly) return { sections: [], template, version };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("test_sections")
    .select(BUILDER_SECTION_SELECT)
    .eq("test_version_id", version.id);

  if (error) {
    throw new Error("Unable to load test builder content.");
  }

  return {
    sections: normalizeBuilderSections((data ?? []) as unknown as SectionRecord[]),
    template,
    version,
  };
}

export function getTestBuilderData(
  companyId: string,
  templateId: string,
  selectedVersionId?: string,
  options?: { metadataOnly?: boolean },
) {
  return measureServerOperation("builder.load", () =>
    getTestBuilderDataUninstrumented(companyId, templateId, selectedVersionId, options),
  );
}
