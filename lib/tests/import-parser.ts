import "server-only";

import { z } from "zod";

import { sanitizeRichTextValue } from "@/lib/rich-text.server";
import { validateForcedChoiceDefinition } from "@/lib/forced-choice";
import {
  DIFFICULTY_VALUES,
  TEST_COMPETENCIES,
  type TestCompetencyKey,
} from "@/lib/tests/builder-constants";
import { SCORING_TYPE_VALUES } from "@/lib/tests/constants";
import { getAllowedImportScoringTypes } from "@/lib/tests/import-scoring";
import type { TalviaTestImportSummary } from "@/lib/tests/import-types";

export const TALVIA_TEST_IMPORT_MAX_FILE_SIZE = 750 * 1024;
export const TALVIA_TEST_IMPORT_MAX_SECTIONS = 100;
export const TALVIA_TEST_IMPORT_MAX_QUESTIONS = 300;
export const TALVIA_TEST_IMPORT_MAX_OPTIONS = 3000;

const LOCAL_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const CATEGORY_PATTERN = /^[a-z][a-z0-9_]*$/;
const competencyKeys = TEST_COMPETENCIES.map((competency) => competency.key) as [
  TestCompetencyKey,
  ...TestCompetencyKey[],
];

class JsonDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonDocumentError";
  }
}

function objectPath(parent: string, key: string) {
  return LOCAL_KEY_PATTERN.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

class StrictJsonParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse() {
    this.skipWhitespace();
    const value = this.parseValue("$", 0);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new JsonDocumentError(`$ содержит лишние данные после завершения JSON.`);
    }
    return value;
  }

  private parseValue(path: string, depth: number): unknown {
    if (depth > 64) {
      throw new JsonDocumentError(`${path}: превышена допустимая глубина JSON.`);
    }

    this.skipWhitespace();
    const character = this.source[this.index];
    if (character === "{") return this.parseObject(path, depth + 1);
    if (character === "[") return this.parseArray(path, depth + 1);
    if (character === '"') return this.parseString(path);
    if (character === "t") return this.parseLiteral("true", true, path);
    if (character === "f") return this.parseLiteral("false", false, path);
    if (character === "n") return this.parseLiteral("null", null, path);
    if (character === "-" || (character >= "0" && character <= "9")) {
      return this.parseNumber(path);
    }

    throw new JsonDocumentError(`${path}: ожидалось значение JSON.`);
  }

  private parseObject(path: string, depth: number) {
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    this.index += 1;
    this.skipWhitespace();

    if (this.source[this.index] === "}") {
      this.index += 1;
      return result;
    }

    while (this.index < this.source.length) {
      if (this.source[this.index] !== '"') {
        throw new JsonDocumentError(`${path}: имя свойства должно быть строкой.`);
      }
      const key = this.parseString(path);
      const childPath = objectPath(path, key);
      if (keys.has(key)) {
        throw new JsonDocumentError(`${childPath}: имя свойства повторяется в одном объекте.`);
      }
      keys.add(key);

      this.skipWhitespace();
      if (this.source[this.index] !== ":") {
        throw new JsonDocumentError(`${childPath}: после имени свойства ожидалось двоеточие.`);
      }
      this.index += 1;
      result[key] = this.parseValue(childPath, depth);
      this.skipWhitespace();

      if (this.source[this.index] === "}") {
        this.index += 1;
        return result;
      }
      if (this.source[this.index] !== ",") {
        throw new JsonDocumentError(`${path}: ожидалась запятая или закрывающая скобка.`);
      }
      this.index += 1;
      this.skipWhitespace();
    }

    throw new JsonDocumentError(`${path}: объект JSON не завершен.`);
  }

  private parseArray(path: string, depth: number) {
    const result: unknown[] = [];
    this.index += 1;
    this.skipWhitespace();

    if (this.source[this.index] === "]") {
      this.index += 1;
      return result;
    }

    while (this.index < this.source.length) {
      result.push(this.parseValue(`${path}[${result.length}]`, depth));
      this.skipWhitespace();
      if (this.source[this.index] === "]") {
        this.index += 1;
        return result;
      }
      if (this.source[this.index] !== ",") {
        throw new JsonDocumentError(`${path}: ожидалась запятая или закрывающая скобка.`);
      }
      this.index += 1;
      this.skipWhitespace();
    }

    throw new JsonDocumentError(`${path}: массив JSON не завершен.`);
  }

  private parseString(path: string) {
    const start = this.index;
    this.index += 1;

    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character === '"') {
        this.index += 1;
        try {
          const value = JSON.parse(this.source.slice(start, this.index)) as string;
          if (value.includes("\u0000")) {
            throw new JsonDocumentError(`${path}: нулевой символ не поддерживается.`);
          }
          for (let valueIndex = 0; valueIndex < value.length; valueIndex += 1) {
            const code = value.charCodeAt(valueIndex);
            if (code >= 0xd800 && code <= 0xdbff) {
              const nextCode = value.charCodeAt(valueIndex + 1);
              if (!(nextCode >= 0xdc00 && nextCode <= 0xdfff)) {
                throw new JsonDocumentError(`${path}: некорректная Unicode-последовательность.`);
              }
              valueIndex += 1;
            } else if (code >= 0xdc00 && code <= 0xdfff) {
              throw new JsonDocumentError(`${path}: некорректная Unicode-последовательность.`);
            }
          }
          return value;
        } catch (error) {
          if (error instanceof JsonDocumentError) throw error;
          throw new JsonDocumentError(`${path}: строка JSON содержит недопустимую escape-последовательность.`);
        }
      }
      if (character === "\\") {
        this.index += 2;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) {
        throw new JsonDocumentError(`${path}: строка JSON содержит управляющий символ.`);
      }
      this.index += 1;
    }

    throw new JsonDocumentError(`${path}: строка JSON не завершена.`);
  }

  private parseNumber(path: string) {
    const fragment = this.source.slice(this.index);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(fragment);
    if (!match) {
      throw new JsonDocumentError(`${path}: некорректное число JSON.`);
    }

    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      throw new JsonDocumentError(`${path}: число выходит за допустимый диапазон.`);
    }
    return value;
  }

  private parseLiteral<T>(literal: string, value: T, path: string) {
    if (this.source.slice(this.index, this.index + literal.length) !== literal) {
      throw new JsonDocumentError(`${path}: некорректное значение JSON.`);
    }
    this.index += literal.length;
    return value;
  }

  private skipWhitespace() {
    while (
      this.source[this.index] === " " ||
      this.source[this.index] === "\t" ||
      this.source[this.index] === "\r" ||
      this.source[this.index] === "\n"
    ) {
      this.index += 1;
    }
  }
}

