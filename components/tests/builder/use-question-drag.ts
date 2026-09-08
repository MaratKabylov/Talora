"use client";

import { useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { BuilderEditorActions } from "./use-builder-actions";

export function useQuestionDrag(moveQuestion: BuilderEditorActions["moveQuestion"]) {
  const [draggingQuestionId, setDraggingQuestionId] = useState<string | null>(null);
  const [questionDropTarget, setQuestionDropTarget] = useState<{
    index: number;
    sectionId: string;
  } | null>(null);
  const dragQuestion = useRef<{ questionId: string; sectionId: string } | null>(null);
  const pointerQuestion = useRef<{
    pointerId: number;
    questionId: string;
    sectionId: string;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);


  const handlers = useMemo(() => {
    function finishQuestionDrag() {
      dragQuestion.current = null;
      pointerQuestion.current = null;
      setDraggingQuestionId(null);
      setQuestionDropTarget(null);
    }

    function getQuestionDropTarget(clientX: number, clientY: number) {
      const element = document.elementFromPoint(clientX, clientY);
      const dropElement = element?.closest(
        "[data-question-drop-index][data-question-section-id]",
      ) as HTMLElement | null;
      if (!dropElement) return null;

      const sectionId = dropElement.dataset.questionSectionId;
      const dropIndex = Number(dropElement.dataset.questionDropIndex);
      if (!sectionId || !Number.isInteger(dropIndex)) return null;

      if (dropElement.dataset.questionDropEnd === "true") {
        return { index: dropIndex, sectionId };
      }

      const bounds = dropElement.getBoundingClientRect();
      return {
        index: clientY < bounds.top + bounds.height / 2 ? dropIndex : dropIndex + 1,
        sectionId,
      };
    }

    function startQuestionPointerDrag(
      event: ReactPointerEvent<HTMLElement>,
      sectionId: string,
      questionId: string,
    ) {
      if (!event.isPrimary || event.button !== 0) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerQuestion.current = {
        pointerId: event.pointerId,
        questionId,
        sectionId,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
      };
    }

    function continueQuestionPointerDrag(event: ReactPointerEvent<HTMLElement>) {
      const pointer = pointerQuestion.current;
      if (!pointer || pointer.pointerId !== event.pointerId) return;

      const distance = Math.hypot(
        event.clientX - pointer.startX,
        event.clientY - pointer.startY,
      );
      if (!pointer.started && distance < 5) return;

      event.preventDefault();
      if (!pointer.started) {
        pointer.started = true;
        dragQuestion.current = {
          questionId: pointer.questionId,
          sectionId: pointer.sectionId,
        };
        setDraggingQuestionId(pointer.questionId);
      }

      const target = getQuestionDropTarget(event.clientX, event.clientY);
      setQuestionDropTarget((current) =>
        current?.index === target?.index && current?.sectionId === target?.sectionId
          ? current
          : target,
      );

      if (event.clientY < 72) {
        window.scrollBy({ top: -16 });
      } else if (event.clientY > window.innerHeight - 72) {
        window.scrollBy({ top: 16 });
      }
    }

    function completeQuestionPointerDrag(event: ReactPointerEvent<HTMLElement>) {
      const pointer = pointerQuestion.current;
      if (!pointer || pointer.pointerId !== event.pointerId) return;

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (pointer.started) {
        const target = getQuestionDropTarget(event.clientX, event.clientY);
        if (target) moveQuestion(dragQuestion.current!, target.sectionId, target.index);
      }

      finishQuestionDrag();
    }


    return { finishQuestionDrag, startQuestionPointerDrag, continueQuestionPointerDrag, completeQuestionPointerDrag };
  }, [moveQuestion]);
  return { draggingQuestionId, questionDropTarget, handlers };
}

export type QuestionDragHandlers = ReturnType<typeof useQuestionDrag>["handlers"];
