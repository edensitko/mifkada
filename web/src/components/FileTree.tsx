import { useEffect, useState } from "react";
import { ChevronDown, ChevronLeft, File, Folder, FolderOpen } from "lucide-react";
import { api } from "../api";
import { cn } from "../lib/util";
import type { FsEntry } from "../api";

function Node({ cwd, entry, depth, onOpen, active }: { cwd: string; entry: FsEntry; depth: number; onOpen: (p: string) => void; active: string | null }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const load = async () => {
    if (children) return;
    try {
      setChildren(await api.fsList(cwd, entry.path));
    } catch {
      setChildren([]);
    }
  };
  if (entry.type === "dir") {
    return (
      <div>
        <button
          onClick={() => {
            setOpen((o) => !o);
            void load();
          }}
          className={cn("w-full flex items-center gap-1 py-[3px] text-[12.5px] rounded-md hover:bg-surface-2/70 ltr text-left", entry.skipped && "text-muted")}
          style={{ paddingLeft: 6 + depth * 12 }}
        >
          {open ? <ChevronDown className="size-3.5 text-muted shrink-0" /> : <ChevronLeft className="size-3.5 text-muted shrink-0 rotate-180" />}
          {open ? <FolderOpen className="size-3.5 text-blue shrink-0" /> : <Folder className="size-3.5 text-blue shrink-0" />}
          <span className="truncate">{entry.name}</span>
        </button>
        {open && children?.map((c) => <Node key={c.path} cwd={cwd} entry={c} depth={depth + 1} onOpen={onOpen} active={active} />)}
      </div>
    );
  }
  return (
    <button onClick={() => onOpen(entry.path)} className={cn("w-full flex items-center gap-1 py-[3px] text-[12.5px] rounded-md ltr text-left", active === entry.path ? "bg-blue text-white" : "hover:bg-surface-2/70")} style={{ paddingLeft: 6 + depth * 12 + 16 }}>
    <File className={cn("size-3.5 shrink-0", active === entry.path ? "text-white" : "text-muted")} />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

/** סייר קבצים של הפרויקט, נטען בעצלתיים. */
export default function FileTree({ cwd, onOpen, active }: { cwd: string; onOpen: (p: string) => void; active: string | null }) {
  const [root, setRoot] = useState<FsEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .fsList(cwd, "")
      .then(setRoot)
      .catch((e: Error) => setError(e.message));
  }, [cwd]);
  return (
    <div dir="ltr" className="h-full overflow-y-auto px-1 py-1 text-foreground">
      {error && <div className="text-xs text-danger p-2">{error}</div>}
      {root?.map((e) => (
        <Node key={e.path} cwd={cwd} entry={e} depth={0} onOpen={onOpen} active={active} />
      ))}
    </div>
  );
}