const trimmedText = (minimum: number, maximum: number, message: string) =>
  z
    .string()
    .transform((value) => value.trim())
    .pipe(z.string().min(minimum, message).max(maximum, "Значение слишком длинное."));

const optionalTrimmedText = (maximum: number) =>
  z
    .union([z.string(), z.null()])
    .transform((value) => (typeof value === "string" ? value.trim() || null : null))
    .pipe(z.string().min(1).max(maximum, "Значение слишком длинное.").nullable());

const localKeySchema = z
  .string()
  .min(1)
  .max(64, "Локальный key слишком длинный.")
  .regex(LOCAL_KEY_PATTERN, "Используйте строчные латинские буквы, цифры и знак подчеркивания.");

function hasAtMostTwoDecimalPlaces(value: number) {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

const pointsSchema = z
  .number()
  .min(0, "Баллы не могут быть отрицательными.")
  .max(10000, "Слишком большое число баллов.")
  .refine(hasAtMostTwoDecimalPlaces, "Допускается не более двух знаков после запятой.");

const effectValueSchema = z
  .number()
  .positive("Эффект компетенции должен быть больше нуля.")
  .max(10000, "Слишком большое значение эффекта.")
  .refine(hasAtMostTwoDecimalPlaces, "Допускается не более двух знаков после запятой.");

const competencyEffectsSchema = z
  .record(z.string(), effectValueSchema)
  .superRefine((effects, context) => {
    const keys = Object.keys(effects);
    keys.forEach((key) => {
      if (!competencyKeys.includes(key as TestCompetencyKey)) {
        context.addIssue({
          code: "custom",
          message: "Неизвестный ключ компетенции.",
          path: [key],
        });
      }
    });
  });

const singleChoiceCompetencyEffectsSchema = competencyEffectsSchema.refine(
  (effects) => Object.keys(effects).length <= 1,
  "У варианта допускается эффект только одной компетенции.",
);

const questionCommonShape = {
  competency_key: z.enum(competencyKeys).nullable(),
  description: optionalTrimmedText(20000),
  difficulty: z.enum(DIFFICULTY_VALUES).nullable(),
  key: localKeySchema,
  required: z.boolean(),
  text: trimmedText(2, 4000, "Текст вопроса должен содержать минимум два символа."),
};

const answerOptionSchema = z
  .object({
    competency_effects: singleChoiceCompetencyEffectsSchema,
    explanation: optionalTrimmedText(1000),
    is_correct: z.boolean(),
    key: localKeySchema,
    points: pointsSchema,
    text: trimmedText(1, 1000, "Текст варианта ответа не может быть пустым."),
  })
  .strict();

const singleChoiceQuestionSchema = z
  .object({
    ...questionCommonShape,
    options: z.array(answerOptionSchema).min(2, "Нужно минимум два варианта ответа.").max(100),
    type: z.literal("single_choice"),
  })
  .strict()
  .superRefine((question, context) => {
    const correctOptions = question.options.filter((option) => option.is_correct);
    if (correctOptions.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Должен быть ровно один правильный вариант.",
        path: ["options"],
      });
      return;
    }

    const correctOption = correctOptions[0];
    if (correctOption.points <= 0) {
      context.addIssue({
        code: "custom",
        message: "Правильный вариант должен давать больше нуля баллов.",
        path: ["options", question.options.indexOf(correctOption), "points"],
      });
    }
    const sameOrHigherIncorrectOption = question.options.find(
      (option) => !option.is_correct && option.points >= correctOption.points,
    );
    if (sameOrHigherIncorrectOption) {
      context.addIssue({
        code: "custom",
        message: "Правильный вариант должен быть единственным вариантом с максимальным баллом.",
        path: ["options", question.options.indexOf(sameOrHigherIncorrectOption), "points"],
      });
    }

    const hasEffects = question.options.some(
      (option) => Object.keys(option.competency_effects).length > 0,
    );
    if (question.competency_key && hasEffects) {
      context.addIssue({
        code: "custom",
        message: "competency_key вопроса нельзя смешивать с competency_effects вариантов.",
        path: ["competency_key"],
      });
    }
    if (!question.competency_key && !hasEffects) {
      context.addIssue({
        code: "custom",
        message: "Укажите competency_key вопроса или эффект хотя бы у одного варианта.",
        path: ["competency_key"],
      });
    }
  });

