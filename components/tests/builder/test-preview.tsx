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

export function TestPreview({
  currentSectionIndex,
  onSectionChange,
  sections,
  version,
}: {
  currentSectionIndex?: number;
  onSectionChange?: (index: number) => void;
  sections: BuilderSection[];
  version: TestVersion;
}) {
  const isPaged = typeof currentSectionIndex === "number";
  const safeSectionIndex = Math.min(Math.max(currentSectionIndex ?? 0, 0), Math.max(sections.length - 1, 0));
  const visibleSections = isPaged ? sections.slice(safeSectionIndex, safeSectionIndex + 1) : sections;

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

      {sections.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          В этой версии пока нет секций и вопросов.
        </p>
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
              {isPaged ? (
                <p className="mb-1 text-xs font-medium text-primary">
                  Страница {safeSectionIndex + 1} из {sections.length}
                </p>
              ) : null}
              <h3 className="font-semibold">{section.title}</h3>
              {section.description ? (
                <RichTextContent className="mt-1 text-sm text-muted-foreground" value={section.description} />
              ) : null}
            </div>
            {section.questions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Вопросы еще не добавлены.</p>
            ) : (
              section.questions.map((question, index) => (
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
              ))
            )}
            {isPaged && onSectionChange ? (
              <div className="flex justify-between border-t pt-4">
                <Button
                  disabled={safeSectionIndex === 0}
                  onClick={() => onSectionChange(safeSectionIndex - 1)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Назад
                </Button>
                <Button
                  disabled={safeSectionIndex === sections.length - 1}
                  onClick={() => onSectionChange(safeSectionIndex + 1)}
                  size="sm"
                  type="button"
                >
                  Далее
                </Button>
              </div>
            ) : null}
          </section>
          );
        })
      )}
    </div>
  );
}
