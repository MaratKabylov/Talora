import type { QuestionType } from "@/lib/tests/builder-constants";

export type RenderableStructuredOption = {
  id: string;
  match_target_id?: string | null;
  match_text?: string | null;
  order_index: number;
  text: string;
};

export function renderStructuredAnswer(input: {
  answerJson: Record<string, unknown> | null;
  options: RenderableStructuredOption[];
  questionType: QuestionType | string;
}) {
  const options = input.options.slice().sort((left, right) => left.order_index - right.order_index);
  const optionById = new Map(options.map((option) => [option.id, option]));

  if (input.questionType === "ordering") {
    const orderedIds = Array.isArray(input.answerJson?.orderedOptionIds)
      ? input.answerJson.orderedOptionIds.filter((id): id is string => typeof id === "string")
      : [];
    if (orderedIds.length === 0) return "Ответ не выбран";
    const response = orderedIds.map(
      (id, index) => `${index + 1}. ${optionById.get(id)?.text ?? "Неизвестный элемент"}`,
    );
    const correct = options.map((option, index) => `${index + 1}. ${option.text}`);
    return `Ответ:\n${response.join("\n")}\n\nПравильный порядок:\n${correct.join("\n")}`;
  }

  if (input.questionType === "matching") {
    const matches = Array.isArray(input.answerJson?.matches) ? input.answerJson.matches : [];
    const targetTextById = new Map(
      options.flatMap((option) =>
        option.match_target_id && option.match_text
          ? [[option.match_target_id, option.match_text] as const]
          : [],
      ),
    );
    const selectedTargetByOption = new Map(
      matches.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const pair = value as Record<string, unknown>;
        return typeof pair.optionId === "string" && typeof pair.targetId === "string"
          ? [[pair.optionId, pair.targetId] as const]
          : [];
      }),
    );
    if (selectedTargetByOption.size === 0) return "Ответ не выбран";
    return options
      .map((option) => {
        const selectedTargetId = selectedTargetByOption.get(option.id);
        const selectedText = selectedTargetId
          ? targetTextById.get(selectedTargetId) ?? "Неизвестный вариант"
          : "не выбрано";
        const correct = selectedTargetId === option.match_target_id;
        return `${correct ? "✓" : "✗"} ${option.text} → ${selectedText}${
          correct || !option.match_text ? "" : ` (правильно: ${option.match_text})`
        }`;
      })
      .join("\n");
  }

  return null;
}