const forcedChoiceModeSchema = z
  .object({ mode: z.unknown().optional() })
  .strict()
  .superRefine((settings, context) => {
    if (settings.mode === undefined) {
      context.addIssue({
        code: "custom",
        message: "Для Forced Choice укажите mode = most_least.",
        path: ["mode"],
      });
    } else if (settings.mode !== "most_least") {
      context.addIssue({
        code: "custom",
        message: "Поддерживается только Forced Choice mode = most_least.",
        path: ["mode"],
      });
    }
  })
  .transform(() => ({ mode: "most_least" as const }));

const forcedChoiceOptionSchema = z
  .object({
    competency_effects: competencyEffectsSchema.refine(
      (effects) => Object.keys(effects).length > 0,
      "Для каждого утверждения укажите competency_effects.",
    ),
    explanation: optionalTrimmedText(1000).optional().default(null),
    key: localKeySchema,
    text: trimmedText(1, 1000, "Текст утверждения не может быть пустым."),
  })
  .strict();

const forcedChoiceQuestionSchema = z
  .object({
    competency_key: z.null().optional().default(null),
    description: optionalTrimmedText(20000).optional().default(null),
    difficulty: z.enum(DIFFICULTY_VALUES).nullable(),
    forced_choice: forcedChoiceModeSchema,
    key: localKeySchema,
    options: z
      .array(forcedChoiceOptionSchema)
      .min(3, "Для Forced Choice нужно минимум три утверждения.")
      .max(100),
    required: z.boolean(),
    text: trimmedText(2, 4000, "Текст вопроса должен содержать минимум два символа."),
    type: z.literal("forced_choice"),
  })
  .strict()
  .superRefine((question, context) => {
    const validation = validateForcedChoiceDefinition({
      mode: question.forced_choice.mode,
      options: question.options.map((option) => ({
        competencyEffects: option.competency_effects,
      })),
    });
    if (!validation.ok) {
      context.addIssue({ code: "custom", message: validation.error });
    }
  });

