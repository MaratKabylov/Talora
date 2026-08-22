"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireCompanyContext } from "@/lib/auth/context";
import { sanitizeRichTextValue } from "@/lib/rich-text.server";
import { createClient } from "@/lib/supabase/server";
import {
  MATCHING_SCORING_MODES,
  ORDERING_SCORING_MODES,
  STRUCTURED_RESPONSE_VERSION,
} from "@/lib/structured-questions";

import {
  DIFFICULTY_VALUES,
  QUESTION_TYPE_VALUES,
  TEST_COMPETENCIES,
  type TestCompetencyKey,
} from "./builder-constants";
import { canManageTests, SCORING_TYPE_VALUES } from "./constants";
import { testContentBlockSchema, withTestContentBlocks } from "./content-blocks";
import {
  mergePresentationSettings,
  TEST_PRESENTATION_MODES,
} from "./presentation-settings";
import { validateRemediationLinks } from "./remediation";
import { formatTestVersionTitle } from "./version-title";

const competencyKeys = TEST_COMPETENCIES.map((competency) => competency.key) as [
  TestCompetencyKey,
  ...TestCompetencyKey[],
];

const optionalText = (maximum: number) =>
  z.preprocess(
    (value) => {
      const text = typeof value === "string" ? value.trim() : "";
      return text || null;
    },
    z.string().max(maximum, "Значение слишком длинное.").nullable(),
  );

const nonnegativeOrder = z.preprocess(
  (value) => Number(typeof value === "string" && value.trim() ? value : "0"),
  z.number().int("Порядок должен быть целым числом.").min(0, "Порядок не может быть отрицательным."),
);

const optionalPositiveInteger = z.preprocess(
  (value) => {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? Number(text) : null;
  },
  z.number().int("Введите целое число.").min(1, "Значение должно быть больше нуля.").nullable(),
);

const pointsSchema = z.preprocess(
  (value) => {
    const text = typeof value === "string" ? value.trim().replace(",", ".") : "";
    return text ? Number(text) : 0;
  },
  z.number().min(0, "Баллы не могут быть отрицательными.").max(10000, "Слишком большое число баллов."),
);

const optionalNumber = z.preprocess(
  (value) => {
    const text = typeof value === "string" ? value.trim().replace(",", ".") : "";
    return text ? Number(text) : null;
  },
  z.number().min(-10000).max(10000).nullable(),
);

const optionalCompetency = z.preprocess(
  (value) => (typeof value === "string" && value ? value : null),
  z.enum(competencyKeys).nullable(),
);

const sectionSchema = z.object({
  description: optionalText(10000),
  orderIndex: nonnegativeOrder,
  timeLimitMinutes: optionalPositiveInteger,
  title: z.string().trim().min(2, "Укажите название секции.").max(180, "Название слишком длинное."),
});

const questionSchema = z
  .object({
    competencyKey: optionalCompetency,
    description: optionalText(20000),
    difficulty: z.preprocess(
      (value) => (typeof value === "string" && value ? value : null),
      z.enum(DIFFICULTY_VALUES).nullable(),
    ),
    orderIndex: nonnegativeOrder,
    points: pointsSchema,
    questionType: z.enum(QUESTION_TYPE_VALUES),
    scaleMax: optionalPositiveInteger,
    scaleMin: optionalPositiveInteger,
    text: z.string().trim().min(2, "Введите текст вопроса.").max(4000, "Вопрос слишком длинный."),
  })
  .superRefine((question, context) => {
    if (
      question.questionType === "scale" &&
      question.scaleMin !== null &&
      question.scaleMax !== null &&
      question.scaleMin >= question.scaleMax
    ) {
      context.addIssue({
        code: "custom",
        message: "Максимум шкалы должен быть больше минимума.",
      });
    }
  });

