"use client";

import { useMemo } from "react";
import type { BuilderContentBlock, BuilderQuestion, BuilderSection } from "@/lib/tests/builder-data";
import { question, normalizeRemediationQuestions } from "./builder-document";

export type UpdateBuilderSections = (update: (current: BuilderSection[]) => BuilderSection[]) => void;

export function useBuilderActions(updateSections: UpdateBuilderSections) {
  return useMemo(() => {
    function patchSection(sectionId: string, patch: Partial<BuilderSection>) {
      updateSections((current) =>
        current.map((entry) => (entry.id === sectionId ? { ...entry, ...patch } : entry)),
      );
    }

    function patchQuestion(sectionId: string, questionId: string, patch: Partial<BuilderQuestion> | ((question: BuilderQuestion) => Partial<BuilderQuestion>)) {
      updateSections((current) =>
        current.map((entry) =>
          entry.id === sectionId
            ? {
              ...entry,
              questions: entry.questions.map((currentQuestion) =>
                currentQuestion.id === questionId ? { ...currentQuestion, ...(typeof patch === "function" ? patch(currentQuestion) : patch) } : currentQuestion,
              ),
            }
            : entry,
        ),
      );
    }

    function moveOption(sectionId: string, questionId: string, optionId: string, targetIndex: number) {
      updateSections((current) =>
        current.map((entry) => {
          if (entry.id !== sectionId) return entry;
          return {
            ...entry,
            questions: entry.questions.map((currentQuestion) => {
              if (currentQuestion.id !== questionId) return currentQuestion;
              const sourceIndex = currentQuestion.options.findIndex((currentOption) => currentOption.id === optionId);
              if (sourceIndex < 0) return currentQuestion;
              const reordered = [...currentQuestion.options];
              const [moved] = reordered.splice(sourceIndex, 1);
              const insertionIndex = Math.min(Math.max(targetIndex, 0), reordered.length);
              reordered.splice(insertionIndex, 0, moved);
              return { ...currentQuestion, options: reordered };
            }),
          };
        }),
      );
    }

    function patchContentBlock(
      sectionId: string,
      blockId: string,
      patch: Partial<BuilderContentBlock>,
    ) {
      updateSections((current) =>
        current.map((entry) =>
          entry.id === sectionId
            ? {
              ...entry,
              contentBlocks: entry.contentBlocks.map((block) =>
                block.id === blockId ? { ...block, ...patch } : block,
              ),
            }
            : entry,
        ),
      );
    }

    function addQuestionAfter(sectionId: string, questionId: string) {
      const newQuestion = question("single_choice", "Повторный вопрос");

      updateSections((current) =>
        current.map((entry) => {
          if (entry.id !== sectionId) return entry;

          const questionIndex = entry.questions.findIndex(
            (currentQuestion) => currentQuestion.id === questionId,
          );
          if (questionIndex === -1) return entry;

          return {
            ...entry,
            contentBlocks: entry.contentBlocks.map((block) => ({
              ...block,
              positionIndex:
                block.positionIndex >= questionIndex + 1
                  ? block.positionIndex + 1
                  : block.positionIndex,
            })),
            questions: [
              ...entry.questions.slice(0, questionIndex + 1),
              newQuestion,
              ...entry.questions.slice(questionIndex + 1),
            ],
          };
        }),
      );
    }

    function patchOption(
      sectionId: string,
      questionId: string,
      optionId: string,
      patch: Partial<BuilderQuestion["options"][number]>,
    ) {
      updateSections((current) =>
        current.map((entry) =>
          entry.id === sectionId
            ? {
              ...entry,
              questions: entry.questions.map((currentQuestion) =>
                currentQuestion.id === questionId
                  ? {
                    ...currentQuestion,
                    options: currentQuestion.options.map((currentOption) =>
                      currentOption.id === optionId ? { ...currentOption, ...patch } : currentOption,
                    ),
                  }
                  : currentQuestion,
              ),
            }
            : entry,
        ),
      );
    }

    function moveQuestion(source: { sectionId: string; questionId: string }, targetSectionId: string, targetIndex: number) {

      updateSections((current) => {
        const sourceSection = current.find((entry) => entry.id === source.sectionId);
        const targetSection = current.find((entry) => entry.id === targetSectionId);
        const sourceIndex = sourceSection?.questions.findIndex(
          (currentQuestion) => currentQuestion.id === source.questionId,
        );

        if (!sourceSection || !targetSection || sourceIndex === undefined || sourceIndex < 0) {
          return current;
        }

        if (source.sectionId === targetSectionId) {
          const reordered = [...sourceSection.questions];
          const [movedQuestion] = reordered.splice(sourceIndex, 1);
          const adjustedTargetIndex = Math.min(
            Math.max(targetIndex - (sourceIndex < targetIndex ? 1 : 0), 0),
            reordered.length,
          );

          if (adjustedTargetIndex === sourceIndex) return current;

          reordered.splice(adjustedTargetIndex, 0, movedQuestion);
          return current.map((entry) =>
            entry.id === source.sectionId
              ? { ...entry, questions: normalizeRemediationQuestions(reordered) }
              : entry,
          );
        }

        const movedQuestion = {
          ...sourceSection.questions[sourceIndex],
          incorrectFeedback: null,
          remediationQuestionId: null,
        };
        const insertionIndex = Math.min(Math.max(targetIndex, 0), targetSection.questions.length);

        return current.map((entry) => {
          if (entry.id === source.sectionId) {
            const remainingQuestions = entry.questions
              .filter((currentQuestion) => currentQuestion.id !== source.questionId)
              .map((currentQuestion) =>
                currentQuestion.remediationQuestionId === source.questionId
                  ? {
                    ...currentQuestion,
                    incorrectFeedback: null,
                    remediationQuestionId: null,
                  }
                  : currentQuestion,
              );

            return {
              ...entry,
              contentBlocks: entry.contentBlocks.map((block) => ({
                ...block,
                positionIndex:
                  block.positionIndex > sourceIndex
                    ? Math.max(0, block.positionIndex - 1)
                    : block.positionIndex,
              })),
              questions: normalizeRemediationQuestions(remainingQuestions),
            };
          }

          if (entry.id === targetSectionId) {
            const questions = [...entry.questions];
            questions.splice(insertionIndex, 0, movedQuestion);
            return { ...entry, questions: normalizeRemediationQuestions(questions) };
          }

          return entry;
        });
      });
    }


    return { updateSections, patchSection, patchQuestion, patchOption, moveOption, patchContentBlock, addQuestionAfter, moveQuestion };
  }, [updateSections]);
}

export type BuilderEditorActions = ReturnType<typeof useBuilderActions>;
