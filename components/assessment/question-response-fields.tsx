"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";

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
  onAnswerChange,
  question,
}: {
  answer: SavedAnswer;
  inputPrefix?: string;
  onAnswerChange?: () => void;
  question: FlowQuestion;
}) {
  const prefix = inputPrefix ? `${inputPrefix}_` : "";
  const savedMostOptionId =
    typeof answer?.answerJson.mostOptionId === "string" ? answer.answerJson.mostOptionId : null;
  const savedLeastOptionId =
    typeof answer?.answerJson.leastOptionId === "string" ? answer.answerJson.leastOptionId : null;
  const [mostOptionId, setMostOptionId] = useState(savedMostOptionId);
  const [leastOptionId, setLeastOptionId] = useState(
    savedLeastOptionId === savedMostOptionId ? null : savedLeastOptionId,
  );
  const savedOrderedOptionIds = Array.isArray(answer?.answerJson.orderedOptionIds)
    ? answer.answerJson.orderedOptionIds.filter((id): id is string => typeof id === "string")
    : [];
  const [orderedOptionIds, setOrderedOptionIds] = useState<string[]>(
    savedOrderedOptionIds.length === question.options.length
      ? savedOrderedOptionIds
      : question.options.map((option) => option.id),
  );
  const savedMatches = Array.isArray(answer?.answerJson.matches)
    ? answer.answerJson.matches
    : [];
  const [matchingSelections, setMatchingSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      savedMatches.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const pair = value as Record<string, unknown>;
        return typeof pair.optionId === "string" && typeof pair.targetId === "string"
          ? [[pair.optionId, pair.targetId] as const]
          : [];
      }),
    ),
  );
  const [draggingOptionId, setDraggingOptionId] = useState<string | null>(null);

  function commitOrdering(next: string[]) {
    setOrderedOptionIds(next);
    onAnswerChange?.();
  }

  function moveOrderingOption(optionId: string, targetIndex: number) {
    const sourceIndex = orderedOptionIds.indexOf(optionId);
    if (sourceIndex < 0) return;
    const next = [...orderedOptionIds];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(Math.min(Math.max(targetIndex, 0), next.length), 0, moved);
    commitOrdering(next);
  }

  if (question.questionType === "ordering" && question.isStructured) {
    const optionById = new Map(question.options.map((option) => [option.id, option]));
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Перетащите элементы или используйте кнопки со стрелками.
        </p>
        {orderedOptionIds.map((optionId, index) => {
          const option = optionById.get(optionId);
          if (!option) return null;
          return (
            <div
              className={`grid grid-cols-[2rem_2rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border bg-background p-2 ${
                draggingOptionId === option.id ? "opacity-50" : ""
              }`}
              key={option.id}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (draggingOptionId) moveOrderingOption(draggingOptionId, index);
                setDraggingOptionId(null);
              }}
            >
              <span
                aria-label={`Перетащить: ${option.text}`}
                className="flex cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
                draggable
                onDragEnd={() => setDraggingOptionId(null)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", option.id);
                  setDraggingOptionId(option.id);
                }}
                role="button"
                tabIndex={0}
              >
                <GripVertical className="size-4" />
              </span>
              <span className="text-center text-sm font-semibold text-muted-foreground">
                {index + 1}.
              </span>
              <span className="whitespace-pre-wrap px-1">{option.text}</span>
              <span className="flex gap-1">
                <button
                  aria-label={`Переместить «${option.text}» выше`}
                  className="inline-flex size-9 items-center justify-center rounded-md border disabled:opacity-40"
                  disabled={index === 0}
                  onClick={() => moveOrderingOption(option.id, index - 1)}
                  type="button"
                >
                  <ArrowUp className="size-4" />
                </button>
                <button
                  aria-label={`Переместить «${option.text}» ниже`}
                  className="inline-flex size-9 items-center justify-center rounded-md border disabled:opacity-40"
                  disabled={index === orderedOptionIds.length - 1}
                  onClick={() => moveOrderingOption(option.id, index + 1)}
                  type="button"
                >
                  <ArrowDown className="size-4" />
                </button>
              </span>
              <input name={`${prefix}orderedOptionIds`} type="hidden" value={option.id} />
            </div>
          );
        })}
      </div>
    );
  }

  if (question.questionType === "matching" && question.isStructured) {
    const selectedTargetIds = new Set(Object.values(matchingSelections).filter(Boolean));
    return (
      <div className="space-y-3">
        <div className="hidden grid-cols-2 gap-3 px-1 text-xs font-medium text-muted-foreground sm:grid">
          <span>Элемент</span>
          <span>Соответствие</span>
        </div>
        {question.options.map((option, index) => {
          const selectedTargetId = matchingSelections[option.id] ?? "";
          return (
            <div className="grid gap-2 rounded-lg border bg-background p-3 sm:grid-cols-2 sm:items-center" key={option.id}>
              <span className="whitespace-pre-wrap font-medium">{option.text}</span>
              <Select
                aria-label={`Соответствие для «${option.text}»`}
                name={`${prefix}match_${option.id}`}
                onChange={(event) => {
                  const targetId = event.target.value;
                  setMatchingSelections((current) => ({ ...current, [option.id]: targetId }));
                  onAnswerChange?.();
                }}
                required={question.isRequired}
                value={selectedTargetId}
              >
                <option value="">Выберите соответствие</option>
                {question.matchingTargets.map((target) => (
                  <option
                    disabled={selectedTargetIds.has(target.id) && target.id !== selectedTargetId}
                    key={target.id}
                    value={target.id}
                  >
                    {target.text}
                  </option>
                ))}
              </Select>
              <input name={`${prefix}matchOptionIds`} type="hidden" value={option.id} />
              <span className="sr-only">Пара {index + 1}</span>
            </div>
          );
        })}
      </div>
    );
  }

  if (question.questionType === "forced_choice") {
    return (
      <fieldset className="overflow-hidden rounded-lg border">
        <legend className="sr-only">Выберите наиболее и наименее похожее утверждение</legend>
        <div className="grid grid-cols-[minmax(0,1fr)_6rem_6rem] bg-muted/50 text-sm font-medium text-muted-foreground sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
          <span className="px-3 py-3 sm:px-4">Утверждение</span>
          <span className="px-1 py-3 text-center">Больше всего</span>
          <span className="px-1 py-3 text-center">Меньше всего</span>
        </div>
        {question.options.map((option) => (
          <div
            className="grid min-h-16 grid-cols-[minmax(0,1fr)_6rem_6rem] border-t sm:grid-cols-[minmax(0,1fr)_8rem_8rem]"
            key={option.id}
          >
            <span className="whitespace-pre-wrap px-3 py-4 sm:px-4">{option.text}</span>
            <label className="flex cursor-pointer items-center justify-center">
              <span className="sr-only">Больше всего: {option.text}</span>
              <input
                checked={mostOptionId === option.id}
                className="size-5 accent-primary"
                name={`${prefix}mostOptionId`}
                onChange={() => {
                  setMostOptionId(option.id);
                  if (leastOptionId === option.id) setLeastOptionId(null);
                }}
                required={question.isRequired}
                type="radio"
                value={option.id}
              />
            </label>
            <label className="flex cursor-pointer items-center justify-center">
              <span className="sr-only">Меньше всего: {option.text}</span>
              <input
                checked={leastOptionId === option.id}
                className="size-5 accent-primary"
                name={`${prefix}leastOptionId`}
                onChange={() => {
                  setLeastOptionId(option.id);
                  if (mostOptionId === option.id) setMostOptionId(null);
                }}
                required={question.isRequired}
                type="radio"
                value={option.id}
              />
            </label>
          </div>
        ))}
      </fieldset>
    );
  }

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
            <span className="whitespace-pre-wrap">{option.text}</span>
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
            <span className="whitespace-pre-wrap">{option.text}</span>
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