const scaleQuestionSchema = z
  .object({
    ...questionCommonShape,
    competency_key: z.enum(competencyKeys),
    scale: z
      .object({
        max: z.number().int().min(2).max(100),
        min: z.number().int().min(1).max(99),
      })
      .strict()
      .refine((scale) => scale.min < scale.max, {
        message: "Минимум шкалы должен быть меньше максимума.",
        path: ["max"],
      }),
    type: z.literal("scale"),
  })
  .strict();

const openTextQuestionSchema = z
  .object({
    ...questionCommonShape,
    type: z.literal("open_text"),
  })
  .strict();

const questionSchema = z.discriminatedUnion("type", [
  singleChoiceQuestionSchema,
  scaleQuestionSchema,
  openTextQuestionSchema,
  forcedChoiceQuestionSchema,
]);

const sectionSchema = z
  .object({
    description: optionalTrimmedText(10000),
    key: localKeySchema,
    questions: z.array(questionSchema).min(1, "Секция должна содержать хотя бы один вопрос.").max(300),
    title: trimmedText(2, 180, "Название секции должно содержать минимум два символа."),
  })
  .strict();

const presentationSchema = z
  .object({
    allow_back: z.boolean(),
    capture_question_time: z.boolean(),
    mode: z.enum(["section", "one_question"]),
  })
  .strict();

export const talviaTestImportDocumentSchema = z
  .object({
    schema_version: z.literal("talvia.test.v1"),
    test: z
      .object({
        category: z.string().min(1).max(100).regex(CATEGORY_PATTERN, "Некорректный ключ категории."),
        description: optionalTrimmedText(2000),
        duration_minutes: z.number().int().min(1).max(1440),
        instructions: optionalTrimmedText(40000),
        presentation: presentationSchema,
        scoring_type: z.enum(SCORING_TYPE_VALUES),
        sections: z.array(sectionSchema).min(1).max(TALVIA_TEST_IMPORT_MAX_SECTIONS),
        title: trimmedText(2, 180, "Название теста должно содержать минимум два символа."),
      })
      .strict(),
  })
  .strict()
  .superRefine((document, context) => {
    const questions = document.test.sections.flatMap((section) => section.questions);
    const options = questions.flatMap((question) =>
      question.type === "single_choice" || question.type === "forced_choice"
        ? question.options
        : [],
    );

    if (questions.length > TALVIA_TEST_IMPORT_MAX_QUESTIONS) {
      context.addIssue({
        code: "custom",
        message: `Во всем тесте допускается не более ${TALVIA_TEST_IMPORT_MAX_QUESTIONS} вопросов.`,
        path: ["test", "sections"],
      });
    }
    if (options.length > TALVIA_TEST_IMPORT_MAX_OPTIONS) {
      context.addIssue({
        code: "custom",
        message: `Во всем тесте допускается не более ${TALVIA_TEST_IMPORT_MAX_OPTIONS} вариантов ответа.`,
        path: ["test", "sections"],
      });
    }

    const firstPathByKey = new Map<string, Array<string | number>>();
    const registerKey = (key: string, path: Array<string | number>) => {
      const firstPath = firstPathByKey.get(key);
      if (firstPath) {
        context.addIssue({
          code: "custom",
          message: `Локальный key уже использован в ${formatPath(firstPath)}.`,
          path,
        });
      } else {
        firstPathByKey.set(key, path);
      }
    };

    document.test.sections.forEach((section, sectionIndex) => {
      registerKey(section.key, ["test", "sections", sectionIndex, "key"]);
      section.questions.forEach((question, questionIndex) => {
        registerKey(question.key, [
          "test",
          "sections",
          sectionIndex,
          "questions",
          questionIndex,
          "key",
        ]);
        if (question.type === "single_choice" || question.type === "forced_choice") {
          question.options.forEach((option, optionIndex) => {
            registerKey(option.key, [
              "test",
              "sections",
              sectionIndex,
              "questions",
              questionIndex,
              "options",
              optionIndex,
              "key",
            ]);
          });
        }
      });
    });

    const allowedScoringTypes = getAllowedImportScoringTypes(
      questions.map((question) => question.type),
    );

    if (!allowedScoringTypes.includes(document.test.scoring_type)) {
      context.addIssue({
        code: "custom",
        message: `Для этого состава вопросов допустимо значение: ${allowedScoringTypes.join(" или ")}.`,
        path: ["test", "scoring_type"],
      });
    }
  });

