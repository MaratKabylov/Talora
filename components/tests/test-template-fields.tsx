import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { TestTemplate } from "@/lib/tests/data";

export function TestTemplateFields({
  disabled = false,
  template,
}: {
  disabled?: boolean;
  template?: Pick<TestTemplate, "category" | "description" | "title">;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="templateTitle">Название теста</Label>
        <Input
          defaultValue={template?.title ?? ""}
          disabled={disabled}
          id="templateTitle"
          name="templateTitle"
          placeholder="Например, Оценка клиентского сервиса"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="category">Категория</Label>
        <Input
          defaultValue={template?.category ?? ""}
          disabled={disabled}
          id="category"
          name="category"
          placeholder="Например, customer_service"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="templateDescription">Описание</Label>
        <Textarea
          defaultValue={template?.description ?? ""}
          disabled={disabled}
          id="templateDescription"
          name="templateDescription"
          placeholder="Для каких позиций и задач используется тест"
        />
      </div>
    </div>
  );
}
