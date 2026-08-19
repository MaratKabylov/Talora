import { Fragment } from "react";

import { Button } from "@/components/ui/button";
import { RichTextContent } from "@/components/ui/rich-text-content";
import type { BuilderQuestion, BuilderSection } from "@/lib/tests/builder-data";
import type { TestVersion } from "@/lib/tests/data";

function QuestionInputPreview({ question }: { question: BuilderQuestion }) {
  if (question.questionType === "open_text") {
    return (
      <div className="h-20 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground">
        Поле свободного ответа кандидата
      </div>
    );
  }

  if (question.questionType === "scale") {
    return (
      <div className="space-y-2">
        <input className="w-full accent-primary" disabled max={question.scaleMax} min={question.scaleMin} type="range" />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{question.scaleMin}</span>
          <span>{question.scaleMax}</span>
        </div>
      </div>
    );
  }

  if (question.options.length === 0) {
    return <p className="text-sm text-muted-foreground">Варианты ответа еще не добавлены.</p>;
  }

  return (
    <div className="space-y-2">
      {question.options.map((option, index) => (
        <label
          className="flex items-start gap-3 rounded-md border bg-background px-3 py-2 text-sm"
          key={option.id}
        >
          {question.questionType === "ordering" ? (
            <span className="font-medium text-muted-foreground">{index + 1}.</span>
          ) : (
            <input
              disabled
              type={question.questionType === "multiple_choice" ? "checkbox" : "radio"}
            />
          )}
          <span className="whitespace-pre-wrap">{option.text}</span>
        </label>
      ))}
    </div>
  );
}

function ContentBlocks({ positionIndex, section }: { positionIndex: number; section: BuilderSection }) {
  return section.contentBlocks
    .filter(
      (block) =>
        Math.min(Math.max(block.positionIndex, 0), section.questions.length) === positionIndex,
    )
    .map((block) => (
      <div className="border-l-4 border-l-primary bg-muted/30 px-4 py-3" key={block.id}>
        <h4 className="font-semibold">{block.title}</h4>
        {block.description ? (
          <RichTextContent
            className="mt-1 text-sm text-muted-foreground"
            value={block.description}
          />
        ) : null}
      </div>
    ));
}

