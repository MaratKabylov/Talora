"use client";

import { memo } from "react";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TEST_COMPETENCIES, type QuestionType } from "@/lib/tests/builder-constants";
import type { BuilderOption } from "@/lib/tests/builder-data";
import type { BuilderEditorActions } from "./use-builder-actions";

export type OptionDragHandlers = { start: (id: string) => void; finish: () => void; drop: (index: number) => void };

export const OptionEditor = memo(function OptionEditor({ currentOption, optionIndex, optionCount, questionType, sectionId, questionId, isDragging, dragHandlers, actions }: {
  currentOption: BuilderOption; optionIndex: number; optionCount: number; questionType: QuestionType;
  sectionId: string; questionId: string; isDragging: boolean; dragHandlers: OptionDragHandlers; actions: BuilderEditorActions;
}) {
  const { patchOption, patchQuestion, moveOption } = actions;
  const competencyEffect = Object.entries(currentOption.competencyEffects)[0];
  return questionType === "ordering" || questionType === "matching" ? (
    <div
      className={`grid gap-2 rounded-md border bg-background p-2 ${questionType === "matching"
        ? "md:grid-cols-[2rem_1fr_1fr_auto]"
        : "md:grid-cols-[2rem_2rem_1fr_auto]"
        } ${isDragging ? "opacity-50" : ""}`}
      key={currentOption.id}
      data-builder-option-id={currentOption.id}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        dragHandlers.drop(optionIndex);
      }}
    >
      <span
        aria-label="Перетащить элемент"
        className="flex cursor-grab items-center justify-center text-muted-foreground active:cursor-grabbing"
        draggable
        onDragEnd={dragHandlers.finish}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", currentOption.id);
          dragHandlers.start(currentOption.id);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={event => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          moveOption(sectionId, questionId, currentOption.id, optionIndex + (event.key === "ArrowUp" ? -1 : 1));
        }}
      >
        <GripVertical className="size-4" />
      </span>
      {questionType === "ordering" ? (
        <span className="flex items-center justify-center text-sm font-semibold text-muted-foreground">
          {optionIndex + 1}.
        </span>
      ) : null}
      <Input
        aria-label={
          questionType === "matching"
            ? `Левый элемент ${optionIndex + 1}`
            : `Элемент ${optionIndex + 1}`
        }
        onChange={(event) =>
          patchOption(sectionId, questionId, currentOption.id, {
            text: event.target.value,
          })
        }
        value={currentOption.text}
      />
      {questionType === "matching" ? (
        <Input
          aria-label={`Правильное соответствие ${optionIndex + 1}`}
          onChange={(event) =>
            patchOption(sectionId, questionId, currentOption.id, {
              matchText: event.target.value,
            })
          }
          value={currentOption.matchText ?? ""}
        />
      ) : null}
      <div className="flex items-center justify-end gap-1">
        <Button
          aria-label="Переместить выше"
          disabled={optionIndex === 0}
          onClick={() =>
            moveOption(
              sectionId,
              questionId,
              currentOption.id,
              optionIndex - 1,
            )
          }
          className="size-8 px-0"
          size="sm"
          type="button"
          variant="ghost"
        >
          <ArrowUp />
        </Button>
        <Button
          aria-label="Переместить ниже"
          disabled={optionIndex === optionCount - 1}
          onClick={() =>
            moveOption(
              sectionId,
              questionId,
              currentOption.id,
              optionIndex + 1,
            )
          }
          className="size-8 px-0"
          size="sm"
          type="button"
          variant="ghost"
        >
          <ArrowDown />
        </Button>
        <Button
          aria-label="Удалить элемент"
          disabled={optionCount <= 2}
          onClick={() =>
            patchQuestion(sectionId, questionId, current => ({ options: current.options.filter(entry => entry.id !== currentOption.id) }))
          }
          className="size-8 px-0"
          size="sm"
          type="button"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </div>
    </div>

  ) : (
    <div className="space-y-2 rounded-md bg-muted/30 p-2" key={currentOption.id} data-builder-option-id={currentOption.id}>
      <div
        className={
          questionType === "forced_choice"
            ? "grid gap-2 md:grid-cols-[1fr_auto]"
            : "grid gap-2 md:grid-cols-[1fr_6rem_auto_auto]"
        }
      >
        <Input
          onChange={(event) =>
            patchOption(sectionId, questionId, currentOption.id, {
              text: event.target.value,
            })
          }
          value={currentOption.text}
        />
        {questionType !== "forced_choice" ? (
          <>
            <Input
              min="0"
              onChange={(event) =>
                patchOption(sectionId, questionId, currentOption.id, {
                  points: Number(event.target.value),
                })
              }
              step="0.01"
              type="number"
              value={currentOption.points}
            />
            <label className="flex items-center gap-2 px-2 text-sm">
              <input
                checked={Boolean(currentOption.isCorrect)}
                className="size-4 accent-primary"
                onChange={(event) =>
                  patchOption(sectionId, questionId, currentOption.id, {
                    isCorrect: event.target.checked,
                  })
                }
                type="checkbox"
              />
              Верный
            </label>
          </>
        ) : null}
        <Button
          aria-label="Удалить вариант"
          disabled={
            questionType === "forced_choice" &&
            optionCount <= 3
          }
          onClick={() =>
            patchQuestion(sectionId, questionId, current => ({ options: current.options.filter(entry => entry.id !== currentOption.id) }))
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </div>
      <div
        className={
          questionType === "forced_choice"
            ? "grid gap-2"
            : "grid gap-2 sm:grid-cols-[1fr_8rem_1fr]"
        }
      >
        <Select
          onChange={(event) => {
            const key = event.target.value;
            patchOption(sectionId, questionId, currentOption.id, {
              competencyEffects: key
                ? {
                  [key]:
                    Number(competencyEffect?.[1]) ||
                    (questionType === "forced_choice" ? 1 : 0),
                }
                : {},
            });
          }}
          value={competencyEffect?.[0] ?? ""}
        >
          <option value="">
            {questionType === "forced_choice"
              ? "Выберите компетенцию"
              : "Без эффекта компетенции"}
          </option>
          {TEST_COMPETENCIES.map((competency) => (
            <option key={competency.key} value={competency.key}>
              {competency.label}
            </option>
          ))}
        </Select>
        {questionType !== "forced_choice" ? (
          <>
            <Input
              disabled={!competencyEffect}
              onChange={(event) =>
                competencyEffect
                  ? patchOption(sectionId, questionId, currentOption.id, {
                    competencyEffects: {
                      [competencyEffect[0]]: Number(event.target.value) || 0,
                    },
                  })
                  : undefined
              }
              placeholder="Эффект"
              step="0.01"
              type="number"
              value={competencyEffect?.[1] ?? ""}
            />
            <Input
              onChange={(event) =>
                patchOption(sectionId, questionId, currentOption.id, {
                  explanation: event.target.value,
                })
              }
              placeholder="Комментарий для HR"
              value={currentOption.explanation ?? ""}
            />
          </>
        ) : null}
      </div>
    </div>

  );
});
