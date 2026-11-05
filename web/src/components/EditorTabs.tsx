import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useStore, type ChatSel } from "../store";
import { useTabs, tabId, type Tab } from "../lib/tabs";
import { SESSION_DRAG } from "../lib/split";
import { projectVisual } from "../lib/groups";
import { providerLabel, useProviders } from "../lib/providers";
import { strings, useT } from "../i18n";
import StatusDot from "./StatusDot";

/** סוג הגרירה של כרטיסייה בתוך השורה (סידור מחדש) */
const TAB_DRAG = "application/x-mifkada-tab";

const S = strings({
  he: { openBeside: "פתח לצד", closeOne: "סגור", closeOthersMenu: "סגור את האחרות", closeAll: "סגור את כולן", pane: "מוצג בחלון {n}", close: "סגור (⌘W) · ⌃Tab לכרטיסייה הבאה", untitled: "(ללא כותרת)", closeOthers: "סגירת שאר הכרטיסיות: לחיצה אמצעית או ⌥-לחיצה על X" },
  en: { openBeside: "Open beside", closeOne: "Close", closeOthersMenu: "Close the others", closeAll: "Close all", pane: "Shown in pane {n}", close: "Close (⌘W) · ⌃Tab for the next tab", untitled: "(untitled)", closeOthers: "Close the other tabs: middle-click or ⌥-click the X" },
});

/**
 * שורת כרטיסיות של שיחות פתוחות, כמו קבצים פתוחים ב-IDE. כל שיחה שנבחרת (מהרשימה, מ-⌘K, מהתראה) נכנסת לשורה.
 * לחיצה עוברת אליה, ⌘-לחיצה פותחת לצד, X או לחיצה אמצעית סוגרים, וגרירה למסך פותחת במסך המפוצל.
 */