const optionSchema = z
  .object({
    effectCompetencyKey: optionalCompetency,
    effectValue: optionalNumber,
    explanation: optionalText(1000),
    isCorrect: z.boolean(),
    orderIndex: nonnegativeOrder,
    points: pointsSchema,
    text: z.string().trim().min(1, "Введите вариант ответа.").max(1000, "Вариант слишком длинный."),
  })
  .superRefine((option, context) => {
    if ((option.effectCompetencyKey && option.effectValue === null) || (!option.effectCompetencyKey && option.effectValue !== null)) {
      context.addIssue({
        code: "custom",
        message: "Для эффекта укажите компетенцию и значение вместе.",
      });
    }
  });

const documentOptionSchema = z.object({
  competencyEffects: z.record(z.string(), z.number().min(-10000).max(10000)),
  explanation: z.string().max(1000).nullable(),
  id: z.string().uuid(),
  isCorrect: z.boolean(),
  matchText: z.string().trim().min(1).max(1000).nullable(),
  points: z.number().min(0).max(10000),
  text: z.string().trim().min(1).max(1000),
});

const documentQuestionSchema = z
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
    text: z.string().trim().min(2).max(4000),
  })
  .superRefine((question, context) => {
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

const builderDocumentSchema = z.object({
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
export type BuilderSaveResult = {
  error?: string;
  ok: boolean;
  savedAt?: string;
};

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function parseId(formData: FormData, key: string) {
  return z.string().uuid().safeParse(formString(formData, key));
}

function getBuilderPath(templateId: string, versionId: string) {
  return `/dashboard/tests/${templateId}/builder?version=${versionId}`;
}

function redirectWithFeedback(path: string, type: "error" | "message", text: string): never {
  const separator = path.includes("?") ? "&" : "?";
  const params = new URLSearchParams({ [type]: text });
  redirect(`${path}${separator}${params.toString()}`);
}

function parseSection(formData: FormData) {
  return sectionSchema.safeParse({
    description: formString(formData, "sectionDescription"),
    orderIndex: formString(formData, "sectionOrderIndex"),
    timeLimitMinutes: formString(formData, "sectionTimeLimitMinutes"),
    title: formString(formData, "sectionTitle"),
  });
}

function parseQuestion(formData: FormData) {
  return questionSchema.safeParse({
    competencyKey: formString(formData, "competencyKey"),
    description: formString(formData, "questionDescription"),
    difficulty: formString(formData, "difficulty"),
    orderIndex: formString(formData, "questionOrderIndex"),
    points: formString(formData, "questionPoints"),
    questionType: formString(formData, "questionType"),
    scaleMax: formString(formData, "scaleMax"),
    scaleMin: formString(formData, "scaleMin"),
    text: formString(formData, "questionText"),
  });
}

function parseOption(formData: FormData) {
  return optionSchema.safeParse({
    effectCompetencyKey: formString(formData, "effectCompetencyKey"),
    effectValue: formString(formData, "effectValue"),
    explanation: formString(formData, "optionExplanation"),
    isCorrect: formData.get("isCorrect") === "on",
    orderIndex: formString(formData, "optionOrderIndex"),
    points: formString(formData, "optionPoints"),
    text: formString(formData, "optionText"),
  });
}

async function getActionContext(formData: FormData) {
  const templateId = parseId(formData, "templateId");
  const versionId = parseId(formData, "versionId");

  if (!templateId.success || !versionId.success) {
    redirect("/dashboard/tests");
  }

  const path = getBuilderPath(templateId.data, versionId.data);
  const context = await requireCompanyContext();

  if (!canManageTests(context.activeCompany.role)) {
    redirectWithFeedback(path, "error", "У вашей роли нет права редактировать конструктор.");
  }

  const supabase = await createClient();
  const { data: template } = await supabase
    .from("test_templates")
    .select("id")
    .eq("id", templateId.data)
    .eq("company_id", context.activeCompany.id)
    .eq("is_system", false)
    .eq("status", "active")
    .maybeSingle();

  if (!template) {
    redirectWithFeedback(path, "error", "Конструктор доступен только для активного теста компании.");
  }

  const { data: version } = await supabase
    .from("test_versions")
    .select("id")
    .eq("id", versionId.data)
    .eq("test_template_id", templateId.data)
    .eq("status", "draft")
    .maybeSingle();

  if (!version) {
    redirectWithFeedback(path, "error", "Редактировать можно только черновую версию.");
  }

  return { path, supabase, templateId: templateId.data, versionId: versionId.data };
}

async function requireSection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sectionId: string,
  versionId: string,
  path: string,
) {
  const { data } = await supabase
    .from("test_sections")
    .select("id")
    .eq("id", sectionId)
    .eq("test_version_id", versionId)
    .maybeSingle();

  if (!data) {
    redirectWithFeedback(path, "error", "Секция не найдена в выбранной версии.");
  }
}

async function requireQuestion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  questionId: string,
  sectionId: string,
  path: string,
) {
  const { data } = await supabase
    .from("questions")
    .select("id")
    .eq("id", questionId)
    .eq("section_id", sectionId)
    .maybeSingle();

  if (!data) {
    redirectWithFeedback(path, "error", "Вопрос не найден в выбранной секции.");
  }
}

function questionPayload(question: z.infer<typeof questionSchema>) {
  return {
    competency_key: question.questionType === "forced_choice" ? null : question.competencyKey,
    description: sanitizeRichTextValue(question.description),
    difficulty: question.difficulty,
    order_index: question.orderIndex,
    points: question.questionType === "forced_choice" ? 0 : question.points,
    question_type: question.questionType,
    settings_json:
      question.questionType === "scale"
        ? { max: question.scaleMax ?? 5, min: question.scaleMin ?? 1 }
        : question.questionType === "forced_choice"
          ? { mode: "most_least" }
          : {},
    text: question.text,
  };
}

function optionPayload(option: z.infer<typeof optionSchema>) {
  return {
    competency_effect_json:
      option.effectCompetencyKey && option.effectValue !== null
        ? { [option.effectCompetencyKey]: option.effectValue }
        : {},
    explanation: option.explanation,
    is_correct: option.isCorrect,
    order_index: option.orderIndex,
    points: option.points,
    text: option.text,
  };
}

async function getDocumentContext(templateId: string, versionId: string) {
  const context = await requireCompanyContext();
  if (!canManageTests(context.activeCompany.role)) {
    return null;
  }

  const supabase = await createClient();
  const { data: version } = await supabase
    .from("test_versions")
    .select("id, version_number, settings_json, test_templates!inner(id, company_id, is_system, status)")
    .eq("id", versionId)
    .eq("test_template_id", templateId)
    .eq("status", "draft")
    .eq("test_templates.company_id", context.activeCompany.id)
    .eq("test_templates.is_system", false)
    .eq("test_templates.status", "active")
    .maybeSingle();

  return version
    ? { settingsJson: version.settings_json, supabase, versionNumber: version.version_number }
    : null;
}

export async function saveBuilderDocumentAction(input: unknown): Promise<BuilderSaveResult> {
  const parsed = builderDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Проверьте заполнение конструктора.", ok: false };
  }

  const document = {
    ...parsed.data,
    sections: parsed.data.sections.map((section) => ({
      ...section,
      contentBlocks: section.contentBlocks.map((block) => ({
        ...block,
        description: sanitizeRichTextValue(block.description),
      })),
      description: sanitizeRichTextValue(section.description),
      questions: section.questions.map((question) => ({
        ...question,
        description: sanitizeRichTextValue(question.description),
      })),
    })),
    version: {
      ...parsed.data.version,
      description: sanitizeRichTextValue(parsed.data.version.description),
      instructions: sanitizeRichTextValue(parsed.data.version.instructions),
    },
  };
  const remediationError = validateRemediationLinks(document.sections);
  if (remediationError) {
    return { error: remediationError, ok: false };
  }
  const context = await getDocumentContext(document.templateId, document.versionId);
  if (!context) {
    return { error: "Редактировать можно только активную черновую версию.", ok: false };
  }

  const { supabase } = context;
  const { data: currentSections, error: currentError } = await supabase
    .from("test_sections")
    .select("id, settings_json, questions(id, answer_options(id))")
    .eq("test_version_id", document.versionId);

  if (currentError) {
    return { error: "Не удалось проверить текущее содержимое.", ok: false };
  }

  const nextSectionIds = new Set(document.sections.map((section) => section.id));
  const nextQuestionIds = new Set(
    document.sections.flatMap((section) => section.questions.map((question) => question.id)),
  );
  const nextOptionIds = new Set(
    document.sections.flatMap((section) =>
      section.questions.flatMap((question) => question.options.map((option) => option.id)),
    ),
  );

  type StoredSection = {
    id: string;
    questions?: Array<{ answer_options?: Array<{ id: string }> | null; id: string }> | null;
    settings_json: unknown;
  };
  const storedSections = (currentSections ?? []) as unknown as StoredSection[];
  const storedSettingsBySectionId = new Map(
    storedSections.map((section) => [section.id, section.settings_json]),
  );
  const removedOptionIds = storedSections.flatMap((section) =>
    (section.questions ?? []).flatMap((question) =>
      (question.answer_options ?? [])
        .filter((option) => !nextOptionIds.has(option.id))
        .map((option) => option.id),
    ),
  );
  const removedQuestionIds = storedSections.flatMap((section) =>
    (section.questions ?? [])
      .filter((question) => !nextQuestionIds.has(question.id))
      .map((question) => question.id),
  );
  const removedSectionIds = storedSections
    .filter((section) => !nextSectionIds.has(section.id))
    .map((section) => section.id);

  if (removedOptionIds.length > 0) {
    const { error } = await supabase.from("answer_options").delete().in("id", removedOptionIds);
    if (error) return { error: "Не удалось удалить варианты ответа.", ok: false };
  }
  if (removedQuestionIds.length > 0) {
    const { error } = await supabase.from("questions").delete().in("id", removedQuestionIds);
    if (error) return { error: "Не удалось удалить вопросы.", ok: false };
  }
  if (removedSectionIds.length > 0) {
    const { error } = await supabase.from("test_sections").delete().in("id", removedSectionIds);
    if (error) return { error: "Не удалось удалить секции.", ok: false };
  }

  const { error: versionError } = await supabase
    .from("test_versions")
    .update({
      description: document.version.description,
      duration_minutes: document.version.durationMinutes,
      instructions: document.version.instructions,
      scoring_type: document.version.scoringType,
      settings_json: mergePresentationSettings(
        context.settingsJson,
        document.version.presentationSettings,
      ),
      title: formatTestVersionTitle(context.versionNumber),
    })
    .eq("id", document.versionId)
    .eq("status", "draft");
  if (versionError) {
    return { error: "Не удалось сохранить параметры версии.", ok: false };
  }

  if (document.sections.length > 0) {
    const { error } = await supabase.from("test_sections").upsert(
      document.sections.map((section, orderIndex) => ({
        description: section.description,
        id: section.id,
        order_index: orderIndex + 1,
        settings_json: withTestContentBlocks(
          storedSettingsBySectionId.get(section.id),
          section.contentBlocks,
        ),
        test_version_id: document.versionId,
        time_limit_minutes: section.timeLimitMinutes,
        title: section.title,
      })),
    );
    if (error) return { error: "Не удалось сохранить секции.", ok: false };
  }

  const questions = document.sections.flatMap((section) =>
    section.questions.map((question, orderIndex) => ({
      competency_key: question.questionType === "forced_choice" ? null : question.competencyKey,
      description: question.description,
      difficulty: question.difficulty,
      id: question.id,
      order_index: orderIndex + 1,
      points: question.questionType === "forced_choice" ? 0 : question.points,
      question_type: question.questionType,
      section_id: section.id,
      settings_json: {
        ...(question.questionType === "scale"
          ? { max: question.scaleMax, min: question.scaleMin }
          : {}),
        ...(question.questionType === "forced_choice" ? { mode: "most_least" } : {}),
        ...(question.isStructured && question.questionType === "ordering"
          ? {
              orderingScoringMode: question.orderingScoringMode,
              structuredResponseVersion: STRUCTURED_RESPONSE_VERSION,
            }
          : {}),
        ...(question.isStructured && question.questionType === "matching"
          ? {
              matchingScoringMode: question.matchingScoringMode,
              structuredResponseVersion: STRUCTURED_RESPONSE_VERSION,
            }
          : {}),
        ...(question.remediationQuestionId
          ? {
              incorrectFeedback: question.incorrectFeedback?.trim(),
              remediationQuestionId: question.remediationQuestionId,
            }
          : {}),
        required: question.isRequired,
      },
      text: question.text,
    })),
  );
  if (questions.length > 0) {
    const { error } = await supabase.from("questions").upsert(questions);
    if (error) return { error: "Не удалось сохранить вопросы.", ok: false };
  }

  const options = document.sections.flatMap((section) =>
    section.questions.flatMap((question) =>
      question.options.map((option, orderIndex) => ({
        competency_effect_json:
          question.isStructured &&
          (question.questionType === "ordering" || question.questionType === "matching")
            ? {}
            : option.competencyEffects,
        explanation:
          question.isStructured &&
          (question.questionType === "ordering" || question.questionType === "matching")
            ? null
            : option.explanation,
        id: option.id,
        is_correct:
          question.questionType === "forced_choice" ||
          (question.isStructured &&
            (question.questionType === "ordering" || question.questionType === "matching"))
            ? null
            : option.isCorrect,
        match_text:
          question.isStructured && question.questionType === "matching" ? option.matchText : null,
        order_index: orderIndex + 1,
        points:
          question.questionType === "forced_choice" ||
          (question.isStructured &&
            (question.questionType === "ordering" || question.questionType === "matching"))
            ? 0
            : option.points,
        question_id: question.id,
        text: option.text,
      })),
    ),
  );
  if (options.length > 0) {
    const { error } = await supabase.from("answer_options").upsert(options);
    if (error) return { error: "Не удалось сохранить варианты ответа.", ok: false };
  }

  revalidatePath(getBuilderPath(document.templateId, document.versionId).split("?")[0]);
  revalidatePath(`/dashboard/tests/${document.templateId}`);
  return { ok: true, savedAt: new Date().toISOString() };
}

export async function createSectionAction(formData: FormData) {
  const action = await getActionContext(formData);
  const section = parseSection(formData);

  if (!section.success) {
    redirectWithFeedback(action.path, "error", section.error.issues[0].message);
  }

  const { error } = await action.supabase.from("test_sections").insert({
    description: sanitizeRichTextValue(section.data.description),
    order_index: section.data.orderIndex,
    test_version_id: action.versionId,
    time_limit_minutes: section.data.timeLimitMinutes,
    title: section.data.title,
  });

  if (error) {
    redirectWithFeedback(action.path, "error", "Не удалось создать секцию.");
  }

  revalidatePath(action.path.split("?")[0]);
  redirectWithFeedback(action.path, "message", "Секция создана.");
}

export async function updateSectionAction(formData: FormData) {
  const action = await getActionContext(formData);
  const sectionId = parseId(formData, "sectionId");
  const section = parseSection(formData);

  if (!sectionId.success) {
    redirectWithFeedback(action.path, "error", "Некорректная секция.");
  }

  if (!section.success) {
    redirectWithFeedback(action.path, "error", section.error.issues[0].message);
  }

  await requireSection(action.supabase, sectionId.data, action.versionId, action.path);
  const { error } = await action.supabase
    .from("test_sections")
    .update({
      description: sanitizeRichTextValue(section.data.description),
      order_index: section.data.orderIndex,
      time_limit_minutes: section.data.timeLimitMinutes,
      title: section.data.title,
    })
    .eq("id", sectionId.data)
    .eq("test_version_id", action.versionId);

  if (error) {
    redirectWithFeedback(action.path, "error", "Не удалось обновить секцию.");
  }

  revalidatePath(action.path.split("?")[0]);
  redirectWithFeedback(action.path, "message", "Секция обновлена.");
}

export async function deleteSectionAction(formData: FormData) {
  const action = await getActionContext(formData);
  const sectionId = parseId(formData, "sectionId");

  if (!sectionId.success) {
    redirectWithFeedback(action.path, "error", "Некорректная секция.");
  }

  await requireSection(action.supabase, sectionId.data, action.versionId, action.path);
  const { error } = await action.supabase
    .from("test_sections")
    .delete()
    .eq("id", sectionId.data)
    .eq("test_version_id", action.versionId);

  if (error) {
    redirectWithFeedback(action.path, "error", "Не удалось удалить секцию.");
  }

  revalidatePath(action.path.split("?")[0]);
  redirectWithFeedback(action.path, "message", "Секция удалена вместе с ее вопросами.");
}

export async function createQuestionAction(formData: FormData) {
  const action = await getActionContext(formData);
  const sectionId = parseId(formData, "sectionId");
  const question = parseQuestion(formData);

  if (!sectionId.success) {
    redirectWithFeedback(action.path, "error", "Некорректная секция.");
  }

  if (!question.success) {
    redirectWithFeedback(action.path, "error", question.error.issues[0].message);
  }

  await requireSection(action.supabase, sectionId.data, action.versionId, action.path);
  const { error } = await action.supabase.from("questions").insert({
    ...questionPayload(question.data),
    section_id: sectionId.data,
  });

  if (error) {
    redirectWithFeedback(action.path, "error", "Не удалось создать вопрос.");
  }

  revalidatePath(action.path.split("?")[0]);
  redirectWithFeedback(action.path, "message", "Вопрос добавлен.");
}

export async function updateQuestionAction(formData: FormData) {
  const action = await getActionContext(formData);
  const sectionId = parseId(formData, "sectionId");
  const questionId = parseId(formData, "questionId");
  const question = parseQuestion(formData);

  if (!sectionId.success || !questionId.success) {
    redirectWithFeedback(action.path, "error", "Некорректный вопрос.");
  }

  if (!question.success) {
    redirectWithFeedback(action.path, "error", question.error.issues[0].message);
  }

  await requireSection(action.supabase, sectionId.data, action.versionId, action.path);
  await requireQuestion(action.supabase, questionId.data, sectionId.data, action.path);
  const { error } = await action.supabase
    .from("questions")
    .update(questionPayload(question.data))
    .eq("id", questionId.data)
    .eq("section_id", sectionId.data);

  if (error) {
    redirectWithFeedback(action.path, "error", "Не удалось обновить вопрос.");
  }

  revalidatePath(action.path.split("?")[0]);
  redirectWithFeedback(action.path, "message", "Вопрос обновлен.");
}

export async function deleteQuestionAction(formData: FormData) {
  const action = await getActionContext(formData);
  const sectionId = parseId(formData, "sectionId");
  const questionId = parseId(formData, "questionId");

  if (!sectionId.success || !questionId.success) {
    redirectWithFeedback(action.path, "error", "Некорректный вопрос.");
  }

  await requireSection(action.supabase, sectionId.data, action.versionId, action.path);
  await requireQuestion(action.supabase, questionId.data, sectionId.data, action.path);
  const { error } = await action.supabase
    .from("questions")
    .delete()
    .eq("id", questionId.data)
    .eq("section_id", sectionId.data);

  if (error) {
    redirectWithFeedback(action.path, "error", "Не удалось удалить вопрос.");
  }

  revalidatePath(action.path.split("?")[0]);
  redirectWithFeedback(action.path, "message", "Вопрос удален.");
}

export async function createAnswerOptionAction(formData: FormData) {
  const action = await getActionContext(formData);
  const sectionId = parseId(formData, "sectionId");
  const questionId = parseId(formData, "questionId");
  const option = parseOption(formData);

  if (!sectionId.success || !questionId.success) {
    redirectWithFeedback(action.path, "error", "Некорректный вопрос.");
  }

  if (!option.success) {
    redirectWithFeedback(action.path, "error", option.error.issues[0].message);
  }

  await requireSection(action.supabase, sectionId.data, action.versionId, action.path);
  await requireQuestion(action.supabase, questionId.data, sectionId.data, action.path);
  const { error } = await action.supabase.from("answer_options").insert({
    ...optionPayload(option.data),
    question_id: questionId.data,
  });

  if (error) {
    redirectWithFeedback(action.path, "error", "Не удалось добавить вариант ответа.");
  }

  revalidatePath(action.path.split("?")[0]);
  redirectWithFeedback(action.path, "message", "Вариант ответа добавлен.");
}

export async function updateAnswerOptionAction(formData: FormData) {
  const action = await getActionContext(formData);
  const sectionId = parseId(formData, "sectionId");
  const questionId = parseId(formData, "questionId");
  const optionId = parseId(formData, "optionId");
  const option = parseOption(formData);

  if (!sectionId.success || !questionId.success || !optionId.success) {
    redirectWithFeedback(action.path, "error", "Некорректный вариант ответа.");
  }

  if (!option.success) {
    redirectWithFeedback(action.path, "error", option.error.issues[0].message);
  }

  await requireSection(action.supabase, sectionId.data, action.versionId, action.path);
  await requireQuestion(action.supabase, questionId.data, sectionId.data, action.path);
  const { error } = await action.supabase
    .from("answer_options")
    .update(optionPayload(option.data))
    .eq("id", optionId.data)
    .eq("question_id", questionId.data);

  if (error) {
    redirectWithFeedback(action.path, "error", "Не удалось обновить вариант ответа.");
  }

  revalidatePath(action.path.split("?")[0]);
  redirectWithFeedback(action.path, "message", "Вариант ответа обновлен.");
}

export async function deleteAnswerOptionAction(formData: FormData) {
  const action = await getActionContext(formData);
  const sectionId = parseId(formData, "sectionId");
  const questionId = parseId(formData, "questionId");
  const optionId = parseId(formData, "optionId");

  if (!sectionId.success || !questionId.success || !optionId.success) {
    redirectWithFeedback(action.path, "error", "Некорректный вариант ответа.");
  }

  await requireSection(action.supabase, sectionId.data, action.versionId, action.path);
  await requireQuestion(action.supabase, questionId.data, sectionId.data, action.path);
  const { error } = await action.supabase
    .from("answer_options")
    .delete()
    .eq("id", optionId.data)
    .eq("question_id", questionId.data);

  if (error) {
    redirectWithFeedback(action.path, "error", "Не удалось удалить вариант ответа.");
  }

  revalidatePath(action.path.split("?")[0]);
  redirectWithFeedback(action.path, "message", "Вариант ответа удален.");
}

export async function createDraftFromPublishedVersionAction(formData: FormData) {
  const templateId = parseId(formData, "templateId");
  const versionId = parseId(formData, "versionId");
  if (!templateId.success || !versionId.success) {
    redirect("/dashboard/tests");
  }

  const context = await requireCompanyContext();
  const previewPath = getBuilderPath(templateId.data, versionId.data);
  if (!canManageTests(context.activeCompany.role)) {
    redirectWithFeedback(previewPath, "error", "У вашей роли нет права создавать новую версию.");
  }

  const supabase = await createClient();
  const { data: template } = await supabase
    .from("test_templates")
    .select("id")
    .eq("id", templateId.data)
    .eq("company_id", context.activeCompany.id)
    .eq("is_system", false)
    .eq("status", "active")
    .maybeSingle();
  if (!template) {
    redirectWithFeedback(previewPath, "error", "Новая версия доступна только для активного теста компании.");
  }

  const { data: existingDraft } = await supabase
    .from("test_versions")
    .select("id")
    .eq("test_template_id", templateId.data)
    .eq("status", "draft")
    .limit(1)
    .maybeSingle();
  if (existingDraft) {
    redirectWithFeedback(
      getBuilderPath(templateId.data, existingDraft.id),
      "message",
      "Открыт уже существующий черновик.",
    );
  }

  const [{ data: source }, { data: latest }] = await Promise.all([
    supabase
      .from("test_versions")
      .select("description, instructions, duration_minutes, scoring_type, settings_json")
      .eq("id", versionId.data)
      .eq("test_template_id", templateId.data)
      .eq("status", "published")
      .maybeSingle(),
    supabase
      .from("test_versions")
      .select("version_number")
      .eq("test_template_id", templateId.data)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!source) {
    redirectWithFeedback(previewPath, "error", "Копировать для редактирования можно только опубликованную версию.");
  }

  const nextVersionNumber = (latest?.version_number ?? 0) + 1;
  const { data: draft, error: draftError } = await supabase
    .from("test_versions")
    .insert({
      description: source.description,
      duration_minutes: source.duration_minutes,
      instructions: source.instructions,
      scoring_type: source.scoring_type,
      settings_json: source.settings_json,
      status: "draft",
      test_template_id: templateId.data,
      title: formatTestVersionTitle(nextVersionNumber),
      version_number: nextVersionNumber,
    })
    .select("id")
    .single();
  if (draftError || !draft) {
    redirectWithFeedback(previewPath, "error", "Не удалось создать черновую версию.");
  }

  const { data: sourceSections, error: contentError } = await supabase
    .from("test_sections")
    .select(
      "title, description, order_index, time_limit_minutes, settings_json, questions(question_type, text, description, media_url, order_index, points, competency_key, difficulty, settings_json, answer_options(text, match_text, order_index, is_correct, points, competency_effect_json, explanation))",
    )
    .eq("test_version_id", versionId.data)
    .order("order_index");
  if (contentError) {
    redirectWithFeedback(getBuilderPath(templateId.data, draft.id), "error", "Черновик создан, но содержание не удалось скопировать.");
  }

  type CloneSection = {
    description: string | null;
    order_index: number;
    questions?: Array<{
      answer_options?: Array<{
        competency_effect_json: Record<string, number>;
        explanation: string | null;
        is_correct: boolean | null;
        match_text: string | null;
        order_index: number;
        points: number;
        text: string;
      }> | null;
      competency_key: string | null;
      description: string | null;
      difficulty: string | null;
      media_url: string | null;
      order_index: number;
      points: number;
      question_type: string;
      settings_json: Record<string, unknown>;
      text: string;
    }> | null;
    settings_json: Record<string, unknown>;
    time_limit_minutes: number | null;
    title: string;
  };

  for (const section of (sourceSections ?? []) as unknown as CloneSection[]) {
    const { data: copiedSection } = await supabase
      .from("test_sections")
      .insert({
        description: section.description,
        order_index: section.order_index,
        settings_json: section.settings_json,
        test_version_id: draft.id,
        time_limit_minutes: section.time_limit_minutes,
        title: section.title,
      })
      .select("id")
      .single();
    if (!copiedSection) continue;

    for (const question of section.questions ?? []) {
      const { data: copiedQuestion } = await supabase
        .from("questions")
        .insert({
          competency_key: question.competency_key,
          description: question.description,
          difficulty: question.difficulty,
          media_url: question.media_url,
          order_index: question.order_index,
          points: question.points,
          question_type: question.question_type,
          section_id: copiedSection.id,
          settings_json: question.settings_json,
          text: question.text,
        })
        .select("id")
        .single();
      if (!copiedQuestion || !question.answer_options?.length) continue;
      await supabase.from("answer_options").insert(
        question.answer_options.map((option) => ({
          competency_effect_json: option.competency_effect_json,
          explanation: option.explanation,
          is_correct: option.is_correct,
          match_text: option.match_text,
          order_index: option.order_index,
          points: option.points,
          question_id: copiedQuestion.id,
          text: option.text,
        })),
      );
    }
  }

  revalidatePath(`/dashboard/tests/${templateId.data}`);
  redirectWithFeedback(
    getBuilderPath(templateId.data, draft.id),
    "message",
    "Создан новый черновик на основе опубликованной версии.",
  );
}
