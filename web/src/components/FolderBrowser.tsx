import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, CornerLeftUp, Folder, FolderGit2, Home, Search } from "lucide-react";
import { api } from "../api";
import { cn } from "../lib/util";
import { crumbs } from "../lib/folders";
import { isRTL, strings, useT } from "../i18n";
import type { BrowseResult } from "../../../shared/protocol";

const S = strings({
  he: {
    title: "בחירת תיקייה",
    filter: "סינון בתיקייה הזו",
    up: "תיקייה אחת למעלה",
    home: "בית",
    choose: "בחר את התיקייה הזו",
    cancel: "ביטול",
    loading: "טוען...",
    empty: "אין כאן תת-תיקיות",
    noMatch: "אין תיקייה שמתאימה ל-\"{q}\"",
    truncated: "מוצגות {n} תיקיות ראשונות. אפשר לסנן כדי למצוא",
    gitRepo: "ריפו git",
    hintEnter: "נכנס",
    hintUp: "למעלה",
    hintChoose: "בוחר",
    hintClose: "סוגר",
    path: "נתיב",
  },
  en: {
    title: "Choose a folder",
    filter: "Filter this folder",
    up: "Up one folder",
    home: "Home",
    choose: "Choose this folder",
    cancel: "Cancel",
    loading: "Loading...",
    empty: "No subfolders here",
    noMatch: "No folder matches \"{q}\"",
    truncated: "Showing the first {n} folders. Filter to find more",
    gitRepo: "git repo",
    hintEnter: "opens",
    hintUp: "goes up",
    hintChoose: "chooses",
    hintClose: "closes",
    path: "Path",
  },
});

/**
 * בורר תיקיות בסגנון סייר קבצים ל"סשן חדש": ניווט בתיקיות בתוך הבית (GET /api/fs/browse), בלי להקליד נתיב.
 * מקלדת: חיצים בין התיקיות, Enter / לחיצה כפולה נכנסים, Backspace בשדה ריק עולה, ⌘Enter בוחר את התיקייה הנוכחית.
 * השדה הוא combobox והרשימה listbox עם aria-activedescendant, כך שהפוקוס נשאר בשדה הסינון כל הזמן.
 */