export function TestPreview({
  currentPageIndex,
  onPageChange,
  sections,
  version,
}: {
  currentPageIndex: number;
  onPageChange: (index: number) => void;
  sections: BuilderSection[];
  version: TestVersion;
}) {
  const isOneQuestion = version.presentationSettings.presentationMode === "one_question";
  const questionPages = sections.flatMap((section, sectionIndex) =>
    section.questions.map((question, questionIndex) => ({
      question,
      questionIndex,
      section,
      sectionIndex,
    })),
  );
  const pageCount = isOneQuestion ? questionPages.length : sections.length;
  const safePageIndex = Math.min(
    Math.max(currentPageIndex, 0),
    Math.max(pageCount - 1, 0),
  );
  const activeQuestionPage = isOneQuestion ? questionPages[safePageIndex] : null;
  const visibleSections = isOneQuestion
    ? []
    : sections.slice(safePageIndex, safePageIndex + 1);

  const navigation = pageCount > 0 ? (
    <div className="flex justify-between border-t pt-4">
      {version.presentationSettings.allowBack && safePageIndex > 0 ? (
        <Button
          onClick={() => onPageChange(safePageIndex - 1)}
          size="sm"
          type="button"
          variant="outline"
        >
          Назад
        </Button>
      ) : (
        <span />
      )}
      <Button
        disabled={safePageIndex === pageCount - 1}
        onClick={() => onPageChange(safePageIndex + 1)}
        size="sm"
        type="button"
      >
        {safePageIndex === pageCount - 1 ? "Завершить тест" : "Далее"}
      </Button>
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-background p-5">
        <h2 className="text-xl font-semibold">{version.title}</h2>
        {version.description ? (
          <RichTextContent className="mt-2 text-sm text-muted-foreground" value={version.description} />
        ) : null}
        {version.instructions ? (
          <RichTextContent className="mt-4 rounded-md bg-muted/50 p-4 text-sm" value={version.instructions} />
        ) : null}
      </div>

      {pageCount === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          {sections.length === 0
            ? "В этой версии пока нет секций и вопросов."
            : "В этой версии пока нет вопросов."}
        </p>
      ) : activeQuestionPage ? (
        <section className="space-y-4 rounded-lg border bg-background p-5">
          <div>
            <p className="mb-1 text-xs font-medium text-primary">
              Вопрос {safePageIndex + 1} из {questionPages.length}
            </p>
            <p className="text-xs text-muted-foreground">
              Секция {activeQuestionPage.sectionIndex + 1} из {sections.length}
            </p>
            <h3 className="mt-1 font-semibold">{activeQuestionPage.section.title}</h3>
            {activeQuestionPage.section.description ? (
              <RichTextContent
                className="mt-1 text-sm text-muted-foreground"
                value={activeQuestionPage.section.description}
              />
            ) : null}
          </div>

          <ContentBlocks
            positionIndex={activeQuestionPage.questionIndex}
            section={activeQuestionPage.section}
          />

          <div className="space-y-3 border-t pt-4">
            {activeQuestionPage.section.questions.some(
              (question) => question.remediationQuestionId === activeQuestionPage.question.id,
            ) ? (
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                Повторный вопрос после ошибки
              </p>
            ) : null}
            <div>
              <p className="whitespace-pre-wrap text-lg font-medium">
                {activeQuestionPage.question.text}
                {activeQuestionPage.question.isRequired ? (
                  <span className="ml-1 text-destructive">*</span>
                ) : null}
              </p>
            </div>
            {activeQuestionPage.question.description ? (
              <RichTextContent
                className="text-sm text-muted-foreground"
                value={activeQuestionPage.question.description}
              />
            ) : null}
            <QuestionInputPreview question={activeQuestionPage.question} />
            {activeQuestionPage.question.remediationQuestionId &&
            activeQuestionPage.question.incorrectFeedback ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <p className="font-medium">Если допущена ошибка:</p>
                <p className="mt-1 whitespace-pre-wrap">
                  {activeQuestionPage.question.incorrectFeedback}
                </p>
              </div>
            ) : null}
          </div>

          {navigation}
        </section>
      ) : (
        visibleSections.map((section) => {
          const remediationParentByTarget = new Map(
            section.questions.flatMap((question) =>
              question.remediationQuestionId
                ? [[question.remediationQuestionId, question.id] as const]
                : [],
            ),
          );

          return (
          <section className="space-y-4 rounded-lg border bg-background p-5" key={section.id}>
            <div>
              <p className="mb-1 text-xs font-medium text-primary">
                Секция {safePageIndex + 1} из {sections.length}
              </p>
              <h3 className="font-semibold">{section.title}</h3>
              {section.description ? (
                <RichTextContent className="mt-1 text-sm text-muted-foreground" value={section.description} />
              ) : null}
            </div>
            <ContentBlocks positionIndex={0} section={section} />
            {section.questions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Вопросы еще не добавлены.</p>
            ) : (
              section.questions.map((question, index) => (
                <Fragment key={question.id}>
                <div className="space-y-3 border-t pt-4 first:border-0 first:pt-0" key={question.id}>
                  <div>
                    {remediationParentByTarget.has(question.id) ? (
                      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-primary">
                        Повторный вопрос после ошибки
                      </p>
                    ) : null}
                    <p className="whitespace-pre-wrap text-sm font-medium">
                      {index + 1}. {question.text}
                      {question.isRequired ? <span className="ml-1 text-destructive">*</span> : null}
                    </p>
                  </div>
                  {question.description ? (
                    <RichTextContent className="text-sm text-muted-foreground" value={question.description} />
                  ) : null}
                  <QuestionInputPreview question={question} />
                  {question.remediationQuestionId && question.incorrectFeedback ? (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                      <p className="font-medium">Если допущена ошибка:</p>
                      <p className="mt-1 whitespace-pre-wrap">{question.incorrectFeedback}</p>
                    </div>
                  ) : null}
                </div>
                <ContentBlocks positionIndex={index + 1} section={section} />
                </Fragment>
              ))
            )}
            {navigation}
          </section>
          );
        })
      )}
    </div>
  );
}
