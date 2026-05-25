import {
  QUESTION_TYPE_LABELS,
  TEST_COMPETENCY_LABELS,
} from "@/lib/tests/builder-constants";
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
          <span>{option.text}</span>
        </label>
      ))}
    </div>
  );
}

export function TestPreview({
  sections,
  version,
}: {
  sections: BuilderSection[];
  version: TestVersion;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-background p-5">
        <h2 className="text-xl font-semibold">{version.title}</h2>
        {version.description ? (
          <p className="mt-2 text-sm text-muted-foreground">{version.description}</p>
        ) : null}
        {version.instructions ? (
          <div className="mt-4 rounded-md bg-muted/50 p-4 text-sm">{version.instructions}</div>
        ) : null}
      </div>

      {sections.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          В этой версии пока нет секций и вопросов.
        </p>
      ) : (
        sections.map((section) => (
          <section className="space-y-4 rounded-lg border bg-background p-5" key={section.id}>
            <div>
              <h3 className="font-semibold">{section.title}</h3>
              {section.description ? (
                <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
              ) : null}
            </div>
            {section.questions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Вопросы еще не добавлены.</p>
            ) : (
              section.questions.map((question, index) => (
                <div className="space-y-3 border-t pt-4 first:border-0 first:pt-0" key={question.id}>
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="text-sm font-medium">
                      {index + 1}. {question.text}
                    </p>
                    <span className="text-xs text-muted-foreground">
                      {QUESTION_TYPE_LABELS[question.questionType]}
                      {question.competencyKey
                        ? ` / ${TEST_COMPETENCY_LABELS[question.competencyKey]}`
                        : ""}
                    </span>
                  </div>
                  {question.description ? (
                    <p className="text-sm text-muted-foreground">{question.description}</p>
                  ) : null}
                  <QuestionInputPreview question={question} />
                </div>
              ))
            )}
          </section>
        ))
      )}
    </div>
  );
}
