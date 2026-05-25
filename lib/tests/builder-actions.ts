"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireCompanyContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

import {
  DIFFICULTY_VALUES,
  QUESTION_TYPE_VALUES,
  TEST_COMPETENCIES,
  type TestCompetencyKey,
} from "./builder-constants";
import { canManageTests } from "./constants";

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
  description: optionalText(1000),
  orderIndex: nonnegativeOrder,
  timeLimitMinutes: optionalPositiveInteger,
  title: z.string().trim().min(2, "Укажите название секции.").max(180, "Название слишком длинное."),
});

const questionSchema = z
  .object({
    competencyKey: optionalCompetency,
    description: optionalText(2000),
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
    competency_key: question.competencyKey,
    description: question.description,
    difficulty: question.difficulty,
    order_index: question.orderIndex,
    points: question.points,
    question_type: question.questionType,
    settings_json:
      question.questionType === "scale"
        ? { max: question.scaleMax ?? 5, min: question.scaleMin ?? 1 }
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

export async function createSectionAction(formData: FormData) {
  const action = await getActionContext(formData);
  const section = parseSection(formData);

  if (!section.success) {
    redirectWithFeedback(action.path, "error", section.error.issues[0].message);
  }

  const { error } = await action.supabase.from("test_sections").insert({
    description: section.data.description,
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
      description: section.data.description,
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