export default function FolderBrowser({ initial, onPick, onClose }: { initial?: string; onPick: (path: string) => void; onClose: () => void }) {
  const t = useT(S);
  const uid = useId();
  const [data, setData] = useState<BrowseResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // אחרי עלייה רמה: לסמן את התיקייה שממנה יצאנו
  const focusName = useRef<string | null>(null);

  const load = useCallback(async (path: string, fallback = false) => {
    setLoading(true);
    try {
      const r = await api.fsBrowse(path);
      setData(r);
      setError("");
      setQ("");
      const i = focusName.current ? r.entries.findIndex((e) => e.name === focusName.current) : -1;
      setIdx(Math.max(0, i));
      focusName.current = null;
    } catch (e) {
      // תיקייה ההתחלתית לא נגישה (נמחקה, מחוץ לבית): מתחילים מנקודת ההתחלה של השרת
      if (fallback) return load("");
      setError((e as Error).message);
    } finally {
      setLoading(false);
      input.current?.focus();
    }
  }, []);

  // מתחילים מהתיקייה שמעל הנוכחית, עם הנוכחית מסומנת: "תיקייה אחרת" היא בדרך כלל שכנה שלה
  useEffect(() => {
    const cur = initial?.trim().replace(/[\\/]+$/, "") ?? "";
    const cut = Math.max(cur.lastIndexOf("/"), cur.lastIndexOf("\\"));
    if (cut > 0) focusName.current = cur.slice(cut + 1);
    void load(cut > 0 ? cur.slice(0, cut) : "", Boolean(cur));
  }, [initial, load]);

  const shown = useMemo(() => {
    const entries = data?.entries ?? [];
    const s = q.trim().toLowerCase();
    if (!s) return entries;
    const starts = entries.filter((e) => e.name.toLowerCase().startsWith(s));
    return [...starts, ...entries.filter((e) => !e.name.toLowerCase().startsWith(s) && e.name.toLowerCase().includes(s))];
  }, [data, q]);

  useEffect(() => setIdx((i) => (q ? 0 : Math.min(i, Math.max(0, shown.length - 1)))), [q, shown.length]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx, shown]);

  const up = () => {
    if (!data?.parent) return;
    focusName.current = data.path.split(/[\\/]/).pop() ?? null;
    void load(data.parent);
  };
  const enter = (i = idx) => {
    const e = shown[i];
    if (e) void load(e.path);
  };
  const choose = () => data && onPick(data.path);

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const fwd = isRTL() ? "ArrowLeft" : "ArrowRight";
    const back = isRTL() ? "ArrowRight" : "ArrowLeft";
    if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, shown.length - 1));
    else if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
    else if (e.key === "Home" && !q) setIdx(0);
    else if (e.key === "End" && !q) setIdx(shown.length - 1);
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) choose();
    else if (e.key === "Enter") enter();
    else if (e.key === fwd && !q) enter();
    else if ((e.key === "Backspace" || e.key === back) && !q) up();
    else if (e.key === "Escape") onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const path = data ? crumbs(data.path, data.home) : [];
  const active = shown[idx];
  const Chevron = isRTL() ? ChevronLeft : ChevronRight;

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      // לא לתת ל-Esc / ⌘Enter להגיע לטופס של "סשן חדש" שמאחור
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div role="dialog" aria-modal="true" aria-labelledby={`${uid}-t`} className="card w-full max-w-[560px] h-[min(560px,85vh)] flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2">
          <h2 id={`${uid}-t`} className="text-[15px] font-semibold flex-1">
            {t("title")}
          </h2>
          <button type="button" onClick={up} disabled={!data?.parent} title={t("up")} aria-label={t("up")} className="rounded-md p-1.5 hover:bg-[var(--color-fill)] disabled:opacity-30">
            <CornerLeftUp className="size-4" />
          </button>
        </div>

        {/* breadcrumb: נתיב, תמיד משמאל לימין */}
        <nav aria-label={t("path")} dir="ltr" className="flex items-center gap-0.5 px-3 pb-2 overflow-x-auto whitespace-nowrap mono text-[12.5px]">
          {path.map((c, i) => (
            <span key={c.path} className="flex items-center gap-0.5 shrink-0">
              {i > 0 && <span className="text-muted px-0.5">›</span>}
              <button
                type="button"
                onClick={() => void load(c.path)}
                aria-current={i === path.length - 1 ? "location" : undefined}
                className={cn("rounded px-1.5 py-0.5 hover:bg-[var(--color-fill)] flex items-center gap-1", i === path.length - 1 ? "font-semibold" : "text-muted")}
              >
                {i === 0 && <Home className="size-3.5" aria-label={t("home")} />}
                {c.name}
              </button>
            </span>
          ))}
        </nav>

        {data && data.roots.length > 0 && !(data.roots.length === 1 && data.roots[0] === data.home) && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-2">
            {data.roots.map((r) => (
              <button key={r} type="button" onClick={() => void load(r)} title={r} className={cn("rounded-full px-2.5 py-0.5 text-[12px]", r === data.path ? "bg-blue text-white" : "bg-surface-2 hover:bg-[var(--color-fill)]")}>
                <span dir="auto">{r.split(/[\\/]/).pop()}</span>
              </button>
            ))}
          </div>
        )}

        <label className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 focus-within:ring-2 focus-within:ring-blue/40">
          <Search className="size-4 text-muted shrink-0" />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-activedescendant={active ? `${uid}-o-${idx}` : undefined}
            aria-autocomplete="list"
            aria-label={t("filter")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder={t("filter")}
            className="flex-1 bg-transparent outline-none text-[14px]"
          />
        </label>

        <div ref={list} id={`${uid}-list`} role="listbox" aria-label={data?.display ?? t("title")} className="flex-1 overflow-y-auto px-2 pb-2">
          {shown.map((e, i) => {
            const on = i === idx;
            const Icon = e.isGitRepo ? FolderGit2 : Folder;
            return (
              <div
                key={e.path}
                id={`${uid}-o-${i}`}
                data-idx={i}
                role="option"
                aria-selected={on}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => setIdx(i)}
                onDoubleClick={() => enter(i)}
                className={cn("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 cursor-default select-none text-[14px]", on ? "bg-blue text-white" : "hover:bg-[var(--color-fill)]")}
              >
                <Icon className={cn("size-4 shrink-0", on ? "text-white" : e.isGitRepo ? "text-amber" : "text-blue")} aria-hidden />
                <span dir="auto" className="truncate flex-1">
                  {e.name}
                </span>
                {e.isGitRepo && <span className={cn("text-[11px]", on ? "text-white/80" : "text-muted")}>{t("gitRepo")}</span>}
                {e.hasChildren && (
                  <button type="button" tabIndex={-1} aria-hidden onClick={(ev) => (ev.stopPropagation(), enter(i))} className={cn("rounded p-0.5", on ? "text-white" : "text-muted hover:bg-[var(--color-fill)]")}>
                    <Chevron className="size-4" />
                  </button>
                )}
              </div>
            );
          })}
          {!loading && data && shown.length === 0 && <div className="p-4 text-[13px] text-muted">{q ? t("noMatch", { q }) : t("empty")}</div>}
          {data?.truncated && !q && <div className="px-3 py-2 text-[12px] text-muted">{t("truncated", { n: data.entries.length })}</div>}
          {loading && !data && <div className="p-4 text-[13px] text-muted">{t("loading")}</div>}
        </div>

        {error && (
          <div role="alert" className="mx-4 mb-2 rounded-md bg-danger/10 text-danger px-3 py-2 text-[13px]">
            {error}
          </div>
        )}

        <div className="border-t border-border/60 px-4 py-3 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div dir="ltr" className="ltr mono text-[12px] truncate text-start" title={data?.path}>
              {data?.display ?? ""}
            </div>
            {/* כל מקש ב-bdi, כדי ש-⌘Enter לא יתהפך בתוך שורה בעברית */}
            <div className="text-[11px] text-muted truncate">
              {(
                [
                  ["Enter", "hintEnter"],
                  ["Backspace", "hintUp"],
                  ["⌘Enter", "hintChoose"],
                  ["Esc", "hintClose"],
                ] as const
              ).map(([k, l], i) => (
                <span key={k}>
                  {i > 0 && " · "}
                  <bdi dir="ltr">{k}</bdi> {t(l)}
                </span>
              ))}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-[14px] hover:bg-surface-2">
            {t("cancel")}
          </button>
          <button type="button" onClick={choose} disabled={!data} className="btn-primary rounded-lg px-4 py-1.5 text-[14px] font-medium disabled:opacity-35">
            {t("choose")}
          </button>
        </div>
      </div>
    </div>
  );
}