export default function EditorTabs() {
  const t = useT(S);
  const { selection, select, sessions, lives, projectThemes, openBeside, unread, split, closePane } = useStore();
  const { tabs, touch, close, closeOthers, closeAll, move, sync } = useTabs();
  // גרירה לסידור מחדש: על איזו כרטיסייה מרחפים (הנגררת תיכנס לפניה), ותפריט קליק ימני
  const [dropBefore, setDropBefore] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; sel: ChatSel; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const off = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("mousedown", off);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("mousedown", off);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", off);
    };
  }, [menu]);
  const providers = useProviders();
  const allCwds = useMemo(() => new Set(sessions.map((s) => s.cwd)), [sessions]);
  const bar = useRef<HTMLDivElement>(null);

  // כל שיחה שנבחרת נכנסת לשורה
  const live = selection?.kind === "live" ? lives.find((l) => l.liveId === selection.liveId) : undefined;
  useEffect(() => {
    if (selection?.kind === "live" || selection?.kind === "history") touch(selection, live?.sessionId ?? undefined);
  }, [selection, live?.sessionId, touch]);
  useEffect(() => sync(lives), [lives, sync]);

  // מזהה של שיחה כמו tabId: ה-sessionId אם ידוע, אחרת ה-liveId
  const idOf = (sel: ChatSel): string => (sel.kind === "history" ? sel.sessionId : (lives.find((l) => l.liveId === sel.liveId)?.sessionId ?? `live:${sel.liveId}`));
  const activeId = selection?.kind === "live" || selection?.kind === "history" ? idOf(selection) : null;

  // מסך מפוצל: גם השיחות שבחלונות האחרים הן כרטיסיות פתוחות, ומסומן באיזה חלון כל אחת (1 = הראשי)
  useEffect(() => {
    for (const sel of split) touch(sel, sel.kind === "live" ? (lives.find((l) => l.liveId === sel.liveId)?.sessionId ?? undefined) : undefined);
  }, [split, lives, touch]);
  const paneOf = new Map<string, number>();
  if (activeId) paneOf.set(activeId, 0);
  split.forEach((sel, i) => paneOf.set(idOf(sel), i + 1));

  // הכרטיסייה הפעילה גלויה גם כשיש הרבה
  useEffect(() => {
    bar.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  /** מסמן איפה השיחה על המסך: מסגרת כחולה שמהבהבת פעמיים סביב החלון שלה (0 = הראשי). בלי להזיז חלונות ובלי פוקוס */
  const focusPane = (i: number) => {
    const el = document.querySelector<HTMLElement>(`[data-pane="${i}"]`);
    if (!el) return;
    // שכבת ::after מעל התוכן (index.css → .pane-flash). הסרה והוספה מחדש מפעילות את האנימציה שוב גם בלחיצה חוזרת
    el.classList.remove("pane-flash");
    void el.offsetWidth;
    el.classList.add("pane-flash");
    el.addEventListener("animationend", () => el.classList.remove("pane-flash"), { once: true });
  };

  const closeTab = (id: string) => {
    const i = tabs.findIndex((x) => tabId(x) === id);
    close(id);
    // שיחה שמוצגת בחלון במסך המפוצל: סוגרים את החלון שלה (הראשי: החלון הבא תופס את מקומו)
    const pane = paneOf.get(id);
    if (pane !== undefined && split.length) return closePane(pane);
    if (id !== activeId) return;
    // כמו ב-IDE: עוברים לכרטיסייה השכנה, ואם אין אז ללוח
    const rest = tabs.filter((x) => tabId(x) !== id);
    const next = rest[Math.min(i, rest.length - 1)];
    select(next ? next.sel : null);
  };

  // ⌘W סוגר את הכרטיסייה הפעילה
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌃Tab / ⌃⇧Tab: הכרטיסייה הבאה / הקודמת, כמו ב-VS Code
      if (e.ctrlKey && e.key === "Tab" && tabs.length) {
        e.preventDefault();
        const i = tabs.findIndex((x) => tabId(x) === activeId);
        const next = tabs[(i + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
        const l = next.sel.kind === "history" ? lives.find((x) => x.sessionId === tabId(next)) : undefined;
        select(l ? { kind: "live", liveId: l.liveId } : next.sel);
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "w" || !activeId) return;
      e.preventDefault();
      closeTab(activeId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!tabs.length) return null;

  const info = (tab: Tab) => {
    const l = tab.sel.kind === "live" ? lives.find((x) => tab.sel.kind === "live" && x.liveId === tab.sel.liveId) : lives.find((x) => x.sessionId === tabId(tab));
    const row = sessions.find((r) => r.sessionId === (tab.sel.kind === "history" ? tab.sel.sessionId : (l?.sessionId ?? tab.sessionId)));
    const title = (l?.title || row?.title || "").trim() || t("untitled");
    const cwd = row?.projectCwd || row?.cwd || l?.cwd || "";
    const provider = l?.provider ?? row?.provider;
    return { live: l, title, cwd, provider };
  };

  return (
    <div
      ref={bar}
      className="editor-tabs no-drag"
      role="tablist"
      // שחרור על השטח הריק של השורה: לסוף
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(TAB_DRAG)) return;
        e.preventDefault();
        if (e.target === e.currentTarget) setDropBefore(null);
      }}
      onDrop={(e) => {
        const from = e.dataTransfer.getData(TAB_DRAG);
        if (from && e.target === e.currentTarget) move(from, null);
        setDropBefore(null);
      }}
    >
      {tabs.map((tab) => {
        const id = tabId(tab);
        const { live: l, title, cwd, provider } = info(tab);
        const v = cwd ? projectVisual(cwd, allCwds, projectThemes) : null;
        const active = id === activeId;
        const pane = split.length ? paneOf.get(id) : undefined;
        const sel: ChatSel = l ? { kind: "live", liveId: l.liveId } : tab.sel;
        const waiting = Boolean(l && l.pendingPermissions > 0);
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            data-active={active}
            data-visible={pane !== undefined}
            data-drop={dropBefore === id || undefined}
            className="editor-tab"
            title={`${title}${v ? ` · ${v.name}` : ""}${provider && provider !== "claude" ? ` · ${providerLabel(provider, providers)}` : ""}`}
            draggable
            onDragStart={(e) => {
              // גם לסידור הכרטיסיות וגם לגרירה למסך המפוצל (DropSplit קורא את SESSION_DRAG)
              e.dataTransfer.setData(SESSION_DRAG, JSON.stringify(sel));
              e.dataTransfer.setData(TAB_DRAG, id);
              e.dataTransfer.effectAllowed = "copyMove";
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes(TAB_DRAG)) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              setDropBefore(id);
            }}
            onDragLeave={() => setDropBefore((cur) => (cur === id ? null : cur))}
            onDrop={(e) => {
              const from = e.dataTransfer.getData(TAB_DRAG);
              if (!from) return;
              e.preventDefault();
              e.stopPropagation();
              move(from, id);
              setDropBefore(null);
            }}
            onDragEnd={() => setDropBefore(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ id, sel, x: e.clientX, y: e.clientY });
            }}
            onClick={(e) => {
              if (e.metaKey) return openBeside(sel);
              // שיחה שכבר מוצגת בחלון: רק מסמנים איפה היא, בלי להחליף את מקום החלונות
              if (pane !== undefined) return focusPane(pane);
              select(sel);
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                closeTab(id);
              }
            }}
          >
            {v && <span className="size-2.5 rounded-[3px] shrink-0" style={{ background: v.color }} />}
            {pane !== undefined && (
              <span className="tab-pane" title={t("pane", { n: pane + 1 })}>
                {pane + 1}
              </span>
            )}
            <span dir="auto" className="truncate flex-1 min-w-0">
              {title}
            </span>
            {provider && provider !== "claude" && <span className="ltr text-[10.5px] opacity-70 shrink-0">{providerLabel(provider, providers)}</span>}
            {waiting ? (
              <span className="size-2 rounded-full bg-warn shrink-0" />
            ) : l && (l.state === "running" || l.state === "starting") ? (
              <StatusDot state={l.state} className="shrink-0" />
            ) : l && unread[l.liveId] ? (
              <span className="size-2 rounded-full bg-blue shrink-0" />
            ) : null}
            <button
              className="tab-close"
              title={`${t("close")}\n${t("closeOthers")}`}
              onClick={(e) => {
                e.stopPropagation();
                if (e.altKey) closeOthers(id);
                else closeTab(id);
              }}
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
      {menu && (
        <div
          className="tab-menu card fixed z-50 py-1 min-w-44 text-[13px]"
          style={{ top: menu.y + 4, left: Math.min(menu.x, window.innerWidth - 190) }}
          onMouseDown={(e) => e.stopPropagation()}
          role="menu"
        >
          {[
            [t("openBeside"), () => openBeside(menu.sel)],
            [t("closeOne"), () => closeTab(menu.id)],
            [t("closeOthersMenu"), () => closeOthers(menu.id)],
            [
              t("closeAll"),
              () => {
                closeAll();
                if (activeId && !split.length) select(null);
              },
            ],
          ].map(([label, run]) => (
            <button
              key={label as string}
              role="menuitem"
              onClick={() => {
                (run as () => void)();
                setMenu(null);
              }}
              className="w-full text-start px-3 py-1.5 hover:bg-[var(--color-fill)]"
            >
              {label as string}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
