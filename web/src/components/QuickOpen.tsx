import { useEffect, useMemo, useRef, useState } from "react";
import { File, Search } from "lucide-react";
import { api } from "../api";
import { cn } from "../lib/util";
import { pick } from "../i18n";

/** ⌘P: פתיחת קובץ לפי שם, התאמה מטושטשת פשוטה. */
function score(file: string, q: string): number {
  const f = file.toLowerCase();
  const s = q.toLowerCase();
  const base = f.split("/").pop() ?? f;
  if (base.startsWith(s)) return 100 - base.length * 0.1;
  if (base.includes(s)) return 80 - base.length * 0.1;
  if (f.includes(s)) return 60 - f.length * 0.05;
  let i = 0;
  for (const ch of s) {
    i = f.indexOf(ch, i);
    if (i < 0) return -1;
    i++;
  }
  return 20 - f.length * 0.05;
}

export default function QuickOpen({ cwd, onOpen, onClose }: { cwd: string; onOpen: (path: string) => void; onClose: () => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    api.fsFiles(cwd).then(setFiles).catch(() => setFiles([]));
  }, [cwd]);

  const results = useMemo(() => {
    if (!q.trim()) return files.slice(0, 40);
    return files
      .map((f) => ({ f, s: score(f, q.trim()) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.f);
  }, [files, q]);

  useEffect(() => setIdx(0), [q]);

  return (
    <div className="absolute inset-0 z-40 bg-black/25 flex items-start justify-center pt-20" onClick={onClose}>
      <div className="card w-[560px] max-h-[60vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <label dir="ltr" className="flex items-center gap-2 px-3 py-2.5 border-b border-border/60">
          <Search className="size-4 text-muted" />
          <input
            ref={ref}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, results.length - 1));
              else if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
              else if (e.key === "Enter" && results[idx]) onOpen(results[idx]);
              else if (e.key === "Escape") onClose();
            }}
            placeholder={pick("שם קובץ", "File name")}
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <span className="text-[11px] text-muted tabular">{files.length}</span>
        </label>
        <div className="overflow-y-auto py-1" dir="ltr">
          {results.map((f, i) => (
            <button key={f} onMouseEnter={() => setIdx(i)} onClick={() => onOpen(f)} className={cn("w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2", i === idx ? "bg-blue text-white" : "hover:bg-surface-2/70")}>
              <File className={cn("size-3.5 shrink-0", i === idx ? "text-white" : "text-muted")} />
              <span className="truncate">{f.split("/").pop()}</span>
              <span className={cn("truncate text-[11px] ms-auto", i === idx ? "text-white/70" : "text-muted")}>{f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ""}</span>
            </button>
          ))}
          {results.length === 0 && (
            <div dir={pick("rtl", "ltr")} className="p-4 text-sm text-muted">
              {pick("אין קובץ כזה", "No matching file")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
