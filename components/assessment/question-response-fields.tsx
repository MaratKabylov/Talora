import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FlowQuestion } from "@/lib/assessment/data";

type SavedAnswer = {
  answerJson: Record<string, unknown>;
  answerText: string | null;
  selectedOptionId: string | null;
} | null;

export function QuestionResponseFields({
  answer,
  question,
}: {
  answer: SavedAnswer;
  question: FlowQuestion;
}) {
  if (question.questionType === "single_choice") {
    return (
      <div className="space-y-3">
        {question.options.map((option) => (
          <label
            className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors has-checked:border-primary has-checked:bg-primary/5"
            key={option.id}
          >
            <input
              className="mt-0.5 size-5 shrink-0 accent-primary"
              defaultChecked={answer?.selectedOptionId === option.id}
              name="optionId"
              required
              type="radio"
              value={option.id}
            />
            <span>{option.text}</span>
          </label>
        ))}
      </div>
    );
  }

  if (question.questionType === "multiple_choice") {
    const selectedIds = Array.isArray(answer?.answerJson.selectedOptionIds)
      ? answer.answerJson.selectedOptionIds
      : [];

    return (
      <div className="space-y-3">
        {question.options.map((option) => (
          <label
            className="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors has-checked:border-primary has-checked:bg-primary/5"
            key={option.id}
          >
            <input
              className="mt-0.5 size-5 shrink-0 accent-primary"
              defaultChecked={selectedIds.includes(option.id)}
              name="optionIds"
              type="checkbox"
              value={option.id}
            />
            <span>{option.text}</span>
          </label>
        ))}
      </div>
    );
  }

  if (question.questionType === "scale") {
    const storedValue =
      typeof answer?.answerJson.value === "number" ? answer.answerJson.value : question.scaleMin;

    return (
      <div className="space-y-3">
        <Label htmlFor="scaleValue">Выберите значение от {question.scaleMin} до {question.scaleMax}</Label>
        <Input
          className="h-12 accent-primary"
          defaultValue={storedValue}
          id="scaleValue"
          max={question.scaleMax}
          min={question.scaleMin}
          name="scaleValue"
          required
          type="range"
        />
        <div className="flex justify-between text-sm text-muted-foreground">
          <span>{question.scaleMin}</span>
          <span>{question.scaleMax}</span>
        </div>
      </div>
    );
  }

  const guidance =
    question.questionType === "ordering"
      ? "Укажите порядок элементов."
      : question.questionType === "matching"
        ? "Опишите соответствия."
        : "Введите ваш ответ.";

  return (
    <div className="space-y-2">
      <Label htmlFor="answerText">{guidance}</Label>
      <Textarea
        className="min-h-32"
        defaultValue={answer?.answerText ?? ""}
        id="answerText"
        maxLength={4000}
        name="answerText"
        required
      />
    </div>
  );
}
