import { lazy, Suspense, useEffect, useRef, useState } from "react";
import ResizeHandle, { useStoredSize } from "./ResizeHandle";
import { FolderTree, TerminalSquare, Save, X, GitCompare, Search, Globe, FileCode2 } from "lucide-react";
import ChangesPanel from "./ChangesPanel";
import Preview from "./Preview";
import SearchPanel from "./SearchPanel";
import QuickOpen from "./QuickOpen";
import { api, type ChangedFile } from "../api";
import { useStore } from "../store";
import { cn } from "../lib/util";
import FileTree from "./FileTree";
import Terminal from "./Terminal";
import { strings, useT, pick } from "../i18n";
import { Spinner } from "./Spinner";
import { ask } from "../lib/dialog";

const S = strings({
  he: {
    truncated: "הקובץ גדול, מוצגים 2MB הראשונים (שמירה כבויה)",
    closeUnsaved: "לסגור את {path} בלי לשמור?",
    files: "קבצים",
    changes: "שינויים (diff מול git)",
    search: "חיפוש בפרויקט (⌘⇧F) · פתיחה מהירה (⌘P)",
    preview: "תצוגה מקדימה: דפדפן מובנה לשרת הפיתוח",
    terminal: "טרמינל",
    save: "שמירה (⌘S)",
    changed: "קבצים ששונו",
    noChanges: "אין שינויים מול git. כשהסוכן יערוך קבצים הם יופיעו כאן.",
    quickOpen: "פתיחה מהירה",
    searchAll: "חיפוש בפרויקט",
    term: "טרמינל",
    saveFile: "שמירת הקובץ",
  },
  en: {
    truncated: "Large file, showing the first 2MB (saving is off)",
    closeUnsaved: "Close {path} without saving?",
    files: "Files",
    changes: "Changes (diff against git)",
    search: "Search project (⌘⇧F) · Quick open (⌘P)",
    preview: "Preview: built-in browser for the dev server",
    terminal: "Terminal",
    save: "Save (⌘S)",
    changed: "Changed files",
    noChanges: "No changes against git. Files the agent edits will show up here.",
    quickOpen: "Quick open",
    searchAll: "Search the project",
    term: "Terminal",
    saveFile: "Save the file",
  },
});

const Editor = lazy(() => import("./Editor"));

const STATUS: Record<ChangedFile["status"], [string, string]> = {
  modified: ["M", "text-amber"],
  added: ["A", "text-ok"],
  untracked: ["U", "text-ok"],
  deleted: ["D", "text-danger"],
  renamed: ["R", "text-blue"],
  conflict: ["!", "text-danger"],
};

/**
 * כשאין קובץ פתוח: הקבצים ששונו מול git (מה שהסוכן ערך), מתעדכן כל 5 שניות, ולחיצה פותחת את הקובץ.
 * מתחת, הקיצורים של סביבת העבודה.
 */
