"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { AssessmentCompositeConfig } from "@/lib/scoring/models/assessment-composite";

type ComponentRow = AssessmentCompositeConfig["components"][number] & { rowId: string };

export function CompositeScoringFields({
  config,
  disabled = false,
}: {
  config: AssessmentCompositeConfig | null;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<ComponentRow[]>(() =>
    (config?.components ?? []).map((component, index) => ({
      ...component,
      rowId: `composite-${index}`,
    })),
  );
  const [missingPolicy, setMissingPolicy] = useState<AssessmentCompositeConfig["missing_policy"]>(
    config?.missing_policy ?? "renormalize",
  );
  const [minRequired, setMinRequired] = useState(config?.min_required_components ?? 1);
  const serializedConfig = rows.length === 0
    ? null
    : {
        components: rows.map((row) => ({ source: row.source, weight: row.weight })),
        min_required_components: minRequired,
        missing_policy: missingPolicy,
        version: "1.0" as const,
      };

  return (
    <div className="space-y-5">
      <input name="compositeScoringConfig" type="hidden" value={JSON.stringify(serializedConfig)} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="compositeMissingPolicy">Если источник отсутствует</Label>
          <Select
            disabled={disabled || rows.length === 0}
            id="compositeMissingPolicy"
            onChange={(event) => setMissingPolicy(event.target.value as AssessmentCompositeConfig["missing_policy"])}
            value={missingPolicy}
          >
            <option value="renormalize">Исключить и пересчитать веса</option>
            <option value="fail">Не рассчитывать composite</option>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="compositeMinRequired">Минимум доступных компонентов</Label>
          <Input
            disabled={disabled || rows.length === 0}
            id="compositeMinRequired"
            max={Math.max(rows.length, 1)}
            min="1"
            onChange={(event) => setMinRequired(Number(event.target.value))}
            required
            step="1"
            type="number"
            value={minRequired}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
          Composite не настроен — composite score будет равен null.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div className="grid gap-3 rounded-md bg-muted/40 p-3 md:grid-cols-[minmax(0,3fr)_minmax(0,1fr)_auto]" key={row.rowId}>
              <div className="space-y-1.5">
                <Label htmlFor={`${row.rowId}-source`}>Источник</Label>
                <Input
                  disabled={disabled}
                  id={`${row.rowId}-source`}
                  onChange={(event) => setRows((current) => current.map((item) =>
                    item.rowId === row.rowId ? { ...item, source: event.target.value } : item,
                  ))}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9:_-]{0,119}"
                  placeholder="learning_final / leadership / motivation_fit"
                  required
                  value={row.source}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${row.rowId}-weight`}>Вес</Label>
                <Input
                  disabled={disabled}
                  id={`${row.rowId}-weight`}
                  max="100"
                  min="0.0001"
                  onChange={(event) => setRows((current) => current.map((item) =>
                    item.rowId === row.rowId ? { ...item, weight: Number(event.target.value) } : item,
                  ))}
                  required
                  step="0.0001"
                  type="number"
                  value={row.weight}
                />
              </div>
              <div className="flex items-end">
                <Button
                  disabled={disabled}
                  onClick={() => {
                    setRows((current) => current.filter((item) => item.rowId !== row.rowId));
                    setMinRequired((current) => Math.min(current, Math.max(rows.length - 1, 1)));
                  }}
                  type="button"
                  variant="outline"
                >
                  Удалить
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        {!disabled ? (
          <Button
            onClick={() => setRows((current) => [
              ...current,
              {
                rowId: `composite-${Date.now()}-${current.length}`,
                source: "",
                weight: 1,
              },
            ])}
            type="button"
            variant="outline"
          >
            Добавить компонент
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Доступны fit_score, motivation_fit, behavior_fit, overall_score, ID dimension или score,
          domain:&lt;domain&gt; и test:&lt;test_version_id&gt;.
        </p>
      </div>
    </div>
  );
}
