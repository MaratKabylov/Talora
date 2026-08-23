export const MULTIPLE_CHOICE_SCORING_VERSION = 1 as const;

export const MULTIPLE_CHOICE_SCORING_MODES = [
  "exact_match",
  "partial_credit",
  "option_points",
] as const;

export const MULTIPLE_CHOICE_PENALTY_MODES = ["none", "subtract"] as const;

export type MultipleChoiceScoringMode =
  (typeof MULTIPLE_CHOICE_SCORING_MODES)[number];
export type MultipleChoicePenaltyMode =
  (typeof MULTIPLE_CHOICE_PENALTY_MODES)[number];

export type MultipleChoiceQuestionSettings = {
  correctFeedback?: string | null;
  correctnessThreshold?: number;
  correctOptionPoints?: number;
  incorrectOptionPenalty?: number;
  maxSelections?: number;
  minPoints?: number;
  minSelections?: number;
  multipleChoiceScoringVersion?: number;
  penaltyMode?: MultipleChoicePenaltyMode;
  scoringMode?: MultipleChoiceScoringMode;
};

export type MultipleChoiceOption = {
  competencyEffects?: Record<string, number> | null;
  id: string;
  isCorrect: boolean | null;
  points: number;
};

export type NormalizedMultipleChoiceDefinition = {
  correctOptionPoints: number;
  correctnessThreshold: number | null;
  incorrectOptionPenalty: number;
  maxPoints: number;
  maxSelections: number;
  minPoints: number;
  minSelections: number;
  options: MultipleChoiceOption[];
  penaltyMode: MultipleChoicePenaltyMode;
  required: boolean;
  scoringMode: MultipleChoiceScoringMode;
  version: typeof MULTIPLE_CHOICE_SCORING_VERSION;
};

export type MultipleChoiceDefinitionValidationResult =
  | {
      definition: NormalizedMultipleChoiceDefinition;
      ok: true;
      warnings: string[];
    }
  | { errors: string[]; ok: false; warnings: string[] };

export type MultipleChoiceAnswer =
  | { selectedOptionIds: string[] }
  | { skipped: true };

export type MultipleChoiceAnswerValidationResult =
  | {
      answer: MultipleChoiceAnswer;
      canonicalizedDuplicates: boolean;
      ok: true;
    }
  | { error: string; ok: false };

export type MultipleChoiceScoreResult = {
  correctOptionIds: string[];
  isCorrect: boolean;
  maxPoints: number;
  missedCorrectOptionIds: string[];
  optionContributions: Array<{ optionId: string; points: number }>;
  pointsAwarded: number;
  rawScore: number;
  selectedCorrectOptionIds: string[];
  selectedIncorrectOptionIds: string[];
  selectedOptionIds: string[];
};

export type MultipleChoiceSelectionClassification = Pick<
  MultipleChoiceScoreResult,
  | "correctOptionIds"
  | "missedCorrectOptionIds"
  | "selectedCorrectOptionIds"
  | "selectedIncorrectOptionIds"
  | "selectedOptionIds"
>;

export type MultipleChoiceReportOption = MultipleChoiceOption & {
  orderIndex: number;
  text: string;
};

export type MultipleChoiceReportModel = {
  isCorrect: boolean | null;
  maxPoints: number;
  mode: MultipleChoiceScoringMode;
  missedCorrectOptions: Array<{ id: string; text: string }>;
  optionContributions: Array<{ optionId: string; points: number; text: string }>;
  pointsAwarded: number | null;
  rawScore: number | null;
  selectedIncorrectOptions: Array<{ id: string; text: string }>;
  selectedOptions: Array<{ id: string; text: string }>;
  status: "correct" | "incorrect" | "partial" | "unanswered";
};

export class MultipleChoiceAnswerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MultipleChoiceAnswerValidationError";
  }
}

export function isMultipleChoiceScoringMode(
  value: unknown,
): value is MultipleChoiceScoringMode {
  return MULTIPLE_CHOICE_SCORING_MODES.includes(
    value as MultipleChoiceScoringMode,
  );
}

export function isMultipleChoicePenaltyMode(
  value: unknown,
): value is MultipleChoicePenaltyMode {
  return MULTIPLE_CHOICE_PENALTY_MODES.includes(
    value as MultipleChoicePenaltyMode,
  );
}

