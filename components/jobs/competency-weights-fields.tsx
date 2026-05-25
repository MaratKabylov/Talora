import { Input } from "@/components/ui/input";
import { COMPETENCIES } from "@/lib/jobs/constants";
import type { JobWeight } from "@/lib/jobs/data";

export function CompetencyWeightsFields({
  disabled = false,
  weights = [],
}: {
  disabled?: boolean;
  weights?: JobWeight[];
}) {
  const existingWeights = new Map(weights.map((weight) => [weight.competencyKey, weight]));
  const hasSavedWeights = weights.length > 0;

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Компетенция</th>
            <th className="w-32 px-4 py-3 font-medium">Вес, %</th>
            <th className="w-32 px-4 py-3 font-medium">Минимум, %</th>
            <th className="w-32 px-4 py-3 text-center font-medium">Обязательна</th>
          </tr>
        </thead>
        <tbody>
          {COMPETENCIES.map((competency) => {
            const savedWeight = existingWeights.get(competency.key);
            const defaultWeight = hasSavedWeights ? 0 : competency.defaultWeight;

            return (
              <tr className="border-t" key={competency.key}>
                <td className="px-4 py-3 font-medium">{competency.label}</td>
                <td className="px-4 py-2">
                  <Input
                    className="h-9"
                    defaultValue={savedWeight?.weightPercent ?? defaultWeight}
                    disabled={disabled}
                    max="100"
                    min="0"
                    name={`weight_${competency.key}`}
                    required
                    step="0.01"
                    type="number"
                  />
                </td>
                <td className="px-4 py-2">
                  <Input
                    className="h-9"
                    defaultValue={savedWeight?.minimumScore ?? ""}
                    disabled={disabled}
                    max="100"
                    min="0"
                    name={`minimum_${competency.key}`}
                    placeholder="Нет"
                    step="0.01"
                    type="number"
                  />
                </td>
                <td className="px-4 py-2 text-center">
                  <input
                    className="size-4 rounded border-input accent-primary"
                    defaultChecked={savedWeight?.isRequired ?? false}
                    disabled={disabled}
                    name={`required_${competency.key}`}
                    type="checkbox"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
