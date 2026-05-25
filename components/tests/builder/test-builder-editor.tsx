import { AnswerOptionFields } from "@/components/tests/builder/answer-option-fields";
import { QuestionFields } from "@/components/tests/builder/question-fields";
import { SectionFields } from "@/components/tests/builder/section-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createAnswerOptionAction,
  createQuestionAction,
  createSectionAction,
  deleteAnswerOptionAction,
  deleteQuestionAction,
  deleteSectionAction,
  updateAnswerOptionAction,
  updateQuestionAction,
  updateSectionAction,
} from "@/lib/tests/builder-actions";
import type { BuilderSection } from "@/lib/tests/builder-data";

function HiddenContext({
  sectionId,
  templateId,
  versionId,
}: {
  sectionId?: string;
  templateId: string;
  versionId: string;
}) {
  return (
    <>
      <input name="templateId" type="hidden" value={templateId} />
      <input name="versionId" type="hidden" value={versionId} />
      {sectionId ? <input name="sectionId" type="hidden" value={sectionId} /> : null}
    </>
  );
}

export function TestBuilderEditor({
  sections,
  templateId,
  versionId,
}: {
  sections: BuilderSection[];
  templateId: string;
  versionId: string;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Новая секция</CardTitle>
          <CardDescription>Сгруппируйте вопросы в логические этапы прохождения.</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form action={createSectionAction} className="space-y-4">
            <HiddenContext templateId={templateId} versionId={versionId} />
            <SectionFields defaultOrderIndex={sections.length + 1} prefix="new-section" />
            <Button type="submit">Добавить секцию</Button>
          </form>
        </CardContent>
      </Card>

      {sections.map((section) => (
        <Card key={section.id}>
          <CardHeader>
            <CardTitle>{section.title}</CardTitle>
            <CardDescription>
              {section.questions.length} вопросов / порядок {section.orderIndex}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8 pt-6">
            <div className="rounded-lg border bg-muted/20 p-4">
              <form action={updateSectionAction} className="space-y-4">
                <HiddenContext
                  sectionId={section.id}
                  templateId={templateId}
                  versionId={versionId}
                />
                <SectionFields prefix={`section-${section.id}`} section={section} />
                <Button size="sm" type="submit" variant="outline">
                  Сохранить секцию
                </Button>
              </form>
              <form action={deleteSectionAction} className="mt-3">
                <HiddenContext
                  sectionId={section.id}
                  templateId={templateId}
                  versionId={versionId}
                />
                <Button size="sm" type="submit" variant="ghost">
                  Удалить секцию
                </Button>
              </form>
            </div>

            {section.questions.map((question) => (
              <div className="space-y-5 rounded-lg border p-4" key={question.id}>
                <form action={updateQuestionAction} className="space-y-4">
                  <HiddenContext
                    sectionId={section.id}
                    templateId={templateId}
                    versionId={versionId}
                  />
                  <input name="questionId" type="hidden" value={question.id} />
                  <QuestionFields prefix={`question-${question.id}`} question={question} />
                  <Button size="sm" type="submit" variant="outline">
                    Сохранить вопрос
                  </Button>
                </form>
                <form action={deleteQuestionAction}>
                  <HiddenContext
                    sectionId={section.id}
                    templateId={templateId}
                    versionId={versionId}
                  />
                  <input name="questionId" type="hidden" value={question.id} />
                  <Button size="sm" type="submit" variant="ghost">
                    Удалить вопрос
                  </Button>
                </form>

                <div className="space-y-4 border-t pt-4">
                  <div>
                    <p className="text-sm font-medium">Варианты ответа</p>
                    <p className="text-xs text-muted-foreground">
                      Используйте варианты для выбора, сортировки и сопоставления. Эффект
                      компетенции сохраняется в профиле результата.
                    </p>
                  </div>
                  {question.options.map((option) => (
                    <div className="rounded-md border bg-muted/20 p-3" key={option.id}>
                      <form action={updateAnswerOptionAction} className="space-y-3">
                        <HiddenContext
                          sectionId={section.id}
                          templateId={templateId}
                          versionId={versionId}
                        />
                        <input name="questionId" type="hidden" value={question.id} />
                        <input name="optionId" type="hidden" value={option.id} />
                        <AnswerOptionFields option={option} prefix={`option-${option.id}`} />
                        <Button size="sm" type="submit" variant="outline">
                          Сохранить вариант
                        </Button>
                      </form>
                      <form action={deleteAnswerOptionAction} className="mt-2">
                        <HiddenContext
                          sectionId={section.id}
                          templateId={templateId}
                          versionId={versionId}
                        />
                        <input name="questionId" type="hidden" value={question.id} />
                        <input name="optionId" type="hidden" value={option.id} />
                        <Button size="sm" type="submit" variant="ghost">
                          Удалить вариант
                        </Button>
                      </form>
                    </div>
                  ))}
                  <form action={createAnswerOptionAction} className="space-y-3 rounded-md border border-dashed p-3">
                    <HiddenContext
                      sectionId={section.id}
                      templateId={templateId}
                      versionId={versionId}
                    />
                    <input name="questionId" type="hidden" value={question.id} />
                    <AnswerOptionFields
                      defaultOrderIndex={question.options.length + 1}
                      prefix={`new-option-${question.id}`}
                    />
                    <Button size="sm" type="submit">
                      Добавить вариант
                    </Button>
                  </form>
                </div>
              </div>
            ))}

            <div className="rounded-lg border border-dashed p-4">
              <p className="mb-4 font-medium">Новый вопрос</p>
              <form action={createQuestionAction} className="space-y-4">
                <HiddenContext
                  sectionId={section.id}
                  templateId={templateId}
                  versionId={versionId}
                />
                <QuestionFields
                  defaultOrderIndex={section.questions.length + 1}
                  prefix={`new-question-${section.id}`}
                />
                <Button type="submit">Добавить вопрос</Button>
              </form>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
