import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { RefreshCw, Undo2, GitCommitHorizontal, FilePlus2, FileMinus2, FileDiff, AlertTriangle } from "lucide-react";
import { api, type ChangedFile } from "../api";
import { useStore } from "../store";
import { cn } from "../lib/util";
import { strings, useT, tr, pick } from "../i18n";
import { Spinner } from "./Spinner";
import { ask } from "../lib/dialog";

const S = strings({
  he: {
    modified: "שונה",
    added: "חדש",
    deleted: "נמחק",
    renamed: "שם שונה",
    conflict: "קונפליקט",
    discardConfirm: "לבטל את השינויים ב-{path}? אי אפשר לשחזר.",
    committed: "קומיט {hash}",
    fileCount: "{n} קבצים",
    refresh: "רענון",
    discardFile: "בטל שינויים בקובץ",
    clean: "אין שינויים. עץ העבודה נקי.",
    commitMessage: "הודעת קומיט",
    commitAll: "קומיט לכל השינויים",
    binary: "קובץ בינארי",
    pickFile: "בחר קובץ כדי לראות מה השתנה",
  },
  en: {
    modified: "Modified",
    added: "New",
    deleted: "Deleted",
    renamed: "Renamed",
    conflict: "Conflict",
    discardConfirm: "Discard the changes in {path}? This can't be undone.",
    committed: "Committed {hash}",
    fileCount: "{n} files",
    refresh: "Refresh",
    discardFile: "Discard changes in this file",
    clean: "No changes. The working tree is clean.",
    commitMessage: "Commit message",
    commitAll: "Commit all changes",
    binary: "Binary file",
    pickFile: "Pick a file to see what changed",
  },
});

const DiffEditor = lazy(() => import("./DiffEditor"));

// label כ-getter: מתורגם בכל קריאה
const STATUS: Record<ChangedFile["status"], { readonly label: string; cls: string }> = {
  modified: { get label() { return tr(S, "modified"); }, cls: "text-amber" },
  added: { get label() { return tr(S, "added"); }, cls: "text-teal" },
  untracked: { get label() { return tr(S, "added"); }, cls: "text-teal" },
  deleted: { get label() { return tr(S, "deleted"); }, cls: "text-danger" },
  renamed: { get label() { return tr(S, "renamed"); }, cls: "text-blue" },
  conflict: { get label() { return tr(S, "conflict"); }, cls: "text-danger" },
};

/** "שינויים": מה השתנה בעץ העבודה, diff לכל קובץ, ביטול וקומיט. */
export default function ChangesPanel({ cwd }: { cwd: string }) {
  const setToast = useStore((s) => s.setToast);
  const t = useT(S);
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ before: string; after: string; binary: boolean } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api
      .gitChanges(cwd)
      .then(setFiles)
      .catch((e: Error) => {
        setFiles([]);
        setToast(e.message);
      });
  }, [cwd, setToast]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => !document.hidden && refresh(), 8000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!active) return setDiff(null);
    api
      .gitDiff(cwd, active)
      .then(setDiff)
      .catch((e: Error) => setToast(e.message));
  }, [active, cwd, setToast, files]);

  const discard = async (p: string) => {
    if (!(await ask(t("discardConfirm", { path: p }), { danger: true }))) return;
    try {
      await api.gitDiscard(cwd, p);
      if (active === p) setActive(null);
      refresh();
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const commit = async () => {
    setBusy(true);
    try {
      const r = await api.gitCommit(cwd, message);
      setToast(t("committed", { hash: r.hash }));
      setMessage("");
      setActive(null);
      refresh();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const total = files?.reduce((s, f) => ({ a: s.a + f.additions, d: s.d + f.deletions }), { a: 0, d: 0 }) ?? { a: 0, d: 0 };

  return (
    <div className="h-full flex" dir="ltr">
      <div className="w-64 shrink-0 border-r border-border/70 flex flex-col bg-background/40">
        <div dir={pick("rtl", "ltr")} className="flex items-center gap-2 px-2 py-1.5 text-xs border-b border-border/60">
          <span className="font-medium">{files ? t("fileCount", { n: files.length }) : "..."}</span>
          <span className="tabular text-teal">+{total.a}</span>
          <span className="tabular text-danger">-{total.d}</span>
          <button onClick={refresh} className="ms-auto p-1 rounded hover:bg-surface-2 text-muted" title={t("refresh")}>
            <RefreshCw className="size-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {files?.map((f) => {
            const st = STATUS[f.status];
            return (
              <div key={f.path} className={cn("group flex items-center gap-1.5 px-2 py-1 text-[12px] cursor-pointer", active === f.path ? "bg-blue text-white" : "hover:bg-surface-2/70")} onClick={() => setActive(f.path)}>
                {f.status === "deleted" ? <FileMinus2 className="size-3.5 shrink-0" /> : f.status === "untracked" || f.status === "added" ? <FilePlus2 className="size-3.5 shrink-0" /> : f.status === "conflict" ? <AlertTriangle className="size-3.5 shrink-0" /> : <FileDiff className="size-3.5 shrink-0" />}
                <span className="truncate flex-1" title={f.path}>
                  {f.path}
                </span>
                <span className={cn("text-[10px] shrink-0", active === f.path ? "text-white/80" : st.cls)}>{st.label}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void discard(f.path);
                  }}
                  className={cn("p-0.5 rounded opacity-0 group-hover:opacity-100", active === f.path ? "hover:bg-white/20" : "hover:bg-danger/15 text-danger")}
                  title={t("discardFile")}
                >
                  <Undo2 className="size-3.5" />
                </button>
              </div>
            );
          })}
          {files && files.length === 0 && (
            <div dir={pick("rtl", "ltr")} className="p-3 text-xs text-muted">
              {t("clean")}
            </div>
          )}
        </div>
        <div dir={pick("rtl", "ltr")} className="border-t border-border/60 p-2 space-y-1.5">
          <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("commitMessage")} className="w-full rounded-lg bg-surface border px-2 py-1 text-xs outline-none focus:border-blue/60" />
          <button onClick={commit} disabled={busy || !message.trim() || !files?.length} className="btn-primary w-full py-1 text-xs flex items-center justify-center gap-1 disabled:opacity-40">
            {busy ? <Spinner className="size-3.5" /> : <GitCommitHorizontal className="size-3.5" />} {t("commitAll")}
          </button>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        {active && diff && !diff.binary && (
          <Suspense fallback={<div className="h-full grid place-items-center text-muted text-sm"><Spinner className="size-5" /></div>}>
            <DiffEditor path={active} before={diff.before} after={diff.after} />
          </Suspense>
        )}
        {active && diff?.binary && (
          <div dir={pick("rtl", "ltr")} className="h-full grid place-items-center text-muted text-sm">
            {t("binary")}
          </div>
        )}
        {!active && (
          <div dir={pick("rtl", "ltr")} className="h-full grid place-items-center text-muted text-sm">
            {t("pickFile")}
          </div>
        )}
      </div>
    </div>
  );
}
