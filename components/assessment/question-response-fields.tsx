import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { FlowQuestion } from "@/lib/assessment/data";

type SavedAnswer = {
  answerJson: Record<string, unknown>;
  answerText: string | null;
  selectedOptionId: string | null;
} | null;

export function QuestionResponseFields({
  answer,
  inputPrefix,
  question,
}: {
  answer: SavedAnswer;
  inputPrefix?: string;
  question: FlowQuestion;
}) {
  const prefix = inputPrefix ? `${inputPrefix}_` : "";

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
              name={`${prefix}optionId`}
              required={question.isRequired}
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
              name={`${prefix}optionIds`}
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

    if (!question.isRequired) {
      return (
        <div className="space-y-3">
          <Label htmlFor={`${prefix}scaleValue`}>
            Выберите значение от {question.scaleMin} до {question.scaleMax}
          </Label>
          <Select
            defaultValue={typeof answer?.answerJson.value === "number" ? storedValue : ""}
            id={`${prefix}scaleValue`}
            name={`${prefix}scaleValue`}
          >
            <option value="">Пропустить вопрос</option>
            {Array.from(
              { length: question.scaleMax - question.scaleMin + 1 },
              (_, index) => question.scaleMin + index,
            ).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <Label htmlFor={`${prefix}scaleValue`}>Выберите значение от {question.scaleMin} до {question.scaleMax}</Label>
        <Input
          className="h-12 accent-primary"
          defaultValue={storedValue}
          id={`${prefix}scaleValue`}
          max={question.scaleMax}
          min={question.scaleMin}
          name={`${prefix}scaleValue`}
          required={question.isRequired}
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
      <Label htmlFor={`${prefix}answerText`}>{guidance}</Label>
      <Textarea
        className="min-h-32"
        defaultValue={answer?.answerText ?? ""}
        id={`${prefix}answerText`}
        maxLength={4000}
        name={`${prefix}answerText`}
        required={question.isRequired}
      />
    </div>
  );
}
