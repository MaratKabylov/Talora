import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { TEST_COMPETENCIES } from "@/lib/tests/builder-constants";
import type { BuilderOption } from "@/lib/tests/builder-data";

export function AnswerOptionFields({
  defaultOrderIndex = 0,
  option,
  prefix,
}: {
  defaultOrderIndex?: number;
  option?: BuilderOption;
  prefix: string;
}) {
  const competencyEffect = Object.entries(option?.competencyEffects ?? {})[0];

  return (
    <div className="grid gap-3 md:grid-cols-6">
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor={`${prefix}-text`}>Вариант ответа</Label>
        <Input
          defaultValue={option?.text ?? ""}
          id={`${prefix}-text`}
          name="optionText"
          placeholder="Текст варианта"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-points`}>Баллы</Label>
        <Input
          defaultValue={option?.points ?? 0}
          id={`${prefix}-points`}
          min="0"
          name="optionPoints"
          step="0.01"
          type="number"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-order`}>Порядок</Label>
        <Input
          defaultValue={option?.orderIndex ?? defaultOrderIndex}
          id={`${prefix}-order`}
          min="0"
          name="optionOrderIndex"
          step="1"
          type="number"
        />
      </div>
      <div className="flex items-end pb-2">
        <label className="flex items-center gap-2 text-sm" htmlFor={`${prefix}-correct`}>
          <input
            className="size-4 rounded border-input accent-primary"
            defaultChecked={option?.isCorrect ?? false}
            id={`${prefix}-correct`}
            name="isCorrect"
            type="checkbox"
          />
          Верный
        </label>
      </div>
      <div className="space-y-2 md:col-span-3">
        <Label htmlFor={`${prefix}-effect-key`}>Эффект компетенции</Label>
        <Select
          defaultValue={competencyEffect?.[0] ?? ""}
          id={`${prefix}-effect-key`}
          name="effectCompetencyKey"
        >
          <option value="">Без эффекта</option>
          {TEST_COMPETENCIES.map((competency) => (
            <option key={competency.key} value={competency.key}>
              {competency.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-effect-value`}>Значение</Label>
        <Input
          defaultValue={competencyEffect?.[1] ?? ""}
          id={`${prefix}-effect-value`}
          name="effectValue"
          placeholder="Напр. 2"
          step="0.01"
          type="number"
        />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor={`${prefix}-explanation`}>Комментарий</Label>
        <Input
          defaultValue={option?.explanation ?? ""}
          id={`${prefix}-explanation`}
          name="optionExplanation"
          placeholder="Пояснение для HR"
        />
      </div>
    </div>
  );
}
