import { Input } from "@/components/ui/input";
import { FIT_COMPETENCIES } from "@/lib/jobs/constants";
import type { CompetencyRequirement } from "@/lib/jobs/data";

export function CompetencyRequirementsFields({
  disabled = false,
  requirements = [],
}: {
  disabled?: boolean;
  requirements?: CompetencyRequirement[];
}) {
  const existingRequirements = new Map(
    requirements.map((requirement) => [requirement.competencyKey, requirement]),
  );

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Компетенция</th>
            <th className="w-32 px-4 py-3 font-medium">Минимум, %</th>
            <th className="w-32 px-4 py-3 text-center font-medium">Обязательна</th>
          </tr>
        </thead>
        <tbody>
          {FIT_COMPETENCIES.map((competency) => {
            const savedRequirement = existingRequirements.get(competency.key);

            return (
              <tr className="border-t" key={competency.key}>
                <td className="px-4 py-3 font-medium">{competency.label}</td>
                <td className="px-4 py-2">
                  <Input
                    className="h-9"
                    defaultValue={savedRequirement?.minimumScore ?? ""}
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
                    defaultChecked={savedRequirement?.isRequired ?? false}
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
