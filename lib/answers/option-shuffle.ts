export type DisplayOptionsInput<T extends { id: string }> = {
  attemptId: string;
  options: readonly T[];
  questionId: string;
  shuffle: boolean;
};

export function createOptionShuffleSeed(attemptId: string, questionId: string) {
  return `option_shuffle:${attemptId}:${questionId}`;
}

export function hashOptionShuffleSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hasUniqueOptionIds(options: readonly { id: string }[]) {
  return new Set(options.map((option) => option.id)).size === options.length;
}

function createSeededRandom(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns display-only options. Callers pass options in their canonical
 * order_index order; this function never mutates that source array.
 */
export function getDisplayOptions<T extends { id: string }>({
  attemptId,
  options,
  questionId,
  shuffle,
}: DisplayOptionsInput<T>): T[] {
  const displayOptions = [...options];
  if (!shuffle || displayOptions.length < 2) {
    return displayOptions;
  }

  const random = createSeededRandom(
    hashOptionShuffleSeed(createOptionShuffleSeed(attemptId, questionId)),
  );
  for (let index = displayOptions.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [displayOptions[index], displayOptions[swapIndex]] = [
      displayOptions[swapIndex],
      displayOptions[index],
    ];
  }

  return displayOptions;
}
