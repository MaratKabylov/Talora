"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ProfileTarget } from "@/lib/scoring/profile-fit";

type TargetRow = ProfileTarget & { rowId: string };

function initialRows(domain: string, targets: ProfileTarget[]): TargetRow[] {
  return targets.map((target, index) => ({ ...target, rowId: `${domain}-${index}` }));
}

function TargetProfileEditor({
  disabled,
  domain,
  label,
  targets,
}: {
  disabled: boolean;
  domain: "behavior" | "motivation";
  label: string;
  targets: ProfileTarget[];
}) {
  const [rows, setRows] = useState(() => initialRows(domain, targets));

  function updateRow(rowId: string, field: keyof ProfileTarget, value: string) {
    setRows((current) => current.map((row) => {
      if (row.rowId !== rowId) return row;
      return {
        ...row,
        [field]: field === "dimension_id" ? value : Number(value),
      };
    }));
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        dimension_id: "",
        preferred_max: 100,
        preferred_min: 0,
        rowId: `${domain}-${Date.now()}-${current.length}`,
        weight: 1,
      },
    ]);
  }

  return (
    <fieldset className="space-y-4 rounded-lg border p-4" disabled={disabled}>
      <div>
        <legend className="font-medium">{label}</legend>
        <p className="mt-1 text-xs text-muted-foreground">
          ID dimension должен совпадать с ID шкалы опубликованного V2-теста.
        </p>
      </div>

      <input
        name={`${domain}TargetProfile`}
        type="hidden"
        value={JSON.stringify(rows.map((row) => ({
          dimension_id: row.dimension_id,
          preferred_max: row.preferred_max,
          preferred_min: row.preferred_min,
          weight: row.weight,
        })))}
      />

      {rows.length === 0 ? (
        <p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
          Целевой профиль не задан — соответствующий fit будет равен null.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div className="grid gap-3 rounded-md bg-muted/40 p-3 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]" key={row.rowId}>
              <div className="space-y-1.5">
                <Label htmlFor={`${row.rowId}-dimension`}>Dimension ID</Label>
                <Input
                  id={`${row.rowId}-dimension`}
                  onChange={(event) => updateRow(row.rowId, "dimension_id", event.target.value)}
                  pattern="[a-z][a-z0-9_-]{0,79}"
                  placeholder={domain === "motivation" ? "autonomy" : "planning"}
                  required
                  value={row.dimension_id}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${row.rowId}-min`}>Min, %</Label>
                <Input
                  id={`${row.rowId}-min`}
                  max="100"
                  min="0"
                  onChange={(event) => updateRow(row.rowId, "preferred_min", event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={row.preferred_min}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${row.rowId}-max`}>Max, %</Label>
                <Input
                  id={`${row.rowId}-max`}
                  max="100"
                  min="0"
                  onChange={(event) => updateRow(row.rowId, "preferred_max", event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={row.preferred_max}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${row.rowId}-weight`}>Вес</Label>
                <Input
                  id={`${row.rowId}-weight`}
                  max="100"
                  min="0.01"
                  onChange={(event) => updateRow(row.rowId, "weight", event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={row.weight}
                />
              </div>
              <div className="flex items-end">
                <Button
                  onClick={() => setRows((current) => current.filter((item) => item.rowId !== row.rowId))}
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

      {!disabled ? (
        <Button onClick={addRow} type="button" variant="outline">
          Добавить dimension
        </Button>
      ) : null}
    </fieldset>
  );
}

export function ProfileTargetFields({
  behaviorTargets = [],
  disabled = false,
  motivationTargets = [],
}: {
  behaviorTargets?: ProfileTarget[];
  disabled?: boolean;
  motivationTargets?: ProfileTarget[];
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <TargetProfileEditor
        disabled={disabled}
        domain="motivation"
        label="Motivation target profile"
        targets={motivationTargets}
      />
      <TargetProfileEditor
        disabled={disabled}
        domain="behavior"
        label="Behavior target profile"
        targets={behaviorTargets}
      />
    </div>
  );
}
