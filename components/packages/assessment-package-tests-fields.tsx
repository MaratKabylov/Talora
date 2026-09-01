import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type {
  AssessmentPackageTest,
  PublishedTestVersionOption,
} from "@/lib/packages/data";
import { contributesToOverallByDefault } from "@/lib/packages/overall-contribution";

function formatDuration(value: number | null) {
  return value ? `${value} мин.` : "-";
}

export function AssessmentPackageTestsFields({
  availableVersions,
  disabled = false,
  emptyText = "Нет опубликованных тестов, доступных этой компании. Опубликуйте тест или включите доступ к системным тестам.",
  selectedTests = [],
}: {
  availableVersions: PublishedTestVersionOption[];
  disabled?: boolean;
  emptyText?: string;
  selectedTests?: AssessmentPackageTest[];
}) {
  const selectedByVersion = new Map(selectedTests.map((test) => [test.testVersionId, test]));

  if (availableVersions.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="min-w-[1080px] w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="w-24 px-4 py-3 text-center font-medium">Включить</th>
            <th className="px-4 py-3 font-medium">Тест</th>
            <th className="w-28 px-4 py-3 font-medium">Порядок</th>
            <th className="w-32 px-4 py-3 font-medium">Вес, %</th>
            <th className="w-32 px-4 py-3 text-center font-medium">В overall</th>
            <th className="w-32 px-4 py-3 font-medium">Проходной, %</th>
            <th className="w-32 px-4 py-3 text-center font-medium">Обязателен</th>
          </tr>
        </thead>
        <tbody>
          {availableVersions.map((version, index) => {
            const selected = selectedByVersion.get(version.versionId);
            const inputSuffix = version.versionId;

            return (
              <tr className="border-t align-top" key={version.versionId}>
                <td className="px-4 py-3 text-center">
                  <input name="testVersionId" type="hidden" value={version.versionId} />
                  <input
                    className="size-4 rounded border-input accent-primary"
                    defaultChecked={Boolean(selected)}
                    disabled={disabled}
                    name={`include_${inputSuffix}`}
                    type="checkbox"
                  />
                </td>
                <td className="px-4 py-3">
                  <p className="font-medium">{version.templateTitle}</p>
                  <p className="text-muted-foreground">
                    {version.versionTitle} / v{version.versionNumber} / {formatDuration(version.durationMinutes)}
                    {version.isSystem ? " / системный" : ""}
                  </p>
                  {version.resultShape ? (
                    <p className="text-xs text-muted-foreground">
                      Формат результата: {version.resultShape}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-2">
                  <Input
                    className="h-9"
                    defaultValue={selected?.orderIndex ?? index}
                    disabled={disabled}
                    min="0"
                    name={`order_${inputSuffix}`}
                    step="1"
                    type="number"
                  />
                </td>
                <td className="px-4 py-2">
                  <Input
                    className="h-9"
                    defaultValue={selected?.weightPercent ?? ""}
                    disabled={disabled}
                    max="100"
                    min="0"
                    name={`weight_${inputSuffix}`}
                    placeholder="0"
                    step="0.01"
                    type="number"
                  />
                </td>
                <td className="px-4 py-2">
                  <Select
                    className="h-9"
                    defaultValue={
                      selected
                        ? String(selected.contributesToOverall)
                        : version.resultShape === "hybrid"
                          ? ""
                          : String(contributesToOverallByDefault(version))
                    }
                    disabled={disabled}
                    name={`overall_${inputSuffix}`}
                    required
                    title="Участвует в расчёте общего балла"
                  >
                    <option disabled value="">
                      Выберите
                    </option>
                    <option value="true">Участвует</option>
                    <option value="false">Не участвует</option>
                  </Select>
                </td>
                <td className="px-4 py-2">
                  <Input
                    className="h-9"
                    defaultValue={selected?.passingScore ?? ""}
                    disabled={disabled}
                    max="100"
                    min="0"
                    name={`passing_${inputSuffix}`}
                    placeholder="Нет"
                    step="0.01"
                    type="number"
                  />
                </td>
                <td className="px-4 py-3 text-center">
                  <input
                    className="size-4 rounded border-input accent-primary"
                    defaultChecked={selected?.isRequired ?? true}
                    disabled={disabled}
                    name={`required_${inputSuffix}`}
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

export function AssessmentPackageTestsSummary({
  tests,
}: {
  tests: AssessmentPackageTest[];
}) {
  if (tests.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        В пакете пока нет тестов.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Тест</th>
            <th className="px-4 py-3 font-medium">Порядок</th>
            <th className="px-4 py-3 font-medium">Вес</th>
            <th className="px-4 py-3 font-medium">Overall</th>
            <th className="px-4 py-3 font-medium">Проходной</th>
            <th className="px-4 py-3 font-medium">Обязателен</th>
          </tr>
        </thead>
        <tbody>
          {tests.map((test) => (
            <tr className="border-t" key={test.id}>
              <td className="px-4 py-3">
                <p className="font-medium">{test.templateTitle}</p>
                <p className="text-muted-foreground">
                  {test.versionTitle} / v{test.versionNumber} / {formatDuration(test.durationMinutes)}
                </p>
              </td>
              <td className="px-4 py-3">{test.orderIndex}</td>
              <td className="px-4 py-3">{test.weightPercent}%</td>
              <td className="px-4 py-3">
                {test.contributesToOverall ? "Участвует" : "Не участвует в общем балле"}
              </td>
              <td className="px-4 py-3">{test.passingScore === null ? "-" : `${test.passingScore}%`}</td>
              <td className="px-4 py-3">{test.isRequired ? "Да" : "Нет"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
