import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { measureServerOperation } from "@/lib/observability/server-performance";
import { sanitizeRichTextValue } from "@/lib/rich-text.server";
import { getTestContentBlocks } from "@/lib/tests/content-blocks";
import { getDisplayOptions } from "@/lib/answers/option-shuffle";
import { createDeterministicShuffledIds, isStructuredQuestion, validateOrderingAnswer } from "@/lib/structured-questions";
import type { AssessmentQuestionPageData, FlowQuestion } from "./data";
import type { TestPresentationSettings } from "@/lib/tests/presentation-settings";
import {
  publicAnswerJson, requestedSectionIndex,
  type AssessmentSectionSnapshot, type PublicFlowQuestion, type SectionSavedAnswer, type SectionSummary,
} from "./section-contract";

const nullableText = z.string().nullable();
const savedAnswerSchema = z.object({
  answerJson: z.record(z.string(), z.unknown()).nullable(), answerText: nullableText,
  selectedOptionId: nullableText, timeSpentSeconds: z.number().nullable(), remediationRequired: z.boolean(),
});
const settingsSchema = z.object({
  required: z.boolean().optional(), min: z.number().optional(), max: z.number().optional(),
  minSelections: z.number().optional(), maxSelections: z.number().optional(), mode: z.string().optional(),
  structuredResponseVersion: z.number().optional(), shuffleOptions: z.boolean().optional(),
  remediationQuestionId: z.string().optional(), incorrectFeedback: z.string().optional(),
});
const sectionSchema = z.object({
  id: z.string().uuid(), title: z.string(), description: nullableText, settings_json: z.unknown(),
  questions: z.array(z.object({
    id: z.string().uuid(), text: z.string(), description: nullableText, order_index: z.number(),
    question_type: z.enum(["single_choice", "multiple_choice", "forced_choice", "scale", "ordering", "matching", "open_text"]),
    settings_json: settingsSchema,
    answer_options: z.array(z.object({ id: z.string().uuid(), text: z.string(), order_index: z.number(),
      match_target_id: z.string().uuid(), match_text: nullableText })),
  })),
});
const snapshotSchema = z.object({
  sections: z.array(z.object({ id: z.string().uuid(), title: z.string(), orderIndex: z.number().int(),
    questionCount: z.number().int().nonnegative(), visibleQuestionCount: z.number().int().nonnegative(),
    incompleteQuestionCount: z.number().int().nonnegative() })),
  sectionIndex: z.number().int().nonnegative(), reviewMode: z.boolean(), section: sectionSchema.nullable(),
  answers: z.record(z.string(), savedAnswerSchema),
});

function offsets(sections: SectionSummary[], sectionIndex: number) {
  return {
    questionOffset: sections.slice(0, sectionIndex).reduce((sum, section) => sum + section.visibleQuestionCount, 0),
    otherVisibleQuestionCount: sections.reduce((sum, section, index) => sum + (index === sectionIndex ? 0 : section.visibleQuestionCount), 0),
  };
}

// The only presenter for the RPC output. Never spread raw DB rows into a browser DTO.
export function presentAssessmentSection(raw: unknown, sessionId: string): AssessmentSectionSnapshot {
  const data = snapshotSchema.parse(raw);
  const answers: Record<string, SectionSavedAnswer> = {};
  const section = data.section;
  if ((section?.id ?? null) !== (data.sections[data.sectionIndex]?.id ?? null)) {
    throw new Error("Inconsistent assessment section snapshot.");
  }
  const remediationParents = new Map((section?.questions ?? []).flatMap(question =>
    question.settings_json.remediationQuestionId ? [[question.settings_json.remediationQuestionId, question.id] as const] : []));
  const questions: PublicFlowQuestion[] = (section?.questions ?? []).map(question => {
    const settings = question.settings_json;
    const answer = data.answers[question.id];
    const options = question.answer_options.slice().sort((a, b) => a.order_index - b.order_index || a.id.localeCompare(b.id));
    const optionById = new Map(options.map(option => [option.id, option]));
    const targetById = new Map(options.flatMap(option => option.match_text
      ? [[option.match_target_id, { id: option.match_target_id, text: option.match_text }] as const] : []));
    const structured = isStructuredQuestion(settings);
    const savedOrdering = validateOrderingAnswer({ orderedOptionIds: answer?.answerJson?.orderedOptionIds }, options.map(option => option.id));
    const presentedIds = question.question_type === "ordering" && structured
      ? savedOrdering.ok ? savedOrdering.answer.orderedOptionIds
        : createDeterministicShuffledIds(options.map(option => option.id), `${sessionId}:${question.id}:ordering`)
      : getDisplayOptions({ attemptId: sessionId, options, questionId: question.id,
          shuffle: (question.question_type === "single_choice" || question.question_type === "multiple_choice") && settings.shuffleOptions === true }).map(option => option.id);
    const targets = createDeterministicShuffledIds(options.map(option => option.match_target_id), `${sessionId}:${question.id}:matching`);
    const questionDto: PublicFlowQuestion = {
      id: question.id, text: question.text, description: sanitizeRichTextValue(question.description),
      questionType: question.question_type, orderIndex: question.order_index, sectionTitle: section!.title,
      incorrectFeedback: answer?.remediationRequired ? settings.incorrectFeedback ?? null : null,
      isRequired: settings.required ?? true, isStructured: structured,
      minSelections: settings.minSelections ?? (settings.required === false ? 0 : 1),
      maxSelections: settings.maxSelections ?? options.length, scaleMin: settings.min ?? 1, scaleMax: settings.max ?? 5,
      forcedChoiceMode: settings.mode === "most_least" ? settings.mode : null,
      remediationParentId: remediationParents.get(question.id) ?? null, remediationQuestionId: settings.remediationQuestionId ?? null,
      options: presentedIds.flatMap(id => { const option = optionById.get(id); return option ? [{ id, text: option.text }] : []; }),
      matchingTargets: targets.flatMap(id => { const target = targetById.get(id); return target ? [target] : []; }),
    };
    if (answer) answers[question.id] = { answerJson: publicAnswerJson(questionDto, answer.answerJson ?? {}),
      answerText: answer.answerText, selectedOptionId: answer.selectedOptionId, timeSpentSeconds: answer.timeSpentSeconds,
      remediationRequired: Boolean(questionDto.remediationQuestionId && answer.remediationRequired) };
    return questionDto;
  });
  return { answers, sections: data.sections, sectionIndex: data.sectionIndex, reviewMode: data.reviewMode,
    section: section ? { id: section.id, title: section.title, description: sanitizeRichTextValue(section.description), questions,
      contentBlocks: getTestContentBlocks(section.settings_json).map(block => ({ ...block, description: sanitizeRichTextValue(block.description) })) } : null,
    ...offsets(data.sections, data.sectionIndex) };
}

