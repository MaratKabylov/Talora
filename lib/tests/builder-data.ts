import { createClient } from "@/lib/supabase/server";

import type { TestTemplate, TestVersion } from "./data";
import { getTestTemplatePageData } from "./data";
import type { QuestionDifficulty, QuestionType, TestCompetencyKey } from "./builder-constants";

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
  settings_json: { max?: number; min?: number } | null;
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
  options: BuilderOption[];
  orderIndex: number;
  points: number;
  questionType: QuestionType;
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
    description: question.description,
    difficulty: question.difficulty,
    id: question.id,
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
    description: section.description,
    id: section.id,
    orderIndex: section.order_index,
    questions: (section.questions ?? [])
      .map(normalizeQuestion)
      .sort((left, right) => left.orderIndex - right.orderIndex),
    timeLimitMinutes: section.time_limit_minutes,
    title: section.title,
  };
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
