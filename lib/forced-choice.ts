export const FORCED_CHOICE_MODE_VALUES = ["most_least"] as const;

export type ForcedChoiceMode = (typeof FORCED_CHOICE_MODE_VALUES)[number];

export type ForcedChoiceAnswer = {
  leastOptionId: string;
  mostOptionId: string;
};

export type ForcedChoiceValidationResult =
  | { answer: ForcedChoiceAnswer; ok: true }
  | { error: string; ok: false };

export type ForcedChoiceDefinitionValidationResult =
  | { ok: true }
  | { error: string; ok: false };

export type ForcedChoiceScore = {
  maxPossible: number;
  minPossible: number;
  rawScore: number;
};

export class ForcedChoiceAnswerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForcedChoiceAnswerValidationError";
  }
}

export function isForcedChoiceMode(value: unknown): value is ForcedChoiceMode {
  return FORCED_CHOICE_MODE_VALUES.includes(value as ForcedChoiceMode);
}

export function validateForcedChoiceDefinition(input: {
  mode: unknown;
  options: Array<{ competencyEffects: unknown }>;
}): ForcedChoiceDefinitionValidationResult {
  if (input.mode === undefined || input.mode === null || input.mode === "") {
    return { error: "Для Forced Choice укажите mode = most_least.", ok: false };
  }
  if (!isForcedChoiceMode(input.mode)) {
    return { error: "Поддерживается только Forced Choice mode = most_least.", ok: false };
  }
  if (input.options.length < 3) {
    return { error: "Для Forced Choice нужно минимум три утверждения.", ok: false };
  }
  for (const option of input.options) {
    if (
      !option.competencyEffects ||
      typeof option.competencyEffects !== "object" ||
      Array.isArray(option.competencyEffects)
    ) {
      return { error: "Для каждого утверждения укажите competency_effects.", ok: false };
    }
    const effects = Object.values(option.competencyEffects as Record<string, unknown>);
    if (
      effects.length === 0 ||
      effects.some(
        (value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0,
      )
    ) {
      return { error: "Для каждого утверждения укажите competency_effects.", ok: false };
    }
  }
  return { ok: true };
}

export function validateForcedChoiceAnswer(
  input: { leastOptionId?: unknown; mostOptionId?: unknown },
  optionIds: Iterable<string>,
  mode: unknown,
): ForcedChoiceValidationResult {
  if (!isForcedChoiceMode(mode)) {
    return { error: "Режим Forced Choice не поддерживается.", ok: false };
  }

  const mostOptionId =
    typeof input.mostOptionId === "string" && input.mostOptionId
      ? input.mostOptionId
      : null;
  const leastOptionId =
    typeof input.leastOptionId === "string" && input.leastOptionId
      ? input.leastOptionId
      : null;

  if (!mostOptionId || !leastOptionId) {
    return {
      error: "Необходимо выбрать вариант «Больше всего» и «Меньше всего».",
      ok: false,
    };
  }
  if (mostOptionId === leastOptionId) {
    return {
      error: "Один вариант нельзя одновременно выбрать как MOST и LEAST.",
      ok: false,
    };
  }

  const allowedOptionIds = new Set(optionIds);
  if (!allowedOptionIds.has(mostOptionId) || !allowedOptionIds.has(leastOptionId)) {
    return {
      error: "Выбранный вариант не относится к текущему вопросу.",
      ok: false,
    };
  }

  return { answer: { leastOptionId, mostOptionId }, ok: true };
}

function finiteEffect(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * MVP Best-Worst scoring: MOST contributes +effect and LEAST contributes -effect.
 * This is deliberately not described as IRT; raw choices remain stored so a future
 * normative/Thurstonian model can replace this calculation without changing answers.
 */
export function scoreForcedChoiceQuestion(
  options: Array<{ competencyEffects: Record<string, number> | null; id: string }>,
  answer: ForcedChoiceAnswer | null,
) {
  const competencyKeys = new Set(
    options.flatMap((option) => Object.keys(option.competencyEffects ?? {})),
  );
  const scores: Record<string, ForcedChoiceScore> = {};
  const mostOption = options.find((option) => option.id === answer?.mostOptionId);
  const leastOption = options.find((option) => option.id === answer?.leastOptionId);
  const hasValidAnswer = Boolean(
    mostOption && leastOption && mostOption.id !== leastOption.id,
  );

  for (const key of competencyKeys) {
    let minPossible = Number.POSITIVE_INFINITY;
    let maxPossible = Number.NEGATIVE_INFINITY;

    for (const mostCandidate of options) {
      for (const leastCandidate of options) {
        if (mostCandidate.id === leastCandidate.id) continue;
        const contribution =
          finiteEffect(mostCandidate.competencyEffects?.[key]) -
          finiteEffect(leastCandidate.competencyEffects?.[key]);
        minPossible = Math.min(minPossible, contribution);
        maxPossible = Math.max(maxPossible, contribution);
      }
    }

    if (!Number.isFinite(minPossible) || !Number.isFinite(maxPossible)) {
      minPossible = 0;
      maxPossible = 0;
    }

    scores[key] = {
      maxPossible,
      minPossible,
      rawScore: hasValidAnswer
        ? finiteEffect(mostOption?.competencyEffects?.[key]) -
          finiteEffect(leastOption?.competencyEffects?.[key])
        : 0,
    };
  }

  return scores;
}

export function normalizeForcedChoiceScore(score: ForcedChoiceScore) {
  const range = score.maxPossible - score.minPossible;
  if (range <= 0) return null;
  return Math.round(
    Math.min(Math.max((score.rawScore - score.minPossible) / range, 0), 1) * 100,
  );
}