type LegacyData = Pick<AssessmentQuestionPageData, "sections" | "answers">;
type SectionRequest = { assessmentType: "candidate" | "employee"; token: string; sessionId: string;
  requestedIndex?: string; review?: string; presentationSettings: TestPresentationSettings };

function publicQuestion(question: FlowQuestion): PublicFlowQuestion {
  return {
    id: question.id, text: question.text, description: question.description,
    questionType: question.questionType, orderIndex: question.orderIndex, sectionTitle: question.sectionTitle,
    incorrectFeedback: question.incorrectFeedback, isRequired: question.isRequired, isStructured: question.isStructured,
    minSelections: question.minSelections, maxSelections: question.maxSelections, scaleMin: question.scaleMin, scaleMax: question.scaleMax,
    forcedChoiceMode: question.forcedChoiceMode, remediationParentId: question.remediationParentId, remediationQuestionId: question.remediationQuestionId,
    options: question.options.map(option => ({ id: option.id, text: option.text })),
    matchingTargets: question.matchingTargets.map(target => ({ id: target.id, text: target.text })),
  };
}

export function selectLegacyAssessmentSection(data: LegacyData, request: SectionRequest): AssessmentSectionSnapshot {
  const sections: SectionSummary[] = data.sections.map((section, index) => {
    const visible = section.questions.filter(question => !question.remediationParentId || data.answers[question.remediationParentId]?.isCorrect === false);
    return { id: section.id, title: section.title, orderIndex: index, questionCount: section.questions.length,
      visibleQuestionCount: visible.length, incompleteQuestionCount: visible.filter(question => !data.answers[question.id]).length };
  });
  const reviewMode = request.presentationSettings.presentationMode === "one_question" && request.presentationSettings.allowBack && request.review === "1";
  const firstIncomplete = sections.findIndex(section => section.incompleteQuestionCount > 0);
  const sectionIndex = request.presentationSettings.presentationMode === "one_question" && !reviewMode && firstIncomplete >= 0
    ? firstIncomplete : Math.min(requestedSectionIndex(request.requestedIndex), Math.max(sections.length - 1, 0));
  const selected = data.sections[sectionIndex] ?? null;
  const answers: Record<string, SectionSavedAnswer> = {};
  for (const question of selected?.questions ?? []) {
    const answer = data.answers[question.id];
    if (answer) answers[question.id] = { answerJson: publicAnswerJson(question, answer.answerJson),
      answerText: answer.answerText, selectedOptionId: answer.selectedOptionId, timeSpentSeconds: answer.timeSpentSeconds,
      remediationRequired: Boolean(question.remediationQuestionId && answer.isCorrect === false) };
  }
  return { answers, sections, sectionIndex, reviewMode,
    section: selected ? { id: selected.id, title: selected.title, description: selected.description,
      contentBlocks: selected.contentBlocks, questions: selected.questions.map(publicQuestion) } : null, ...offsets(sections, sectionIndex) };
}

export async function getAssessmentSectionSnapshot(request: SectionRequest, legacyRead: () => Promise<LegacyData | null>) {
  if (process.env.ASSESSMENT_SECTION_READ_V2 !== "true") {
    const legacy = await legacyRead();
    return legacy ? selectLegacyAssessmentSection(legacy, request) : null;
  }
  if (!z.string().uuid().safeParse(request.sessionId).success || !/^[a-f0-9]{64}$/i.test(request.token)) return null;
  return measureServerOperation("assessment.load_section", async () => {
    const { data, error } = await createAdminClient().rpc("read_assessment_section_v2", {
      p_scope: request.assessmentType, p_token: request.token, p_session_id: request.sessionId,
      p_section_index: requestedSectionIndex(request.requestedIndex), p_review: request.review === "1",
    });
    if (error) throw new Error("Unable to load the assessment section.");
    if (data === null) return null;
    try { return presentAssessmentSection(data, request.sessionId); }
    catch { throw new Error("Unexpected assessment section response."); }
  });
}
