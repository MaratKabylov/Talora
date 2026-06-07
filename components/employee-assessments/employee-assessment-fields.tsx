import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  EMPLOYEE_ASSESSMENT_STATUS_LABELS,
  EMPLOYEE_ASSESSMENT_STATUS_VALUES,
} from "@/lib/employee-assessments/constants";
import type {
  AssessmentPackageOption,
  EmployeeAssessmentDetails,
} from "@/lib/employee-assessments/data";

export function EmployeeAssessmentFields({
  assessment,
  disabled = false,
  packages,
}: {
  assessment?: EmployeeAssessmentDetails;
  disabled?: boolean;
  packages: AssessmentPackageOption[];
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="title">Название оценки</Label>
          <Input
            defaultValue={assessment?.title ?? ""}
            disabled={disabled}
            id="title"
            name="title"
            placeholder="Например, Квартальная оценка отдела продаж"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Статус</Label>
          <Select
            defaultValue={assessment?.status ?? "draft"}
            disabled={disabled}
            id="status"
            name="status"
          >
            {EMPLOYEE_ASSESSMENT_STATUS_VALUES.map((value) => (
              <option key={value} value={value}>
                {EMPLOYEE_ASSESSMENT_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="assessmentPackageId">Пакет оценки</Label>
          <Select
            defaultValue={assessment?.assessmentPackageId ?? ""}
            disabled={disabled}
            id="assessmentPackageId"
            name="assessmentPackageId"
            required
          >
            <option value="">Выберите пакет</option>
            {packages.map((assessmentPackage) => (
              <option key={assessmentPackage.id} value={assessmentPackage.id}>
                {assessmentPackage.title}
                {assessmentPackage.isSystem ? " (системный)" : ""}
              </option>
            ))}
          </Select>
          {packages.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Пакеты появятся после настройки библиотеки тестов.
            </p>
          ) : null}
        </div>
        <div className="space-y-2">
          <Label htmlFor="passingScore">Проходной балл, %</Label>
          <Input
            defaultValue={assessment?.passingScore ?? ""}
            disabled={disabled}
            id="passingScore"
            max="100"
            min="0"
            name="passingScore"
            placeholder="Например, 65"
            step="0.01"
            type="number"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="description">Описание</Label>
        <Textarea
          defaultValue={assessment?.description ?? ""}
          disabled={disabled}
          id="description"
          name="description"
          placeholder="Контекст оценки, период, участники или цель"
        />
      </div>
    </div>
  );
}
