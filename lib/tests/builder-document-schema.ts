import { z } from "zod";
import { hasUniqueOptionIds } from "@/lib/answers/option-shuffle";
import { MATCHING_SCORING_MODES, ORDERING_SCORING_MODES } from "@/lib/structured-questions";
import { DIFFICULTY_VALUES, QUESTION_TYPE_VALUES, TEST_COMPETENCIES, type TestCompetencyKey } from "./builder-constants";
import { SCORING_TYPE_VALUES } from "./constants";
import { testContentBlockSchema } from "./content-blocks";
import { TEST_PRESENTATION_MODES } from "./presentation-settings";
const competencyKeys = TEST_COMPETENCIES.map(c => c.key) as [TestCompetencyKey, ...TestCompetencyKey[]];

export const documentOptionSchema = z.object({
  competencyEffects: z.record(z.string(), z.number().min(-10000).max(10000)),
  explanation: z.string().max(1000).nullable(),
  id: z.string().uuid(),
  isCorrect: z.boolean(),
  matchText: z.string().trim().min(1).max(1000).nullable(),
  points: z.number().min(0).max(10000),
  text: z.string().trim().min(1).max(1000),
});

export const documentQuestionSchema = z
  .object({
    competencyKey: z.enum(competencyKeys).nullable(),
    description: z.string().max(20000).nullable(),
    difficulty: z.enum(DIFFICULTY_VALUES).nullable(),
    id: z.string().uuid(),
    incorrectFeedback: z.string().trim().max(4000).nullable(),
    isRequired: z.boolean(),
    isStructured: z.boolean(),
    options: z.array(documentOptionSchema).max(100),
    points: z.number().min(0).max(10000),
    questionType: z.enum(QUESTION_TYPE_VALUES),
    matchingScoringMode: z.enum(MATCHING_SCORING_MODES),
    orderingScoringMode: z.enum(ORDERING_SCORING_MODES),
    remediationQuestionId: z.string().uuid().nullable(),
    scaleMax: z.number().int().min(2).max(100),
    scaleMin: z.number().int().min(1).max(99),
    shuffleOptions: z.boolean(),
    text: z.string().trim().min(2).max(4000),
  })
  .superRefine((question, context) => {
    if (!hasUniqueOptionIds(question.options)) {
      context.addIssue({
        code: "custom",
        message: "Идентификаторы вариантов ответа не должны повторяться.",
        path: ["options"],
      });
    }
    if (question.questionType === "scale" && question.scaleMin >= question.scaleMax) {
      context.addIssue({ code: "custom", message: "Максимум шкалы должен быть больше минимума." });
    }
    if (
      question.isStructured &&
      (question.questionType === "ordering" || question.questionType === "matching")
    ) {
      if (question.options.length < 2) {
        context.addIssue({
          code: "custom",
          message: "Для сортировки и сопоставления добавьте минимум два элемента.",
          path: ["options"],
        });
      }
      if (question.points <= 0) {
        context.addIssue({
          code: "custom",
          message: "Для автоматически оцениваемого вопроса укажите максимальный балл больше нуля.",
          path: ["points"],
        });
      }
      const normalizedTexts = question.options.map((option) => option.text.trim().toLocaleLowerCase("ru"));
      if (new Set(normalizedTexts).size !== normalizedTexts.length) {
        context.addIssue({
          code: "custom",
          message: "Элементы вопроса не должны повторяться.",
          path: ["options"],
        });
      }
    }
    if (question.isStructured && question.questionType === "matching") {
      if (question.options.some((option) => !option.matchText?.trim())) {
        context.addIssue({
          code: "custom",
          message: "Для каждой строки сопоставления заполните правую часть пары.",
          path: ["options"],
        });
      }
      const normalizedTargets = question.options.map((option) => option.matchText?.trim().toLocaleLowerCase("ru"));
      if (new Set(normalizedTargets).size !== normalizedTargets.length) {
        context.addIssue({
          code: "custom",
          message: "Правые части сопоставления не должны повторяться.",
          path: ["options"],
        });
      }
    }
    if (question.questionType !== "forced_choice") return;
    if (question.options.length < 3) {
      context.addIssue({
        code: "custom",
        message: "Для Forced Choice добавьте минимум три утверждения.",
        path: ["options"],
      });
    }
    question.options.forEach((option, optionIndex) => {
      const effects = Object.values(option.competencyEffects);
      if (effects.length === 0 || effects.some((value) => value <= 0)) {
        context.addIssue({
          code: "custom",
          message: "Для каждого утверждения Forced Choice укажите компетенцию и положительный вес.",
          path: ["options", optionIndex, "competencyEffects"],
        });
      }
    });
  });

export const builderDocumentSchema = z.object({
  sections: z
    .array(
      z.object({
        contentBlocks: z.array(testContentBlockSchema).max(100),
        description: z.string().max(10000).nullable(),
        id: z.string().uuid(),
        questions: z.array(documentQuestionSchema).max(300),
        timeLimitMinutes: z.number().int().min(1).max(1440).nullable(),
        title: z.string().trim().min(2).max(180),
      }).superRefine((section, context) => {
        if (section.contentBlocks.some((block) => block.positionIndex > section.questions.length)) {
          context.addIssue({
            code: "custom",
            message: "Положение блока названия и описания выходит за границы секции.",
          });
        }
      }),
    )
    .max(100),
  templateId: z.string().uuid(),
  version: z.object({
    description: z.string().max(20000).nullable(),
    durationMinutes: z.number().int().min(1).max(1440).nullable(),
    instructions: z.string().max(40000).nullable(),
    presentationSettings: z.object({
      allowBack: z.boolean(),
      captureQuestionTime: z.boolean(),
      presentationMode: z.enum(TEST_PRESENTATION_MODES),
    }),
    scoringType: z.enum(SCORING_TYPE_VALUES),
    title: z.string().trim().min(2).max(180),
  }),
  versionId: z.string().uuid(),
});

export type BuilderDocumentInput = z.infer<typeof builderDocumentSchema>;