function EmptyEditor({ cwd, onOpen, onShowChanges }: { cwd: string; onOpen: (path: string) => void; onShowChanges: () => void }) {
  const t = useT(S);
  const [changes, setChanges] = useState<ChangedFile[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.gitChanges(cwd).then((c) => alive && setChanges(c)).catch(() => alive && setChanges([]));
    void load();
    const id = setInterval(() => !document.hidden && void load(), 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [cwd]);
  return (
    <div className="h-full overflow-y-auto p-5 text-[13px]">
      <div className="max-w-md mx-auto space-y-5">
        <section className="space-y-1.5">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {t("changed")}
            {changes && changes.length > 0 && <span className="tabular">{changes.length}</span>}
            <span className="flex-1" />
            {changes && changes.length > 0 && (
              <button onClick={onShowChanges} className="normal-case tracking-normal font-normal text-blue hover:underline" title={t("changes")}>
                diff
              </button>
            )}
          </div>
          {changes === null ? (
            <div className="skeleton h-4 w-2/3" />
          ) : changes.length === 0 ? (
            <div dir={pick("rtl", "ltr")} className="text-muted">{t("noChanges")}</div>
          ) : (
            <div className="rounded-lg border border-border/70 divide-y divide-border/50 overflow-hidden">
              {changes.slice(0, 30).map((c) => {
                const [letter, color] = STATUS[c.status];
                return (
                  <button
                    key={c.path}
                    disabled={c.status === "deleted"}
                    onClick={() => onOpen(c.path)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-start hover:bg-surface-2 disabled:opacity-60 transition"
                    title={c.path}
                  >
                    <span className={cn("mono w-3 text-center font-semibold", color)}>{letter}</span>
                    <span className="truncate">{c.path.split("/").pop()}</span>
                    <span className="truncate text-muted text-[11.5px] flex-1">{c.path.includes("/") ? c.path.slice(0, c.path.lastIndexOf("/")) : ""}</span>
                    {(c.additions > 0 || c.deletions > 0) && (
                      <span className="mono text-[11px] shrink-0">
                        <span className="text-ok">+{c.additions}</span> <span className="text-danger">-{c.deletions}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>
        <section className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-muted">
          {(
            [
              ["⌘P", t("quickOpen")],
              ["⌘⇧F", t("searchAll")],
              ["⌘J", t("term")],
              ["⌘S", t("saveFile")],
            ] as const
          ).map(([k, label]) => (
            <span key={k} className="contents">
              <kbd className="font-sans text-[12px] text-foreground/80">{k}</kbd>
              <span dir={pick("rtl", "ltr")}>{label}</span>
            </span>
          ))}
        </section>
      </div>
    </div>
  );
}

interface OpenFile {
  path: string;
  content: string;
  saved: string;
  line?: number;
}

type Side = "tree" | "changes" | "search" | "preview";

/** סביבת עבודה מצומצמת כמו VS Code: סייר קבצים, עורך וטרמינל, בתיקיית הסשן. */
export default function Workspace({ cwd }: { cwd: string }) {
  const setToast = useStore((s) => s.setToast);
  const t = useT(S);
  const [files, setFiles] = useState<OpenFile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [side, setSide] = useState<Side | null>("tree");
  const [showTerm, setShowTerm] = useState(true);
  const [quick, setQuick] = useState(false);
  const [searchFocus, setSearchFocus] = useState(0);
  const showTree = side === "tree";
  // גדלים שנגררו: רוחב הסייר/החיפוש וגובה הטרמינל (null = ברירת מחדל)
  const [sideW, setSideW] = useStoredSize("mifkada.ws.side", 140, 600);
  const [termH, setTermH] = useStoredSize("mifkada.ws.term", 80, 2000);
  const sideRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const start = useRef(0);

  // ⌘P פתיחה מהירה, ⌘⇧F חיפוש, ⌘J טרמינל
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "p" && !e.shiftKey) {
        e.preventDefault();
        setQuick((v) => !v);
      } else if ((e.key === "f" || e.key === "F") && e.shiftKey) {
        e.preventDefault();
        setSide("search");
        setSearchFocus((n) => n + 1);
      } else if (e.key === "j") {
        e.preventDefault();
        setShowTerm((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = async (path: string, line?: number) => {
    setQuick(false);
    if (files.some((f) => f.path === path)) {
      if (line) setFiles((fs) => fs.map((x) => (x.path === path ? { ...x, line } : x)));
    } else {
      try {
        const r = await api.fsRead(cwd, path);
        setFiles((fs) => [...fs, { path, content: r.content, saved: r.content, line }]);
        if (r.truncated) setToast(t("truncated"));
      } catch (e) {
        setToast((e as Error).message);
        return;
      }
    }
    setActive(path);
  };
  const close = async (path: string) => {
    const f = files.find((x) => x.path === path);
    if (f && f.content !== f.saved && !(await ask(t("closeUnsaved", { path }), { danger: true }))) return;
    setFiles((fs) => fs.filter((x) => x.path !== path));
    if (active === path) setActive(files.find((x) => x.path !== path)?.path ?? null);
  };
  const save = async () => {
    const f = files.find((x) => x.path === active);
    if (!f || f.content === f.saved) return;
    try {
      await api.fsWrite(cwd, f.path, f.content);
      setFiles((fs) => fs.map((x) => (x.path === f.path ? { ...x, saved: f.content } : x)));
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const current = files.find((f) => f.path === active) ?? null;
  const dirty = current ? current.content !== current.saved : false;

  return (
    <div className="h-full flex flex-col bg-surface border-s border-border/70 min-w-0">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-border/70 bg-background/60">
        <button onClick={() => setSide(side === "tree" ? null : "tree")} className={cn("size-7 rounded-md grid place-items-center", side === "tree" ? "bg-blue/15 text-blue" : "text-muted hover:bg-surface-2")} title={t("files")}>
          <FolderTree className="size-4" />
        </button>
        <button onClick={() => setSide(side === "changes" ? null : "changes")} className={cn("size-7 rounded-md grid place-items-center", side === "changes" ? "bg-blue/15 text-blue" : "text-muted hover:bg-surface-2")} title={t("changes")}>
          <GitCompare className="size-4" />
        </button>
        <button
          onClick={() => {
            setSide(side === "search" ? null : "search");
            setSearchFocus((n) => n + 1);
          }}
          className={cn("size-7 rounded-md grid place-items-center", side === "search" ? "bg-blue/15 text-blue" : "text-muted hover:bg-surface-2")}
          title={t("search")}
        >
          <Search className="size-4" />
        </button>
        <button onClick={() => setSide(side === "preview" ? null : "preview")} className={cn("size-7 rounded-md grid place-items-center", side === "preview" ? "bg-blue/15 text-blue" : "text-muted hover:bg-surface-2")} title={t("preview")}>
          <Globe className="size-4" />
        </button>
        <button onClick={() => setShowTerm((v) => !v)} className={cn("size-7 rounded-md grid place-items-center", showTerm ? "bg-blue/15 text-blue" : "text-muted hover:bg-surface-2")} title={t("terminal")}>
          <TerminalSquare className="size-4" />
        </button>
        <span className="flex-1" />
        <button onClick={save} disabled={!dirty} className={cn("size-7 rounded-md grid place-items-center", dirty ? "text-blue hover:bg-blue/15" : "text-muted/50")} title={t("save")}>
          <Save className="size-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 flex relative" dir="ltr">
        {quick && <QuickOpen cwd={cwd} onOpen={(p) => void open(p)} onClose={() => setQuick(false)} />}
        {(showTree || side === "search") && (
          <>
            <div ref={sideRef} className={cn("shrink-0 min-w-0 border-r border-border/70 bg-background/40", sideW === null && (showTree ? "w-52" : "w-72"))} style={sideW === null ? undefined : { width: sideW }}>
              {showTree ? <FileTree cwd={cwd} onOpen={open} active={active} /> : <SearchPanel key={searchFocus} cwd={cwd} autoFocus onOpen={(p, line) => void open(p, line)} />}
            </div>
            {/* כאן dir=ltr: הסייר משמאל, גרירה ימינה מרחיבה */}
            <ResizeHandle axis="x" onStart={() => (start.current = sideRef.current?.offsetWidth ?? 208)} onDrag={(dx) => setSideW(start.current + dx)} onReset={() => setSideW(null)} />
          </>
        )}
        {side === "preview" ? (
          <div className="flex-1 min-w-0">
            <Preview cwd={cwd} />
          </div>
        ) : side === "changes" ? (
          <div className="flex-1 min-w-0">
            <ChangesPanel cwd={cwd} />
          </div>
        ) : (
        <div className="flex-1 min-w-0 flex flex-col">
          {files.length > 0 && (
            <div className="flex items-stretch overflow-x-auto no-scrollbar border-b border-border/70 bg-background/40 shrink-0">
              {files.map((f) => {
                const on = active === f.path;
                return (
                  <div
                    key={f.path}
                    title={f.path}
                    onClick={() => setActive(f.path)}
                    onAuxClick={(e) => e.button === 1 && close(f.path)}
                    className={cn(
                      "group relative flex items-center gap-1.5 ps-3 pe-1.5 h-8 text-[12.5px] whitespace-nowrap cursor-pointer border-e border-border/50 transition",
                      on ? "bg-surface text-foreground" : "text-muted hover:bg-surface-2/60",
                    )}
                  >
                    {on && <span className="absolute top-0 inset-x-0 h-0.5 bg-blue" />}
                    <FileCode2 className="size-3.5 shrink-0 opacity-70" />
                    <span>{f.path.split("/").pop()}</span>
                    <span className="size-4 grid place-items-center">
                      {f.content !== f.saved ? (
                        <span className="size-2 rounded-full bg-foreground/60 group-hover:hidden" />
                      ) : null}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          close(f.path);
                        }}
                        className={cn("rounded hover:bg-surface-2 hover:text-danger", on ? "" : "opacity-0 group-hover:opacity-100", f.content !== f.saved && "hidden group-hover:block")}
                      >
                        <X className="size-3.5" />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <div className={cn("min-h-0", showTerm && termH === null ? "flex-[3]" : "flex-1")}>
            {current ? (
              <Suspense
                fallback={
                  <div className="h-full grid place-items-center text-muted text-sm">
                    <Spinner className="size-5" />
                  </div>
                }
              >
                <Editor fileKey={`${cwd}/${current.path}`} content={current.content} line={current.line} onChange={(v) => setFiles((fs) => fs.map((x) => (x.path === current.path ? { ...x, content: v } : x)))} onSave={save} />
              </Suspense>
            ) : (
              <EmptyEditor cwd={cwd} onOpen={(p) => void open(p)} onShowChanges={() => setSide("changes")} />
            )}
          </div>
          {showTerm && (
            <>
              <ResizeHandle axis="y" onStart={() => (start.current = termRef.current?.offsetHeight ?? 200)} onDrag={(dy) => setTermH(start.current - dy)} onReset={() => setTermH(null)} />
              <div ref={termRef} className={cn("min-h-[80px] max-h-[calc(100%-80px)] border-t border-border/70", termH === null ? "flex-[2] min-h-0" : "shrink-0")} style={termH === null ? undefined : { height: termH }}>
                <Terminal cwd={cwd} />
              </div>
            </>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
