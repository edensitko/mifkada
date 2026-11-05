import { useRef, type CSSProperties } from "react";
import { LayoutGrid, Columns3, Rows3, Grid2x2, RotateCcw, Minimize2, MessageSquareOff, X } from "lucide-react";
import { useStore, transcriptKey, type ChatSel, type SplitLayout } from "../store";
import { cn } from "../lib/util";
import ChatView from "./ChatView";
import ErrorBoundary from "./ErrorBoundary";
import { gridDims } from "../lib/split";
import { isRTL, pick, strings, useT } from "../i18n";

const S = strings({
  he: {
    paneBroke: "החלון הזה נשבר",
    goneTitle: "הסשן הזה כבר לא קיים",
    goneText: "הוא נסגר או נמחק, או שהשרת הופעל מחדש. אפשר לפתוח אותו שוב מהרשימה בצד.",
    closePane: "סגור חלון",
    chats: "{n} צ'אטים",
    equalTitle: "כל החלונות באותו גודל",
    equal: "גדלים שווים",
    backToAll: "חזרה לכל החלונות",
    hint: "גרור סשן מהצד כדי להוסיף או להחליף · גרור כותרת של חלון כדי להזיז",
  },
  en: {
    paneBroke: "This pane crashed",
    goneTitle: "This session no longer exists",
    goneText: "It was closed or deleted, or the server restarted. You can open it again from the list on the side.",
    closePane: "Close pane",
    chats: "{n} chats",
    equalTitle: "Make all panes the same size",
    equal: "Equal sizes",
    backToAll: "Back to all panes",
    hint: "Drag a session from the side to add or replace · Drag a pane's title to move it",
  },
});

/** חלון לא קטן מחצי מהממוצע: מתחת לזה הכותרת ושורת הכתיבה לא נכנסות והתוכן גולש על השכנים */
const MIN_SHARE = 0.5;
function sizesFor(saved: number[], count: number): number[] {
  if (saved.length !== count || !saved.every((x) => Number.isFinite(x) && x > 0)) return Array.from({ length: count }, () => 1);
  const avg = saved.reduce((a, b) => a + b, 0) / count;
  return saved.map((x) => Math.max(x, avg * MIN_SHARE));
}
const template = (sizes: number[]) => sizes.map((f) => `minmax(0, ${f}fr)`).join(" ");

const LAYOUTS: Array<{ id: SplitLayout; label: string; icon: typeof Columns3 }> = [
  { id: "auto", get label() { return pick("אוטומטי", "Auto"); }, icon: LayoutGrid },
  { id: "cols", get label() { return pick("עמודות", "Columns"); }, icon: Columns3 },
  { id: "rows", get label() { return pick("שורות", "Rows"); }, icon: Rows3 },
  { id: "grid", get label() { return pick("רשת", "Grid"); }, icon: Grid2x2 },
];