export function isMultipleChoiceV1(
  settings: MultipleChoiceQuestionSettings | null | undefined,
) {
  return (
    settings?.multipleChoiceScoringVersion ===
    MULTIPLE_CHOICE_SCORING_VERSION
  );
}

export function roundMultipleChoiceScore(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function hasAtMostTwoDecimals(value: number) {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function createMultipleChoiceSettingsPreset(input: {
  optionCount: number;
  required: boolean;
}): MultipleChoiceQuestionSettings {
  return {
    correctOptionPoints: 1,
    correctnessThreshold: undefined,
    incorrectOptionPenalty: 0,
    maxSelections: Math.max(1, input.optionCount),
    minPoints: 0,
    minSelections: input.required ? 1 : 0,
    multipleChoiceScoringVersion: MULTIPLE_CHOICE_SCORING_VERSION,
    penaltyMode: "none",
    scoringMode: "exact_match",
  };
}

/**
 * Returns the smallest and largest raw totals reachable for the configured
 * selection limits. Picking the k smallest/largest weights is sufficient for
 * an extremum at each allowed selection count, so this stays cheap for 100 options.
 */
export function getMultipleChoiceOptionPointRange(input: {
  maxSelections: number;
  minSelections: number;
  optionPoints: readonly number[];
}) {
  const ascending = [...input.optionPoints].sort((left, right) => left - right);
  const descending = [...ascending].reverse();
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  for (
    let count = input.minSelections;
    count <= input.maxSelections;
    count += 1
  ) {
    const minimumForCount = ascending
      .slice(0, count)
      .reduce((sum, points) => sum + points, 0);
    const maximumForCount = descending
      .slice(0, count)
      .reduce((sum, points) => sum + points, 0);
    minimum = Math.min(minimum, minimumForCount);
    maximum = Math.max(maximum, maximumForCount);
  }

  return {
    maximum: roundMultipleChoiceScore(Number.isFinite(maximum) ? maximum : 0),
    minimum: roundMultipleChoiceScore(Number.isFinite(minimum) ? minimum : 0),
  };
}

export function validateMultipleChoiceDefinition(input: {
  competencyKey?: string | null;
  maxPoints: number;
  options: MultipleChoiceOption[];
  required: boolean;
  settings: MultipleChoiceQuestionSettings | null | undefined;
}): MultipleChoiceDefinitionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const settings = input.settings ?? {};
  const scoringMode = settings.scoringMode;
  const penaltyMode = settings.penaltyMode ?? "none";
  const minSelections = settings.minSelections;
  const maxSelections = settings.maxSelections;
  const minPoints = settings.minPoints ?? 0;
  const correctOptionPoints = settings.correctOptionPoints ?? 0;
  const incorrectOptionPenalty =
    penaltyMode === "none" ? 0 : (settings.incorrectOptionPenalty ?? 0);
  const correctnessThreshold = settings.correctnessThreshold ?? null;

  if (!isMultipleChoiceV1(settings)) {
    errors.push("Настройте multiple_choice scoring version 1.");
  }
  if (!isMultipleChoiceScoringMode(scoringMode)) {
    errors.push("Выберите поддерживаемый режим оценки multiple_choice.");
  }
  if (!isMultipleChoicePenaltyMode(penaltyMode)) {
    errors.push("Выберите поддерживаемый режим штрафа multiple_choice.");
  }
  if (
    !isFiniteNumber(input.maxPoints) ||
    input.maxPoints <= 0 ||
    !hasAtMostTwoDecimals(input.maxPoints)
  ) {
    errors.push("Максимальный балл multiple_choice должен быть больше нуля и иметь не более двух знаков после запятой.");
  }
  if (
    !isFiniteNumber(minPoints) ||
    minPoints > 0 ||
    minPoints >= input.maxPoints ||
    !hasAtMostTwoDecimals(minPoints)
  ) {
    errors.push("Минимальный балл должен быть не больше нуля и меньше максимального балла.");
  }
  if (
    !Number.isInteger(minSelections) ||
    !Number.isInteger(maxSelections) ||
    (minSelections ?? -1) < 0 ||
    (maxSelections ?? 0) < 1 ||
    (minSelections ?? Number.POSITIVE_INFINITY) >
      (maxSelections ?? Number.NEGATIVE_INFINITY) ||
    (maxSelections ?? Number.POSITIVE_INFINITY) > input.options.length
  ) {
    errors.push("Укажите допустимые ограничения количества выбранных вариантов.");
  }
  if (input.required && minSelections !== undefined && minSelections < 1) {
    errors.push("Обязательный multiple_choice требует минимум один выбранный вариант.");
  }
  if (!input.required && minSelections !== undefined && minSelections !== 0) {
    errors.push("Необязательный multiple_choice должен разрешать ноль выбранных вариантов.");
  }

  const optionIds = input.options.map((option) => option.id);
  if (
    optionIds.some((id) => !id) ||
    new Set(optionIds).size !== optionIds.length
  ) {
    errors.push("Варианты multiple_choice должны иметь уникальные идентификаторы.");
  }

  const hasOptionEffects = input.options.some(
    (option) => Object.keys(option.competencyEffects ?? {}).length > 0,
  );
  if (input.competencyKey && hasOptionEffects) {
    errors.push("competency_key вопроса нельзя смешивать с competency effects вариантов.");
  }
  for (const option of input.options) {
    const effects = Object.values(option.competencyEffects ?? {});
    if (
      effects.some(
        (value) =>
          !isFiniteNumber(value) || value <= 0 || !hasAtMostTwoDecimals(value),
      )
    ) {
      errors.push("Competency effects вариантов должны быть положительными числами с точностью до двух знаков.");
      break;
    }
  }

  if (isMultipleChoiceScoringMode(scoringMode)) {
    if (scoringMode === "option_points") {
      if (input.options.some((option) => option.isCorrect !== null)) {
        errors.push("В режиме option_points is_correct каждого варианта должен быть null.");
      }
      if (
        input.options.some(
          (option) =>
            !isFiniteNumber(option.points) ||
            option.points < -10_000 ||
            option.points > 10_000 ||
            !hasAtMostTwoDecimals(option.points),
        )
      ) {
        errors.push("Вес варианта должен быть от -10000 до 10000 и иметь не более двух знаков после запятой.");
      }
      if (
        !isFiniteNumber(correctnessThreshold) ||
        correctnessThreshold <= minPoints ||
        correctnessThreshold > input.maxPoints ||
        !hasAtMostTwoDecimals(correctnessThreshold)
      ) {
        errors.push("Порог правильности должен быть больше минимального и не больше максимального балла.");
      } else if (
        typeof minSelections === "number" &&
        Number.isInteger(minSelections) &&
        typeof maxSelections === "number" &&
        Number.isInteger(maxSelections) &&
        minSelections >= 0 &&
        maxSelections >= minSelections &&
        maxSelections <= input.options.length
      ) {
        const range = getMultipleChoiceOptionPointRange({
          maxSelections,
          minSelections,
          optionPoints: input.options.map((option) => option.points),
        });
        const maximumAwarded = clamp(range.maximum, minPoints, input.maxPoints);
        if (maximumAwarded < correctnessThreshold) {
          errors.push("Порог правильности недостижим при заданных вариантах и ограничениях выбора.");
        }
      }
    } else {
      const correctCount = input.options.filter(
        (option) => option.isCorrect === true,
      ).length;
      const incorrectCount = input.options.filter(
        (option) => option.isCorrect === false,
      ).length;
      if (correctCount === 0 || incorrectCount === 0) {
        errors.push("Нужен минимум один правильный и один неправильный вариант.");
      }
      if (input.options.some((option) => typeof option.isCorrect !== "boolean")) {
        errors.push("В режимах exact_match и partial_credit is_correct должен быть boolean.");
      }
      if (input.options.some((option) => option.points !== 0)) {
        errors.push("В режимах exact_match и partial_credit веса вариантов должны быть равны нулю.");
      }
      if (
        Number.isInteger(minSelections) &&
        Number.isInteger(maxSelections) &&
        (correctCount < (minSelections ?? 0) ||
          correctCount > (maxSelections ?? Number.POSITIVE_INFINITY))
      ) {
        errors.push("Полный набор правильных вариантов недостижим при заданных ограничениях выбора.");
      }
      if (correctCount === 1) {
        warnings.push("У вопроса только один правильный вариант; возможно, лучше использовать single_choice.");
      }

      if (scoringMode === "partial_credit") {
        if (
          !isFiniteNumber(correctOptionPoints) ||
          correctOptionPoints <= 0 ||
          !hasAtMostTwoDecimals(correctOptionPoints)
        ) {
          errors.push("Баллы за правильный вариант должны быть больше нуля.");
        }
        if (
          !isFiniteNumber(incorrectOptionPenalty) ||
          incorrectOptionPenalty < 0 ||
          !hasAtMostTwoDecimals(incorrectOptionPenalty)
        ) {
          errors.push("Штраф за неправильный вариант не может быть отрицательным.");
        }
        if (
          isFiniteNumber(correctOptionPoints) &&
          correctCount * correctOptionPoints < input.maxPoints
        ) {
          errors.push("Полный правильный набор должен достигать максимального балла.");
        }
      }
    }
  }

  if (errors.length > 0 || !isMultipleChoiceScoringMode(scoringMode)) {
    return { errors: [...new Set(errors)], ok: false, warnings };
  }

  return {
    definition: {
      correctOptionPoints: roundMultipleChoiceScore(correctOptionPoints),
      correctnessThreshold:
        scoringMode === "option_points" && isFiniteNumber(correctnessThreshold)
          ? roundMultipleChoiceScore(correctnessThreshold)
          : null,
      incorrectOptionPenalty: roundMultipleChoiceScore(incorrectOptionPenalty),
      maxPoints: roundMultipleChoiceScore(input.maxPoints),
      maxSelections: maxSelections as number,
      minPoints: roundMultipleChoiceScore(minPoints),
      minSelections: minSelections as number,
      options: input.options.map((option) => ({
        ...option,
        points: roundMultipleChoiceScore(option.points),
      })),
      penaltyMode:
        scoringMode === "partial_credit" ? penaltyMode : "none",
      required: input.required,
      scoringMode,
      version: MULTIPLE_CHOICE_SCORING_VERSION,
    },
    ok: true,
    warnings,
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function canonicalizeMultipleChoiceSelection(values: readonly string[]) {
  return [...new Set(values)].sort();
}

export function validateMultipleChoiceAnswer(
  input: unknown,
  optionIds: Iterable<string>,
  limits: {
    maxSelections: number;
    minSelections: number;
    required: boolean;
  },
  configuration: {
    rejectDuplicates?: boolean;
    requireUuid?: boolean;
  } = {},
): MultipleChoiceAnswerValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { error: "Ответ multiple_choice имеет неверный формат.", ok: false };
  }

  const payload = input as Record<string, unknown>;
  const allowedKeys = new Set(["selectedOptionIds", "skipped"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    return { error: "Ответ содержит поля, которыми управляет сервер.", ok: false };
  }

  if (payload.skipped !== undefined) {
    if (
      payload.skipped !== true ||
      payload.selectedOptionIds !== undefined
    ) {
      return { error: "Пропуск нельзя объединять с выбранными вариантами.", ok: false };
    }
    if (limits.required) {
      return { error: "Обязательный вопрос нельзя пропустить.", ok: false };
    }
    return {
      answer: { skipped: true },
      canonicalizedDuplicates: false,
      ok: true,
    };
  }

  if (
    !Array.isArray(payload.selectedOptionIds) ||
    payload.selectedOptionIds.some(
      (value) =>
        typeof value !== "string" ||
        !value ||
        (configuration.requireUuid === true && !isUuid(value)),
    )
  ) {
    return { error: "Выбранные варианты должны быть массивом корректных идентификаторов.", ok: false };
  }

  const selectedOptionIds = payload.selectedOptionIds as string[];
  const canonicalIds = canonicalizeMultipleChoiceSelection(selectedOptionIds);
  const hadDuplicates = canonicalIds.length !== selectedOptionIds.length;
  if (hadDuplicates && configuration.rejectDuplicates) {
    return { error: "Один вариант нельзя выбрать несколько раз.", ok: false };
  }

  const allowedOptionIds = new Set(optionIds);
  if (canonicalIds.some((id) => !allowedOptionIds.has(id))) {
    return { error: "Выбранный вариант не относится к текущему вопросу.", ok: false };
  }
  if (
    canonicalIds.length < limits.minSelections ||
    canonicalIds.length > limits.maxSelections
  ) {
    return {
      error: `Выберите от ${limits.minSelections} до ${limits.maxSelections} вариантов.`,
      ok: false,
    };
  }

  return {
    answer: { selectedOptionIds: canonicalIds },
    canonicalizedDuplicates: hadDuplicates,
    ok: true,
  };
}

export function areMultipleChoiceSetsEqual(
  left: readonly string[],
  right: readonly string[],
) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

export function classifyMultipleChoiceSelection(input: {
  options: readonly MultipleChoiceOption[];
  selectedOptionIds: readonly string[];
  scoringMode: MultipleChoiceScoringMode;
}): MultipleChoiceSelectionClassification {
  const selectedOptionIds = canonicalizeMultipleChoiceSelection(
    input.selectedOptionIds,
  );
  const selectedSet = new Set(selectedOptionIds);
  const correctOptionIds =
    input.scoringMode === "option_points"
      ? []
      : input.options
          .filter((option) => option.isCorrect === true)
          .map((option) => option.id);
  const correctSet = new Set(correctOptionIds);

  return {
    correctOptionIds,
    missedCorrectOptionIds: correctOptionIds.filter(
      (id) => !selectedSet.has(id),
    ),
    selectedCorrectOptionIds:
      input.scoringMode === "option_points"
        ? []
        : selectedOptionIds.filter((id) => correctSet.has(id)),
    selectedIncorrectOptionIds:
      input.scoringMode === "option_points"
        ? []
        : selectedOptionIds.filter((id) => !correctSet.has(id)),
    selectedOptionIds,
  };
}

export function scoreMultipleChoiceQuestion(input: {
  definition: NormalizedMultipleChoiceDefinition;
  selectedOptionIds: readonly string[];
}): MultipleChoiceScoreResult {
  const classification = classifyMultipleChoiceSelection({
    options: input.definition.options,
    scoringMode: input.definition.scoringMode,
    selectedOptionIds: input.selectedOptionIds,
  });
  const optionById = new Map(
    input.definition.options.map((option) => [option.id, option]),
  );
  if (
    classification.selectedOptionIds.some((id) => !optionById.has(id))
  ) {
    throw new MultipleChoiceAnswerValidationError(
      "Выбранный вариант не относится к текущему вопросу.",
    );
  }

  let isCorrect = false;
  let rawScore = 0;
  let optionContributions: Array<{ optionId: string; points: number }> = [];

  if (input.definition.scoringMode === "exact_match") {
    isCorrect = areMultipleChoiceSetsEqual(
      classification.selectedOptionIds,
      classification.correctOptionIds,
    );
    rawScore = isCorrect ? input.definition.maxPoints : 0;
    optionContributions = classification.selectedOptionIds.map((optionId) => ({
      optionId,
      points: 0,
    }));
  } else if (input.definition.scoringMode === "partial_credit") {
    isCorrect = areMultipleChoiceSetsEqual(
      classification.selectedOptionIds,
      classification.correctOptionIds,
    );
    optionContributions = classification.selectedOptionIds.map((optionId) => {
      const isCorrectOption = optionById.get(optionId)?.isCorrect === true;
      const points = isCorrectOption
        ? input.definition.correctOptionPoints
        : input.definition.penaltyMode === "subtract"
          ? -input.definition.incorrectOptionPenalty
          : 0;
      return { optionId, points: roundMultipleChoiceScore(points) };
    });
    rawScore = optionContributions.reduce(
      (sum, contribution) => sum + contribution.points,
      0,
    );
  } else {
    optionContributions = classification.selectedOptionIds.map((optionId) => ({
      optionId,
      points: roundMultipleChoiceScore(optionById.get(optionId)?.points ?? 0),
    }));
    rawScore = optionContributions.reduce(
      (sum, contribution) => sum + contribution.points,
      0,
    );
  }

  rawScore = roundMultipleChoiceScore(rawScore);
  const pointsAwarded =
    classification.selectedOptionIds.length === 0
      ? 0
      : roundMultipleChoiceScore(
          clamp(
            rawScore,
            input.definition.minPoints,
            input.definition.maxPoints,
          ),
        );
  if (input.definition.scoringMode === "option_points") {
    isCorrect =
      pointsAwarded >= (input.definition.correctnessThreshold ?? Infinity);
  }

  return {
    ...classification,
    isCorrect,
    maxPoints: input.definition.maxPoints,
    optionContributions,
    pointsAwarded,
    rawScore,
  };
}

export function buildMultipleChoiceReportModel(input: {
  isCorrect: boolean | null;
  maxPoints: number;
  options: readonly MultipleChoiceReportOption[];
  pointsAwarded: number | null;
  rawScore: number | null;
  scoringMode: MultipleChoiceScoringMode;
  selectedOptionIds: readonly string[];
}): MultipleChoiceReportModel {
  const options = [...input.options].sort(
    (left, right) => left.orderIndex - right.orderIndex,
  );
  const optionById = new Map(options.map((option) => [option.id, option]));
  const classification = classifyMultipleChoiceSelection({
    options,
    scoringMode: input.scoringMode,
    selectedOptionIds: input.selectedOptionIds,
  });
  const selectedOptions = classification.selectedOptionIds.map((id) => ({
    id,
    text: optionById.get(id)?.text ?? "Неизвестный вариант",
  }));
  const selectedIncorrectOptions = classification.selectedIncorrectOptionIds.map(
    (id) => ({ id, text: optionById.get(id)?.text ?? "Неизвестный вариант" }),
  );
  const missedCorrectOptions = classification.missedCorrectOptionIds.map((id) => ({
    id,
    text: optionById.get(id)?.text ?? "Неизвестный вариант",
  }));
  const optionContributions =
    input.scoringMode === "option_points"
      ? classification.selectedOptionIds.map((optionId) => ({
          optionId,
          points: roundMultipleChoiceScore(optionById.get(optionId)?.points ?? 0),
          text: optionById.get(optionId)?.text ?? "Неизвестный вариант",
        }))
      : [];

  let status: MultipleChoiceReportModel["status"] = "incorrect";
  if (selectedOptions.length === 0) status = "unanswered";
  else if (input.isCorrect === true) status = "correct";
  else if ((input.pointsAwarded ?? 0) > 0) status = "partial";

  return {
    isCorrect: input.isCorrect,
    maxPoints: input.maxPoints,
    missedCorrectOptions,
    mode: input.scoringMode,
    optionContributions,
    pointsAwarded: input.pointsAwarded,
    rawScore: input.rawScore,
    selectedIncorrectOptions,
    selectedOptions,
    status,
  };
}

export function renderMultipleChoiceReportText(
  model: MultipleChoiceReportModel,
) {
  const statusLabels: Record<MultipleChoiceReportModel["status"], string> = {
    correct: "Полностью правильно",
    incorrect: "Неправильно",
    partial: "Частично правильно",
    unanswered: "Ответ не выбран",
  };
  const lines = [
    `Режим: ${model.mode}`,
    `Статус: ${statusLabels[model.status]}`,
    `Баллы: ${model.pointsAwarded ?? 0} / ${model.maxPoints}`,
  ];
  if (model.rawScore !== null) lines.push(`Raw score: ${model.rawScore}`);
  if (model.selectedOptions.length > 0) {
    lines.push(
      `Выбрано: ${model.selectedOptions.map((option) => option.text).join(", ")}`,
    );
  }
  if (model.mode !== "option_points") {
    if (model.selectedIncorrectOptions.length > 0) {
      lines.push(
        `Ошибочно выбрано: ${model.selectedIncorrectOptions
          .map((option) => option.text)
          .join(", ")}`,
      );
    }
    if (model.missedCorrectOptions.length > 0) {
      lines.push(
        `Пропущено: ${model.missedCorrectOptions
          .map((option) => option.text)
          .join(", ")}`,
      );
    }
  } else if (model.optionContributions.length > 0) {
    lines.push(
      `Вклад вариантов: ${model.optionContributions
        .map((option) => `${option.text}: ${option.points}`)
        .join(", ")}`,
    );
  }
  return lines.join("\n");
}
