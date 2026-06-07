import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AssessmentPackage } from "@/lib/packages/data";

export function AssessmentPackageFields({
  assessmentPackage,
  disabled = false,
}: {
  assessmentPackage?: AssessmentPackage;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="title">Название пакета</Label>
        <Input
          defaultValue={assessmentPackage?.title ?? ""}
          disabled={disabled}
          id="title"
          name="title"
          placeholder="Например, Общий потенциал"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Описание</Label>
        <Textarea
          defaultValue={assessmentPackage?.description ?? ""}
          disabled={disabled}
          id="description"
          name="description"
          placeholder="Для каких ролей или внутренних оценок подходит этот пакет"
        />
      </div>
    </div>
  );
}
