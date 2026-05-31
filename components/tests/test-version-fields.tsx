import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SCORING_TYPE_LABELS, SCORING_TYPE_VALUES } from "@/lib/tests/constants";
import type { TestTemplate, TestVersion } from "@/lib/tests/data";
import { formatTestVersionTitle } from "@/lib/tests/version-title";

export function TestVersionFields({
  disabled = false,
  template,
  version,
  versionNumber = 1,
}: {
  disabled?: boolean;
  template?: Pick<TestTemplate, "description" | "title">;
  version?: TestVersion;
  versionNumber?: number;
}) {
  const generatedTitle = formatTestVersionTitle(version?.versionNumber ?? versionNumber);
  const title = disabled ? (version?.title ?? generatedTitle) : generatedTitle;

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="versionTitle">Название версии</Label>
          <Input
            aria-readonly={!disabled}
            className={!disabled ? "bg-muted/40" : undefined}
            defaultValue={title}
            disabled={disabled}
            id="versionTitle"
            name="versionTitle"
            placeholder="Название, которое увидит кандидат"
            readOnly={!disabled}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="durationMinutes">Длительность, минут</Label>
          <Input
            defaultValue={version?.durationMinutes ?? ""}
            disabled={disabled}
            id="durationMinutes"
            max="1440"
            min="1"
            name="durationMinutes"
            placeholder="Например, 20"
            step="1"
            type="number"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="scoringType">Тип оценки</Label>
          <Select
            defaultValue={version?.scoringType ?? "points"}
            disabled={disabled}
            id="scoringType"
            name="scoringType"
          >
            {SCORING_TYPE_VALUES.map((value) => (
              <option key={value} value={value}>
                {SCORING_TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="versionDescription">Описание версии</Label>
        <Textarea
          defaultValue={version?.description ?? template?.description ?? ""}
          disabled={disabled}
          id="versionDescription"
          name="versionDescription"
          placeholder="Краткое пояснение для этой версии"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="instructions">Инструкция кандидату</Label>
        <Textarea
          defaultValue={version?.instructions ?? ""}
          disabled={disabled}
          id="instructions"
          name="instructions"
          placeholder="Как проходить тест и сколько времени потребуется"
        />
      </div>
    </div>
  );
}