export type TalviaTestImportDocument = z.infer<typeof talviaTestImportDocumentSchema>;

function formatPath(path: PropertyKey[]) {
  return path.reduce<string>((result, part) => {
    if (typeof part === "number") return `${result}[${part}]`;
    const key = String(part);
    return result ? objectPath(result, key) : key;
  }, "");
}

function formatValidationError(error: z.ZodError) {
  const issues = error.issues.slice(0, 5).map((issue) => {
    const path = formatPath(issue.path);
    return `${path || "$"}: ${issue.message}`;
  });
  const suffix = error.issues.length > issues.length ? ` Еще ошибок: ${error.issues.length - issues.length}.` : "";
  return `${issues.join(" • ")}${suffix}`;
}

export function parseTalviaTestImport(source: string): TalviaTestImportDocument {
  const withoutBom = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  let rawDocument: unknown;
  try {
    rawDocument = new StrictJsonParser(withoutBom).parse();
  } catch (error) {
    if (error instanceof JsonDocumentError) throw error;
    throw new JsonDocumentError("Не удалось прочитать JSON-документ.");
  }

  const result = talviaTestImportDocumentSchema.safeParse(rawDocument);
  if (!result.success) {
    throw new JsonDocumentError(formatValidationError(result.error));
  }

  return {
    ...result.data,
    test: {
      ...result.data.test,
      description: sanitizeRichTextValue(result.data.test.description),
      instructions: sanitizeRichTextValue(result.data.test.instructions),
      sections: result.data.test.sections.map((section) => ({
        ...section,
        description: sanitizeRichTextValue(section.description),
        questions: section.questions.map((question) => ({
          ...question,
          description: sanitizeRichTextValue(question.description),
        })),
      })),
    },
  };
}

export function summarizeTalviaTestImport(
  document: TalviaTestImportDocument,
): TalviaTestImportSummary {
  const questions = document.test.sections.flatMap((section) => section.questions);
  const competencyKeySet = new Set<string>();
  let optionCount = 0;

  questions.forEach((question) => {
    if (question.competency_key) competencyKeySet.add(question.competency_key);
    if (question.type === "single_choice" || question.type === "forced_choice") {
      optionCount += question.options.length;
      question.options.forEach((option) => {
        Object.keys(option.competency_effects).forEach((key) => competencyKeySet.add(key));
      });
    }
  });

  return {
    competencyKeys: [...competencyKeySet].sort(),
    durationMinutes: document.test.duration_minutes,
    forcedChoiceCount: questions.filter((question) => question.type === "forced_choice").length,
    openTextCount: questions.filter((question) => question.type === "open_text").length,
    optionCount,
    requiredQuestionCount: questions.filter((question) => question.required).length,
    scaleCount: questions.filter((question) => question.type === "scale").length,
    scoringType: document.test.scoring_type,
    sectionCount: document.test.sections.length,
    singleChoiceCount: questions.filter((question) => question.type === "single_choice").length,
    title: document.test.title,
    totalQuestionCount: questions.length,
  };
}

export function getTalviaTestImportWarnings(summary: TalviaTestImportSummary) {
  const warnings = [
    "Проверьте содержание, правильные ответы и объяснения: формат файла не подтверждает фактическую корректность методики.",
    "Убедитесь, что в формулировках и оценке нет чувствительных или дискриминационных критериев.",
  ];
  if (summary.openTextCount > 0) {
    warnings.push(
      "Открытые ответы требуют ручной проверки; пока такой тест не участвует в итоговом overall score.",
    );
  }
  if (summary.forcedChoiceCount > 0) {
    warnings.push(
      "Forced Choice использует MVP Best-Worst scoring (+1 / -1), а не нормативную IRT-модель.",
    );
  }
  if (summary.competencyKeys.some((key) => key.startsWith("motivation_"))) {
    warnings.push("Мотивационные компетенции сохраняются в профиле, но не влияют на fit score.");
  }
  return warnings;
}
