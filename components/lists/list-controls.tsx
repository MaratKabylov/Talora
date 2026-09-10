import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { normalizeListParams, type ListParams } from "@/lib/lists/pagination";

export function ListControls({ path, params, nextCursor, hasCursor, count, search, statuses, company, review, kind }: {
  path: string; params: ListParams; nextCursor: string | null; hasCursor: boolean; count: number;
  search?: string; statuses?: Record<string, string>; company?: boolean; review?: boolean; kind?: boolean;
}) {
  const state = normalizeListParams(params);
  const url = (cursor?: string) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(state)) {
      if (value !== "" && value !== false) query.set(key, String(value));
    }
    if (cursor) query.set("cursor", cursor);
    return `${path}?${query}`;
  };
  return <div className="space-y-3">
    <form action={path} className="flex flex-wrap items-center gap-3">
      {search ? <Input aria-label={search} className="max-w-xs" defaultValue={state.q} name="q" placeholder={search} /> : null}
      {statuses ? <Select aria-label="Статус" className="w-auto" defaultValue={state.status} name="status">
        <option value="">Все статусы</option>
        {Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select> : null}
      {company ? <Input aria-label="UUID компании" className="max-w-xs" defaultValue={state.company} name="company" placeholder="UUID компании" /> : null}
      {review ? <label className="flex items-center gap-2 text-sm"><input defaultChecked={state.review} name="review" type="checkbox" value="true" />Нужна проверка</label> : null}
      {kind ? <Select aria-label="Источник" className="w-auto" defaultValue={state.kind} name="kind"><option value="">Все источники</option><option value="system">Системные</option><option value="company">Компании</option></Select> : null}
      <Select aria-label="Порядок по дате" className="w-auto" defaultValue={state.sort} name="sort">
        <option value="date_desc">Сначала новые</option><option value="date_asc">Сначала старые</option>
      </Select>
      <Select aria-label="Размер страницы" className="w-auto" defaultValue={String(state.pageSize)} name="pageSize">
        {[...new Set([25, 50, 100, state.pageSize])].sort((a, b) => a - b).map(size => <option key={size} value={size}>{size} на странице</option>)}
      </Select>
      <button className={buttonVariants({ variant: "outline" })} type="submit">Применить</button>
    </form>
    <nav aria-label="Страницы списка" className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted-foreground">На странице: {count}{count === 0 ? " · Нет результатов" : ""}</span>
      {hasCursor ? <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={url()}>В начало</Link> : null}
      {nextCursor ? <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={url(nextCursor)}>Следующая страница</Link> : null}
    </nav>
  </div>;
}
