"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { BuilderImportSource, BuilderSection } from "@/lib/tests/builder-data";
import type { BuilderImportAction } from "@/lib/tests/builder-import-contract";

export function BuilderImportPicker({ sources, templateId, versionId, loadAction, onImport }: {
  sources: BuilderImportSource[];
  templateId: string;
  versionId: string;
  loadAction: BuilderImportAction;
  onImport: (sections: BuilderSection[]) => void;
}) {
  const labelId = useId();
  const [sourceId, setSourceId] = useState(sources[0]?.versionId ?? "");
  const [state, setState] = useState<
    { status: "idle" | "loading" } | { status: "error"; message: string }
    | { status: "ready"; versionId: string; sections: BuilderSection[] }
  >({ status: "idle" });
  const requestId = useRef(0);
  const busy = useRef(false);
  useEffect(() => () => { requestId.current++; busy.current = false; }, []);

  async function load() {
    const source = sources.find(entry => entry.versionId === sourceId);
    if (!source || busy.current) return;
    const currentRequest = ++requestId.current;
    busy.current = true;
    setState({ status: "loading" });
    try {
      const result = await loadAction({ templateId, versionId,
        sourceTemplateId: source.templateId, sourceVersionId: source.versionId });
      if (requestId.current !== currentRequest) return;
      if (!result.ok) setState({ status: "error", message: result.error });
      else if (result.versionId !== source.versionId) throw new Error("Unexpected import source.");
      else setState({ status: "ready", versionId: result.versionId, sections: result.sections });
    } catch {
      if (requestId.current === currentRequest) setState({ status: "error", message: "Не удалось загрузить источник. Повторите попытку." });
    } finally {
      if (requestId.current === currentRequest) busy.current = false;
    }
  }

  if (sources.length === 0) return null;
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium" htmlFor={labelId}>Источник импорта</label>
      <div className="flex flex-wrap gap-2">
        <Select id={labelId} className="max-w-xs" value={sourceId} onChange={event => {
          requestId.current++;
          busy.current = false;
          setSourceId(event.target.value);
          setState({ status: "idle" });
        }}>
          {sources.map(source => <option key={source.versionId} value={source.versionId}>
            {source.templateTitle} / v{source.versionNumber} · вопросов: {source.questionCount}
          </option>)}
        </Select>
        <Button disabled={state.status === "loading"} onClick={() => void load()} type="button" variant="outline">
          {state.status === "loading" ? "Загрузка источника…" : state.status === "error" ? "Повторить загрузку" : "Загрузить источник"}
        </Button>
        <Button disabled={state.status !== "ready" || state.versionId !== sourceId || state.sections.length === 0}
          onClick={() => {
            if (busy.current || state.status !== "ready" || state.versionId !== sourceId) return;
            busy.current = true;
            onImport(state.sections);
            setState({ status: "idle" });
            // Prevent duplicate clicks before React commits the idle state.
            queueMicrotask(() => { busy.current = false; });
          }} type="button" variant="outline"><FileInput /> Импортировать секции</Button>
      </div>
      {state.status === "error" ? <p className="text-sm text-destructive" role="alert">{state.message}</p> : null}
      <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
        {state.status === "loading" ? "Загружаем выбранную версию. Можно продолжать редактировать черновик."
          : state.status === "ready" ? `Загружено секций: ${state.sections.length}. Импорт добавит их копии в черновик.`
          : "Содержимое загружается только по кнопке; загрузка не меняет черновик."}
      </p>
    </div>
  );
}
