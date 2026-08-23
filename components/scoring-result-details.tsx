import type { ReportScoringDetails } from "@/lib/reports/scoring-details";

function percent(value: number | null) {
  return value === null
    ? "Нет данных"
    : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

function milliseconds(value: number | null) {
  return value === null
    ? "Нет данных"
    : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} мс`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 p-3 text-sm">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

export function ScoringResultDetails({ details }: { details: ReportScoringDetails | null }) {
  if (!details) return null;

  return (
    <div className="space-y-4">
      {details.interpretation ? (
        <p className="rounded-md border px-3 py-2 text-sm">
          Уровень: <span className="font-medium">{details.interpretation.label}</span>
        </p>
      ) : null}

      {details.learning ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Обучаемость</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Первичный результат" value={percent(details.learning.initial_score)} />
            <Metric label="Recovery" value={percent(details.learning.recovery_rate)} />
            <Metric label="Learning gain" value={percent(details.learning.learning_gain)} />
            <Metric label="Итог" value={percent(details.learning.final_score)} />
          </div>
        </section>
      ) : null}

      {details.attention ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Внимание</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Точность" value={percent(details.attention.accuracy)} />
            <Metric label="Ошибки" value={String(details.attention.incorrect_count)} />
            <Metric label="Пропуски" value={String(details.attention.omitted_count)} />
            <Metric label="Завершённость" value={percent(details.attention.completion_rate)} />
            <Metric
              label="Медианное время"
              value={milliseconds(details.attention.median_response_time_ms)}
            />
            <Metric
              label="Среднее время"
              value={milliseconds(details.attention.mean_response_time_ms)}
            />
          </div>
        </section>
      ) : null}

      {details.dimensions.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Профиль измерений</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {details.dimensions.map((dimension) => (
              <div className="rounded-md bg-muted/50 p-3 text-sm" key={dimension.id}>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium">{dimension.id}</p>
                  <p className="text-muted-foreground">
                    {dimension.status === "ok"
                      ? percent(dimension.normalizedScore)
                      : "Недостаточно данных"}
                  </p>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ответов: {dimension.answeredItems} из {dimension.eligibleItems}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
