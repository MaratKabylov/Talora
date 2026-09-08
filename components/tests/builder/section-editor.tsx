"use client";

import { Fragment, memo, useCallback, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Plus, Trash2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import type { BuilderSection } from "@/lib/tests/builder-data";
import { QUESTION_PRESETS, contentBlock, copySection, question, uuid } from "./builder-document";
import type { BuilderEditorActions } from "./use-builder-actions";
import type { QuestionDragHandlers } from "./use-question-drag";
import { QuestionEditor } from "./question-editor";

export const SectionEditor = memo(function SectionEditor({ currentSection, sectionIndex, sectionCount, initialExpandedQuestionId, draggingQuestionId, dropIndex, actions, dragHandlers }: {
  currentSection: BuilderSection; sectionIndex: number; sectionCount: number; initialExpandedQuestionId?: string;
  draggingQuestionId: string | null; dropIndex: number | null; actions: BuilderEditorActions; dragHandlers: QuestionDragHandlers;
}) {
  const { patchSection, patchContentBlock, updateSections } = actions;
  const [collapsedQuestionIds, setCollapsedQuestionIds] = useState(() => new Set(currentSection.questions.filter(q => q.id !== initialExpandedQuestionId).map(q => q.id)));
  // Primitive projection stays equal on option/points edits, so unrelated questions skip rendering.
  const questionTitlesJson = JSON.stringify(currentSection.questions.map(({ id, text }) => ({ id, text })));
  const allQuestionsCollapsed = currentSection.questions.length > 0 && currentSection.questions.every(q => collapsedQuestionIds.has(q.id));
  const toggleQuestion = useCallback((questionId: string) => {
    setCollapsedQuestionIds((current) => {
      const next = new Set(current);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  }, []);

  function toggleSectionQuestions(currentSection: BuilderSection) {
    const shouldExpand =
      currentSection.questions.length > 0 &&
      currentSection.questions.every((currentQuestion) =>
        collapsedQuestionIds.has(currentQuestion.id),
      );

    setCollapsedQuestionIds((current) => {
      const next = new Set(current);
      currentSection.questions.forEach((currentQuestion) => {
        if (shouldExpand) {
          next.delete(currentQuestion.id);
        } else {
          next.add(currentQuestion.id);
        }
      });
      return next;
    });
  }


  function renderContentBlocks(currentSection: BuilderSection, positionIndex: number) {
    return currentSection.contentBlocks
      .filter(
        (block) =>
          Math.min(Math.max(block.positionIndex, 0), currentSection.questions.length) ===
          positionIndex,
      )
      .map((block) => {
        const blockIndex = currentSection.contentBlocks.findIndex((entry) => entry.id === block.id);

        return (
          <article
            className="rounded-lg border border-l-4 border-l-primary bg-background p-4 transition-shadow hover:shadow-sm"
            key={block.id}
          >
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Type className="size-4" />
                Название и описание
              </div>
              <div className="flex gap-1">
                <Button
                  aria-label="Переместить блок выше"
                  disabled={positionIndex === 0}
                  onClick={() =>
                    patchContentBlock(currentSection.id, block.id, {
                      positionIndex: Math.max(0, positionIndex - 1),
                    })
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <ArrowUp />
                </Button>
                <Button
                  aria-label="Переместить блок ниже"
                  disabled={positionIndex === currentSection.questions.length}
                  onClick={() =>
                    patchContentBlock(currentSection.id, block.id, {
                      positionIndex: Math.min(
                        currentSection.questions.length,
                        positionIndex + 1,
                      ),
                    })
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <ArrowDown />
                </Button>
                <Button
                  aria-label="Дублировать блок"
                  onClick={() =>
                    patchSection(currentSection.id, {
                      contentBlocks: [
                        ...currentSection.contentBlocks.slice(0, blockIndex + 1),
                        { ...block, id: uuid() },
                        ...currentSection.contentBlocks.slice(blockIndex + 1),
                      ],
                    })
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Copy />
                </Button>
                <Button
                  aria-label="Удалить блок"
                  onClick={() =>
                    patchSection(currentSection.id, {
                      contentBlocks: currentSection.contentBlocks.filter(
                        (entry) => entry.id !== block.id,
                      ),
                    })
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            <Input
              aria-label="Название блока"
              className="h-auto border-0 bg-muted/40 px-3 py-2 text-lg font-semibold shadow-none focus-visible:ring-1"
              onChange={(event) =>
                patchContentBlock(currentSection.id, block.id, { title: event.target.value })
              }
              placeholder="Без названия"
              value={block.title}
            />
            <RichTextEditor
              className="mt-3"
              id={`builder-content-block-${block.id}-description`}
              onChange={(value) =>
                patchContentBlock(currentSection.id, block.id, { description: value })
              }
              placeholder="Описание (необязательно)"
              value={block.description ?? ""}
            />
          </article>
        );
      });
  }


  return (
    <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm" key={currentSection.id}>
      <div className="flex items-start justify-between gap-3 rounded-lg bg-muted/40 p-4">
        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">
            Секция {sectionIndex + 1} из {sectionCount}
          </p>
          <Input
            className="border-0 bg-transparent px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
            onChange={(event) => patchSection(currentSection.id, { title: event.target.value })}
            value={currentSection.title}
          />
          <RichTextEditor
            id={`builder-section-${currentSection.id}-description`}
            onChange={(value) => patchSection(currentSection.id, { description: value })}
            placeholder="Описание или инструкция для секции"
            value={currentSection.description ?? ""}
          />
          <Input
            className="max-w-56 bg-background"
            min="1"
            onChange={(event) =>
              patchSection(currentSection.id, {
                timeLimitMinutes: event.target.value ? Number(event.target.value) : null,
              })
            }
            placeholder="Лимит времени, минут"
            type="number"
            value={currentSection.timeLimitMinutes ?? ""}
          />
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          <Button
            aria-label={
              allQuestionsCollapsed
                ? "Развернуть все вопросы секции"
                : "Свернуть все вопросы секции"
            }
            disabled={currentSection.questions.length === 0}
            onClick={() => toggleSectionQuestions(currentSection)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {allQuestionsCollapsed ? <ChevronRight /> : <ChevronDown />}
            {allQuestionsCollapsed ? "Развернуть вопросы" : "Свернуть вопросы"}
          </Button>
          <Button
            aria-label="Дублировать секцию"
            onClick={() =>
              updateSections((current) => [
                ...current.slice(0, sectionIndex + 1),
                copySection(currentSection),
                ...current.slice(sectionIndex + 1),
              ])
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            <Copy />
          </Button>
          <Button
            aria-label="Удалить секцию"
            onClick={() =>
              updateSections((current) => current.filter((entry) => entry.id !== currentSection.id))
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {renderContentBlocks(currentSection, 0)}
      {currentSection.questions.map((currentQuestion, questionIndex) => (
        <Fragment key={currentQuestion.id}>
          <QuestionEditor currentQuestion={currentQuestion} questionIndex={questionIndex}
            sectionId={currentSection.id} questionTitlesJson={questionTitlesJson}
            isQuestionCollapsed={collapsedQuestionIds.has(currentQuestion.id)} toggleQuestion={toggleQuestion}
            isDragging={draggingQuestionId === currentQuestion.id} dropBefore={dropIndex === questionIndex}
            dropAfter={dropIndex === questionIndex + 1} actions={actions} dragHandlers={dragHandlers} />
          {renderContentBlocks(currentSection, questionIndex + 1)}
        </Fragment>
      ))}

      <div
        className={`flex items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground transition-colors ${draggingQuestionId
          ? "min-h-12 border-primary/50 bg-primary/5"
          : "h-2 border-transparent"
          } ${dropIndex === currentSection.questions.length
            ? "border-primary bg-primary/10 text-primary"
            : ""
          }`}
        data-question-drop-end="true"
        data-question-drop-index={currentSection.questions.length}
        data-question-section-id={currentSection.id}
      >
        {draggingQuestionId ? "Переместить в конец секции" : null}
      </div>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button
          onClick={() =>
            patchSection(currentSection.id, {
              questions: [...currentSection.questions, question()],
            })
          }
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus /> Вопрос
        </Button>
        <Button
          onClick={() =>
            patchSection(currentSection.id, {
              contentBlocks: [
                ...currentSection.contentBlocks,
                contentBlock(currentSection.questions.length),
              ],
            })
          }
          size="sm"
          type="button"
          variant="outline"
        >
          <Type /> Название и описание
        </Button>
        {QUESTION_PRESETS.map((preset) => (
          <Button
            key={preset.label}
            onClick={() =>
              patchSection(currentSection.id, {
                questions: [
                  ...currentSection.questions,
                  question(preset.questionType, preset.text),
                ],
              })
            }
            size="sm"
            type="button"
            variant="ghost"
          >
            {preset.label}
          </Button>
        ))}
      </div>
    </section>

  );
});
