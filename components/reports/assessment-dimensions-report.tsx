import type {
  AssessmentDimensionGroup,
  AssessmentDimensionResult,
  AssessmentHighlight,
  AssessmentReportGroup,
} from "@/lib/assessment-results/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function dimensionColumnTitle(group: AssessmentReportGroup) {
  if (group === "cognitive") return "Показатель";
  if (group === "work_competencies") return "Компетенция";
  if (group === "motivation") return "Фактор";
  if (group === "personality" || group === "behavior") return "Шкала";
  return "Измерение";
}

function valueColumnTitle(group: AssessmentReportGroup) {
  return group === "motivation" || group === "personality" || group === "behavior"
    ? "Выраженность"
    : "Результат";
}

function formatDimensionValue(dimension: AssessmentDimensionResult) {
  if (dimension.normalizedScore !== null) {
    return `${dimension.normalizedScore.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
  }
  if (dimension.score !== null) {
    return dimension.score.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  }
  return "—";
}

function thresholdLabel(dimension: AssessmentDimensionResult) {
  if (!dimension.threshold) {
    if (dimension.valueStatus === "insufficient_data") return "Недостаточно данных";
    if (dimension.valueStatus === "requires_review") return "Требуется проверка";
    if (dimension.valueStatus === "not_applicable") return "Не применимо";
    return null;
  }
  const value = dimension.threshold.value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  if (dimension.threshold.kind === "test_passing_score") {
    return dimension.threshold.status === "passed"
      ? `Проходной балл достигнут (≥ ${value}%)`
      : `Ниже проходного балла (${value}%)`;
  }
  return dimension.threshold.status === "passed"
    ? `Обязательный минимум выполнен (≥ ${value}%)`
    : `Ниже обязательного минимума (${value}%)`;
}

function normMetricLabel(metric: NonNullable<AssessmentDimensionResult["norm"]>["metric"]) {
  if (metric === "percentile") return "Процентиль";
  if (metric === "sten") return "STEN";
  return "z";
}

function formatNorm(dimension: AssessmentDimensionResult) {
  if (!dimension.norm) return null;
  const value = dimension.norm.value.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  return `${normMetricLabel(dimension.norm.metric)}: ${value}`;
}

function profileDescription(group: AssessmentReportGroup) {
  if (group === "motivation") {
    return "Высокий результат означает более выраженный мотиватор, а не «хорошую» мотивацию. Низкий результат показывает меньший относительный приоритет и не является недостатком.";
  }
  if (group === "personality" || group === "behavior") {
    return "Шкалы описывают выраженность профиля и сами по себе не делятся на хорошие и плохие.";
  }
  return null;
}

export function AssessmentHighlights({ highlights }: { highlights: AssessmentHighlight[] }) {
  if (highlights.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ключевые результаты</CardTitle>
        <CardDescription>Краткая сводка по рассчитанным измерениям.</CardDescription>
      </CardHeader>
      <CardContent className="pt-6">
        <ul className="grid gap-3 md:grid-cols-2">
          {highlights.map((highlight, index) => (
            <li className="rounded-lg border bg-muted/30 p-4 text-sm" key={`${highlight.group}-${index}`}>
              <p className="font-medium">{highlight.title}</p>
              <p className="mt-1 text-muted-foreground">{highlight.text}</p>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function AssessmentDimensionGroups({ groups }: { groups: AssessmentDimensionGroup[] }) {
  if (groups.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Результаты оценки</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          Измерения появятся после завершения тестов и расчёта результатов.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {groups.map((group) => {
        const description = profileDescription(group.key);
        const showStatus = group.dimensions.some(
          (dimension) => dimension.threshold !== null || dimension.valueStatus !== "available",
        );
        const showNorm = group.dimensions.some((dimension) => dimension.norm !== null);
        return (
          <Card key={group.key}>
            <CardHeader>
              <CardTitle>{group.title}</CardTitle>
              {description ? <CardDescription>{description}</CardDescription> : null}
            </CardHeader>
            <CardContent className="pt-6">
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">{dimensionColumnTitle(group.key)}</th>
                      <th className="px-4 py-3 font-medium">{valueColumnTitle(group.key)}</th>
                      {showNorm ? <th className="px-4 py-3 font-medium">Норма</th> : null}
                      {showStatus ? <th className="px-4 py-3 font-medium">Статус</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {group.dimensions.map((dimension) => (
                      <tr className="border-t" key={dimension.id}>
                        <td className="px-4 py-3 font-medium">
                          <span>{dimension.title}</span>
                          {dimension.testTitle ? (
                            <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                              {dimension.testTitle}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <span>{formatDimensionValue(dimension)}</span>
                          {dimension.interpretation ? (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {dimension.interpretation.label}
                            </span>
                          ) : null}
                        </td>
                        {showNorm ? (
                          <td className="px-4 py-3 text-muted-foreground">
                            <span>{formatNorm(dimension) ?? "—"}</span>
                            {dimension.norm?.populationLabel ? (
                              <span className="mt-0.5 block text-xs">
                                Нормативная группа: {dimension.norm.populationLabel}
                              </span>
                            ) : null}
                          </td>
                        ) : null}
                        {showStatus ? (
                          <td
                            className={
                              dimension.threshold?.status === "failed"
                                ? "px-4 py-3 text-destructive"
                                : "px-4 py-3 text-muted-foreground"
                            }
                          >
                            {thresholdLabel(dimension) ?? "—"}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function AssessmentDimensionsReport({
  groups,
  highlights,
}: {
  groups: AssessmentDimensionGroup[];
  highlights: AssessmentHighlight[];
}) {
  return (
    <>
      <AssessmentHighlights highlights={highlights} />
      <AssessmentDimensionGroups groups={groups} />
    </>
  );
}
