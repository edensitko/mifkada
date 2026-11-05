import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { api, type SearchHit } from "../api";
import { pick } from "../i18n";
import { Spinner } from "./Spinner";

/** חיפוש טקסט בפרויקט (ripgrep), תוצאות לפי קובץ. */
export default function SearchPanel({ cwd, onOpen, autoFocus }: { cwd: string; onOpen: (path: string, line: number) => void; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const id = setTimeout(() => {
      setBusy(true);
      api
        .fsSearch(cwd, q)
        .then(setHits)
        .catch(() => setHits([]))
        .finally(() => setBusy(false));
    }, 250);
    return () => clearTimeout(id);
  }, [q, cwd]);

  const grouped = useMemo(() => {
    const m = new Map<string, SearchHit[]>();
    for (const h of hits) m.set(h.path, [...(m.get(h.path) ?? []), h]);
    return [...m.entries()];
  }, [hits]);

  return (
    <div className="h-full flex flex-col">
      <label dir={pick("rtl", "ltr")} className="flex items-center gap-2 m-2 rounded-lg bg-surface border px-2 py-1.5 text-sm focus-within:border-blue/60">
        {busy ? <Spinner className="size-4 text-muted" /> : <Search className="size-4 text-muted" />}
        <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder={pick("חיפוש בקבצי הפרויקט", "Search project files")} className="flex-1 bg-transparent outline-none ltr text-left" />
      </label>
      <div className="flex-1 overflow-y-auto px-1 pb-2 text-[12px]" dir="ltr">
        {grouped.map(([path, list]) => (
          <div key={path} className="mb-1.5">
            <div className="px-2 py-0.5 text-muted truncate font-medium">{path}</div>
            {list.map((h) => (
              <button key={`${h.path}:${h.line}`} onClick={() => onOpen(h.path, h.line)} className="w-full text-left px-2 py-0.5 rounded hover:bg-surface-2/70 flex gap-2">
                <span className="tabular text-muted w-8 shrink-0 text-right">{h.line}</span>
                <span className="truncate mono">{h.text.trim()}</span>
              </button>
            ))}
          </div>
        ))}
        {q.trim().length >= 2 && !busy && hits.length === 0 && (
          <div dir={pick("rtl", "ltr")} className="p-3 text-muted">
            {pick("אין תוצאות", "No results")}
          </div>
        )}
      </div>
    </div>
  );
}
