import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BuilderSection } from "@/lib/tests/builder-data";

export function SectionFields({
  defaultOrderIndex = 0,
  prefix,
  section,
}: {
  defaultOrderIndex?: number;
  prefix: string;
  section?: BuilderSection;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${prefix}-title`}>Название секции</Label>
        <Input
          defaultValue={section?.title ?? ""}
          id={`${prefix}-title`}
          name="sectionTitle"
          placeholder="Например, Работа с возражениями"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-order`}>Порядок</Label>
        <Input
          defaultValue={section?.orderIndex ?? defaultOrderIndex}
          id={`${prefix}-order`}
          min="0"
          name="sectionOrderIndex"
          required
          step="1"
          type="number"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-time`}>Лимит времени, минут</Label>
        <Input
          defaultValue={section?.timeLimitMinutes ?? ""}
          id={`${prefix}-time`}
          min="1"
          name="sectionTimeLimitMinutes"
          placeholder="Без ограничения"
          step="1"
          type="number"
        />
      </div>
      <div className="space-y-2 sm:col-span-2">
        <Label htmlFor={`${prefix}-description`}>Описание</Label>
        <Textarea
          defaultValue={section?.description ?? ""}
          id={`${prefix}-description`}
          name="sectionDescription"
          placeholder="Краткая инструкция для этой части теста"
        />
      </div>
    </div>
  );
}