/** המסך המחולק: עד 6 צ'אטים, סידור לבחירה, גבולות שאפשר לגרור, וחלון שאפשר להגדיל זמנית */
export default function SplitGrid({ main }: { main: ChatSel }) {
  const { split, layout, colSizes, rowSizes, zoomPane, setLayout, setSizes, setZoomPane, sessions, lives, transcripts } = useStore();
  const panes: ChatSel[] = [main, ...split];
  const n = panes.length;
  const { cols, rows } = gridDims(n, layout);
  const cs = sizesFor(colSizes, cols);
  const rs = sizesFor(rowSizes, rows);
  const box = useRef<HTMLDivElement>(null);
  const tiny = n >= 3;
  const t = useT(S);
  const rtl = isRTL();

  // גרירת גבול בין עמודות או שורות
  const startResize = (axis: "col" | "row", i: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = box.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const start = axis === "col" ? [...cs] : [...rs];
    const total = start.reduce((a, b) => a + b, 0);
    const span = axis === "col" ? rect.width : rect.height;
    const x0 = e.clientX;
    const y0 = e.clientY;
    const min = (total / start.length) * MIN_SHARE;
    document.body.style.userSelect = "none";
    document.body.style.cursor = axis === "col" ? "col-resize" : "row-resize";
    const move = (ev: PointerEvent) => {
      // בעברית העמודה הראשונה מימין: תזוזה שמאלה מגדילה אותה. באנגלית היא משמאל: תזוזה ימינה מגדילה אותה
      const dx = rtl ? x0 - ev.clientX : ev.clientX - x0;
      const d = axis === "col" ? (dx / span) * total : ((ev.clientY - y0) / span) * total;
      const next = [...start];
      next[i] = Math.max(min, start[i] + d);
      next[i + 1] = Math.max(min, start[i + 1] - (next[i] - start[i]));
      next[i] = start[i] + start[i + 1] - next[i + 1];
      if (axis === "col") setSizes(next, null);
      else setSizes(null, next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const cum = (sizes: number[], i: number) => (sizes.slice(0, i + 1).reduce((a, b) => a + b, 0) / sizes.reduce((a, b) => a + b, 0)) * 100;

  // מפתח לכל חלון: הזהות שלו ועוד מספר מופע. אם בכל זאת נכנסה כפילות, React לא יקבל שני ילדים עם אותו key
  // (זה השאיר ברשת ילדים יתומים שפתחו שורות נוספות ובלעו את כל הגובה)
  const seen = new Map<string, number>();
  const keys = panes.map((p, i) => {
    const k = transcriptKey(p) ?? String(i);
    const c = seen.get(k) ?? 0;
    seen.set(k, c + 1);
    return c ? `${k}#${c}` : k;
  });

  /** הסשן של החלון כבר לא קיים: חי שנסגר בלי שום תמליל, או היסטורי שאינו ברשימה ושלא נטען ממנו כלום */
  const missing = (p: ChatSel): boolean => {
    if (!sessions.length) return false; // הרשימה עוד לא הגיעה מהשרת
    const t = transcripts[transcriptKey(p) ?? ""];
    if (t?.messages.length || t?.loading) return false;
    if (p.kind === "live") return !lives.some((l) => l.liveId === p.liveId) && !sessions.some((r) => r.live?.liveId === p.liveId);
    return !sessions.some((r) => r.sessionId === p.sessionId) && Boolean(t?.loaded);
  };

  // ברשת עם תאים ריקים (3 חלונות ב-2x2) החלון האחרון מתפרס על מה שנשאר בשורה שלו, כדי שלא יישאר חור
  const spanLast = cols * rows - n;
  const pane = (p: ChatSel, slot: number, extra?: CSSProperties) => (
    <div key={keys[slot]} data-pane={slot} className="relative min-w-0 min-h-0 overflow-hidden flex flex-col bg-background" style={{ ...(spanLast > 0 && slot === n - 1 && zoomPane === null ? { gridColumn: `span ${spanLast + 1}` } : {}), ...extra }}>
      <ErrorBoundary label={t("paneBroke")} resetKey={transcriptKey(p) ?? String(slot)}>
        {missing(p) ? <MissingPane slot={slot} /> : slot === 0 ? <ChatView compact tiny={tiny} slot={0} selection={p} /> : <ChatView pane={slot - 1} slot={slot} compact tiny={tiny} selection={p} />}
      </ErrorBoundary>
    </div>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-9 shrink-0 flex items-center gap-2 px-3 border-b border-[var(--color-separator)] bg-sidebar/60 text-[12.5px]">
        <span className="text-muted">{t("chats", { n })}</span>
        <div className="segmented flex text-xs">
          {LAYOUTS.map((l) => (
            <button key={l.id} data-active={layout === l.id} onClick={() => setLayout(l.id)} className="px-2 py-1 flex items-center gap-1" title={l.label}>
              <l.icon className="size-3.5" />
              <span className="max-lg:hidden">{l.label}</span>
            </button>
          ))}
        </div>
        {(colSizes.length > 0 || rowSizes.length > 0) && (
          <button onClick={() => setSizes([], [])} className="flex items-center gap-1 text-blue" title={t("equalTitle")}>
            <RotateCcw className="size-3.5" /> {t("equal")}
          </button>
        )}
        {zoomPane !== null && (
          <button onClick={() => setZoomPane(null)} className="flex items-center gap-1 text-blue">
            <Minimize2 className="size-3.5" /> {t("backToAll")}
          </button>
        )}
        <span className="ms-auto text-muted max-xl:hidden">{t("hint")}</span>
      </div>

      {zoomPane !== null && panes[zoomPane] ? (
        <div className="flex-1 min-h-0 flex flex-col">{pane(panes[zoomPane], zoomPane)}</div>
      ) : (
        <div ref={box} className="relative flex-1 min-h-0">
          <div className="absolute inset-0 grid gap-px bg-[var(--color-separator)]" style={{ gridTemplateColumns: template(cs), gridTemplateRows: template(rs) }}>
            {panes.map((p, i) => pane(p, i))}
          </div>
          {cs.slice(0, -1).map((_, i) => (
            // כשהחלון האחרון מתפרס על השורה האחרונה, אין שם עמודות: הידית נעצרת מעליה ולא חוצה אותו
            <div key={`c${i}`} onPointerDown={startResize("col", i)} className="absolute top-0 w-2 -me-1 z-20 cursor-col-resize group/rz" style={{ [rtl ? "right" : "left"]: `${cum(cs, i)}%`, transform: rtl ? "translateX(50%)" : "translateX(-50%)", bottom: spanLast > 0 && rows > 1 ? `${100 - cum(rs, rows - 2)}%` : 0 }}>
              <span className="block mx-auto h-full w-0.5 bg-blue opacity-0 group-hover/rz:opacity-60 transition" />
            </div>
          ))}
          {rs.slice(0, -1).map((_, i) => (
            <div key={`r${i}`} onPointerDown={startResize("row", i)} className="absolute inset-x-0 h-2 z-20 cursor-row-resize group/rz" style={{ top: `${cum(rs, i)}%`, transform: "translateY(-50%)" }}>
              <span className={cn("block my-[3px] w-full h-0.5 bg-blue opacity-0 group-hover/rz:opacity-60 transition")} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** חלון שהסשן שלו כבר לא קיים: מסבירים וסוגרים בלחיצה, במקום חלון ריק בלי כותרת */
function MissingPane({ slot }: { slot: number }) {
  const t = useT(S);
  return (
    <div className="flex-1 grid place-items-center">
      <div className="empty-state !py-6">
        <div className="empty-icon">
          <MessageSquareOff className="size-7" />
        </div>
        <h3>{t("goneTitle")}</h3>
        <p className="text-sm max-w-60">{t("goneText")}</p>
        <button onClick={() => useStore.getState().closePane(slot)} className="btn-primary mt-2 px-4 py-1.5 text-sm flex items-center gap-1.5">
          <X className="size-4" /> {t("closePane")}
        </button>
      </div>
    </div>
  );
}
