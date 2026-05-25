import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPE_VALUES,
  JOB_STATUS_LABELS,
  JOB_STATUS_VALUES,
} from "@/lib/jobs/constants";
import type { AssessmentPackageOption, JobDetails } from "@/lib/jobs/data";

export function JobDetailsFields({
  disabled = false,
  job,
  packages,
}: {
  disabled?: boolean;
  job?: JobDetails;
  packages: AssessmentPackageOption[];
}) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="title">Название вакансии</Label>
          <Input
            defaultValue={job?.title ?? ""}
            disabled={disabled}
            id="title"
            name="title"
            placeholder="Например, Менеджер по продажам"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="department">Отдел</Label>
          <Input
            defaultValue={job?.department ?? ""}
            disabled={disabled}
            id="department"
            name="department"
            placeholder="Коммерческий отдел"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="location">Локация</Label>
          <Input
            defaultValue={job?.location ?? ""}
            disabled={disabled}
            id="location"
            name="location"
            placeholder="Алматы / удаленно"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="employmentType">Формат занятости</Label>
          <Select
            defaultValue={job?.employmentType ?? ""}
            disabled={disabled}
            id="employmentType"
            name="employmentType"
          >
            <option value="">Не указан</option>
            {EMPLOYMENT_TYPE_VALUES.map((value) => (
              <option key={value} value={value}>
                {EMPLOYMENT_TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="status">Статус</Label>
          <Select
            defaultValue={job?.status ?? "draft"}
            disabled={disabled}
            id="status"
            name="status"
          >
            {JOB_STATUS_VALUES.map((value) => (
              <option key={value} value={value}>
                {JOB_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="assessmentPackageId">Пакет оценки</Label>
          <Select
            defaultValue={job?.assessmentPackageId ?? ""}
            disabled={disabled}
            id="assessmentPackageId"
            name="assessmentPackageId"
          >
            <option value="">Без пакета</option>
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
            defaultValue={job?.passingScore ?? ""}
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
          defaultValue={job?.description ?? ""}
          disabled={disabled}
          id="description"
          name="description"
          placeholder="Задачи, требования и контекст позиции"
        />
      </div>
    </div>
  );
}
