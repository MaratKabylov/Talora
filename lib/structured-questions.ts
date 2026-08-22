export const STRUCTURED_RESPONSE_VERSION = 1 as const;

export const ORDERING_SCORING_MODES = ["pairwise", "exact"] as const;
export const MATCHING_SCORING_MODES = ["per_pair", "exact"] as const;

export type OrderingScoringMode = (typeof ORDERING_SCORING_MODES)[number];
export type MatchingScoringMode = (typeof MATCHING_SCORING_MODES)[number];

export type OrderingAnswer = {
  orderedOptionIds: string[];
};

export type MatchingAnswerPair = {
  optionId: string;
  targetId: string;
};

export type MatchingAnswer = {
  matches: MatchingAnswerPair[];
};

export type StructuredOption = {
  id: string;
  matchTargetId?: string | null;
};

export type StructuredQuestionSettings = {
  matchingScoringMode?: MatchingScoringMode;
  orderingScoringMode?: OrderingScoringMode;
  structuredResponseVersion?: number;
};

export type StructuredAnswerValidationResult<T> =
  | { answer: T; ok: true }
  | { error: string; ok: false };

function uniqueStrings(values: unknown): string[] | null {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || !value)) {
    return null;
  }
  const strings = values as string[];
  return new Set(strings).size === strings.length ? strings : null;
}

export function isStructuredQuestion(settings: StructuredQuestionSettings | null | undefined) {
  return settings?.structuredResponseVersion === STRUCTURED_RESPONSE_VERSION;
}

export function normalizeOrderingScoringMode(value: unknown): OrderingScoringMode {
  return ORDERING_SCORING_MODES.includes(value as OrderingScoringMode)
    ? (value as OrderingScoringMode)
    : "pairwise";
}

export function normalizeMatchingScoringMode(value: unknown): MatchingScoringMode {
  return MATCHING_SCORING_MODES.includes(value as MatchingScoringMode)
    ? (value as MatchingScoringMode)
    : "per_pair";
}

export function validateOrderingAnswer(
  input: { orderedOptionIds?: unknown },
  optionIds: readonly string[],
): StructuredAnswerValidationResult<OrderingAnswer> {
  const orderedOptionIds = uniqueStrings(input.orderedOptionIds);
  if (!orderedOptionIds || orderedOptionIds.length !== optionIds.length) {
    return { error: "Расположите все элементы в нужном порядке.", ok: false };
  }

  const allowedIds = new Set(optionIds);
  if (orderedOptionIds.some((id) => !allowedIds.has(id))) {
    return { error: "Ответ содержит элемент, которого нет в текущем вопросе.", ok: false };
  }

  return { answer: { orderedOptionIds }, ok: true };
}

export function validateMatchingAnswer(
  input: { matches?: unknown },
  options: readonly StructuredOption[],
  configuration: { allowPartial?: boolean } = {},
): StructuredAnswerValidationResult<MatchingAnswer> {
  if (
    !Array.isArray(input.matches) ||
    input.matches.length === 0 ||
    (!configuration.allowPartial && input.matches.length !== options.length) ||
    input.matches.length > options.length
  ) {
    return { error: "Сопоставьте каждый элемент с одним вариантом.", ok: false };
  }

  const pairs: MatchingAnswerPair[] = [];
  for (const value of input.matches) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: "Ответ на сопоставление имеет неверный формат.", ok: false };
    }
    const pair = value as Record<string, unknown>;
    if (
      typeof pair.optionId !== "string" ||
      !pair.optionId ||
      typeof pair.targetId !== "string" ||
      !pair.targetId
    ) {
      return { error: "Сопоставьте каждый элемент с одним вариантом.", ok: false };
    }
    pairs.push({ optionId: pair.optionId, targetId: pair.targetId });
  }

  const optionIds = pairs.map((pair) => pair.optionId);
  const targetIds = pairs.map((pair) => pair.targetId);
  if (new Set(optionIds).size !== optionIds.length || new Set(targetIds).size !== targetIds.length) {
    return { error: "Каждый элемент и вариант можно использовать только один раз.", ok: false };
  }

  const allowedOptionIds = new Set(options.map((option) => option.id));
  const allowedTargetIds = new Set(
    options.flatMap((option) => (option.matchTargetId ? [option.matchTargetId] : [])),
  );
  if (
    allowedTargetIds.size !== options.length ||
    optionIds.some((id) => !allowedOptionIds.has(id)) ||
    targetIds.some((id) => !allowedTargetIds.has(id))
  ) {
    return { error: "Ответ содержит вариант, которого нет в текущем вопросе.", ok: false };
  }

  if (
    !configuration.allowPartial &&
    (new Set(optionIds).size !== allowedOptionIds.size || new Set(targetIds).size !== allowedTargetIds.size)
  ) {
    return { error: "Сопоставьте каждый элемент с одним вариантом.", ok: false };
  }

  return { answer: { matches: pairs }, ok: true };
}

export function scoreOrderingAnswer(
  correctOptionIds: readonly string[],
  answer: OrderingAnswer | null,
  mode: OrderingScoringMode,
) {
  if (!answer || correctOptionIds.length < 2) return 0;
  if (mode === "exact") {
    return correctOptionIds.every((id, index) => answer.orderedOptionIds[index] === id) ? 1 : 0;
  }

  const answerPosition = new Map(answer.orderedOptionIds.map((id, index) => [id, index]));
  let correctPairs = 0;
  let totalPairs = 0;
  for (let left = 0; left < correctOptionIds.length; left += 1) {
    for (let right = left + 1; right < correctOptionIds.length; right += 1) {
      totalPairs += 1;
      const leftPosition = answerPosition.get(correctOptionIds[left]);
      const rightPosition = answerPosition.get(correctOptionIds[right]);
      if (
        leftPosition !== undefined &&
        rightPosition !== undefined &&
        leftPosition < rightPosition
      ) {
        correctPairs += 1;
      }
    }
  }
  return totalPairs > 0 ? correctPairs / totalPairs : 0;
}

export function scoreMatchingAnswer(
  options: readonly Required<Pick<StructuredOption, "id" | "matchTargetId">>[],
  answer: MatchingAnswer | null,
  mode: MatchingScoringMode,
) {
  if (!answer || options.length === 0) return 0;
  const selectedTargetByOption = new Map(
    answer.matches.map((pair) => [pair.optionId, pair.targetId]),
  );
  const correctCount = options.filter(
    (option) => selectedTargetByOption.get(option.id) === option.matchTargetId,
  ).length;
  if (mode === "exact") return correctCount === options.length ? 1 : 0;
  return correctCount / options.length;
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createDeterministicShuffledIds(ids: readonly string[], seed: string) {
  const shuffled = ids
    .map((id, index) => ({ id, index, rank: stableHash(`${seed}:${id}`) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.id);

  if (shuffled.length > 1 && shuffled.every((id, index) => id === ids[index])) {
    return [...shuffled.slice(1), shuffled[0]];
  }
  return shuffled;
}
