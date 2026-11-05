import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph from "force-graph";
import { Orbit, RefreshCw, Search, X, AlertTriangle, Info, Moon, FolderOpen, MessageSquare, Bot, KanbanSquare, Maximize } from "lucide-react";
import type { MapData, MapGap, MapLink, MapNode, MapNodeType } from "../../../shared/protocol";
import { useStore } from "../store";
import { api } from "../api";
import { cn, relTime } from "../lib/util";
import { strings, useT, tr } from "../i18n";
import { Spinner } from "./Spinner";

const S = strings({
  he: {
    tProjects: "פרויקטים",
    tAgents: "אייג'נטים",
    tSessions: "סשנים",
    tSkills: "סקילס",
    tMemory: "זיכרון",
    tTasks: "משימות",
    tRoutines: "רוטינות",
    wWeek: "שבוע",
    wMonth: "חודש",
    w3Months: "3 חודשים",
    wAll: "הכול",
    hiddenByFilter: "הנקודה מוסתרת בסינון הנוכחי",
    title: "מפה",
    stats: "{nodes} נקודות · {links} קשרים",
    whichSessions: "אילו סשנים להציג",
    search: "חיפוש במפה",
    fitAll: "הצג הכול",
    refresh: "רענן",
    liveNow: "חי עכשיו",
    uncommitted: "שינויים שלא נשמרו ב-git",
    legend: "קו מקווקו = פתק זיכרון שמדבר על הפרויקט · גלגלת לזום · גרירה להזזה",
    lvlWarn: "דורש טיפול",
    lvlInfo: "כדאי לסדר",
    lvlQuiet: "רדום / לא בשימוש",
    gapsTitle: "סדר בראש",
    gapsHint: "מה דורש תשומת לב, מה חסר ומה רדום. לחיצה מראה את זה במפה.",
    allGood: "הכול מסודר.",
    nHub: "מרכז",
    nBranch: "ענף",
    nProject: "פרויקט",
    nAgent: "אייג'נט",
    nSession: "סשן",
    nSkill: "סקיל",
    nMemory: "פתק זיכרון",
    nTask: "משימה",
    nRoutine: "רוטינה",
    sTodo: "בתור",
    sRunning: "בעבודה",
    sReview: "לבדיקה",
    sDone: "הושלם",
    sOn: "פעילה",
    sOff: "כבויה",
    openProject: "עמוד הפרויקט",
    openChat: "פתח שיחה",
    toAgents: "לאייג'נטים",
    toBoard: "לקנבן",
    close: "סגור",
    active: "פעיל {when}",
    oneSession: "סשן אחד",
    nSessions: "{n} סשנים",
    usedInOne: "שימש ב-{n} סשנים",
    usedInN: "שימש ב-{n} סשנים",
    connected: "מחובר ל-{n}",
  },
  en: {
    tProjects: "Projects",
    tAgents: "Agents",
    tSessions: "Sessions",
    tSkills: "Skills",
    tMemory: "Memory",
    tTasks: "Tasks",
    tRoutines: "Routines",
    wWeek: "Week",
    wMonth: "Month",
    w3Months: "3 months",
    wAll: "All",
    hiddenByFilter: "This item is hidden by the current filter",
    title: "Map",
    stats: "{nodes} nodes · {links} links",
    whichSessions: "Which sessions to show",
    search: "Search the map",
    fitAll: "Fit all",
    refresh: "Refresh",
    liveNow: "Live now",
    uncommitted: "Uncommitted git changes",
    legend: "Dashed line = memory note about the project · Scroll to zoom · Drag to move",
    lvlWarn: "Needs attention",
    lvlInfo: "Worth tidying",
    lvlQuiet: "Dormant / unused",
    gapsTitle: "Clarity check",
    gapsHint: "What needs attention, what's missing and what's dormant. Click to see it on the map.",
    allGood: "All in order.",
    nHub: "Center",
    nBranch: "Branch",
    nProject: "Project",
    nAgent: "Agent",
    nSession: "Session",
    nSkill: "Skill",
    nMemory: "Memory note",
    nTask: "Task",
    nRoutine: "Routine",
    sTodo: "Queued",
    sRunning: "In progress",
    sReview: "In review",
    sDone: "Done",
    sOn: "On",
    sOff: "Off",
    openProject: "Project page",
    openChat: "Open chat",
    toAgents: "Go to agents",
    toBoard: "Go to board",
    close: "Close",
    active: "Active {when}",
    oneSession: "{n} session",
    nSessions: "{n} sessions",
    usedInOne: "Used in {n} session",
    usedInN: "Used in {n} sessions",
    connected: "Connected to {n}",
  },
});
type Key = keyof typeof S.he;

/*
 * מפה: כל מה שיש בגרף אחד, כמו ה-Graph View של Obsidian. המשתמש במרכז כשמש, חמישה ענפים סביבו,
 * והקשרים האמיתיים (סשן ← פרויקט/אייג'נט, פתק זיכרון ← פרויקט) מושכים דברים קשורים זה לזה.
 * בצד: "מה חסר" (מחושב בשרת, map.ts), ובלחיצה על נקודה: פרטים, שכנים ופעולות.
 */

type GNode = MapNode & { x?: number; y?: number; fx?: number; fy?: number; deg?: number };
type GLink = Omit<MapLink, "source" | "target"> & { source: string | GNode; target: string | GNode };

const TYPES: Array<{ type: MapNodeType; label: Key; color: string }> = [
  { type: "project", label: "tProjects", color: "#0a84ff" },
  { type: "agent", label: "tAgents", color: "#ff9f0a" },
  { type: "session", label: "tSessions", color: "#8e8e93" },
  { type: "skill", label: "tSkills", color: "#30b0c7" },
  { type: "memory", label: "tMemory", color: "#bf5af2" },
  { type: "task", label: "tTasks", color: "#ffd60a" },
  { type: "routine", label: "tRoutines", color: "#ff375f" },
];
const COLOR = Object.fromEntries(TYPES.map((t) => [t.type, t.color])) as Record<MapNodeType, string>;
const BRANCH_TYPE: Record<string, MapNodeType> = { "b:projects": "project", "b:agents": "agent", "b:skills": "skill", "b:memory": "memory", "b:auto": "task" };

const DAY = 86_400_000;
const WINDOWS: Array<{ days: number; label: Key }> = [
  { days: 7, label: "wWeek" },
  { days: 30, label: "wMonth" },
  { days: 90, label: "w3Months" },
  { days: 0, label: "wAll" },
];

const idOf = (x: string | GNode) => (typeof x === "string" ? x : x.id);

function nodeColor(n: GNode): string {
  if (n.type === "hub") return "#ff9f0a";
  if (n.type === "branch") return COLOR[BRANCH_TYPE[n.id] ?? "project"];
  if (n.type === "agent" && n.color) return n.color;
  if (n.type === "session" && n.live) return "#30d158";
  return COLOR[n.type];
}

function nodeRadius(n: GNode): number {
  const d = n.deg ?? 1;
  switch (n.type) {
    case "hub":
      return 16;
    case "branch":
      return 9;
    case "project":
      return 4 + Math.min(8, Math.sqrt(n.count ?? 0) * 1.4);
    case "agent":
      return 5 + Math.min(6, Math.sqrt(n.count ?? 0));
    case "session":
      return 2;
    case "memory":
      return 1.8 + Math.min(2.5, d * 0.25);
    default:
      return 2.5 + Math.min(4, d * 0.5);
  }
}

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export default function MapView() {
  const { select, setToast } = useStore();
  const t = useT(S);
  const [data, setData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState<Set<MapNodeType>>(() => new Set(["skill"]));
  const [days, setDays] = useState(30);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<GNode | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraph<GNode, GLink> | null>(null);
  const hoverRef = useRef<{ node: GNode | null; near: Set<string> }>({ node: null, near: new Set() });
  const pickedRef = useRef<GNode | null>(null);
  const qRef = useRef("");
  pickedRef.current = picked;
  qRef.current = q.trim().toLowerCase();

  const load = () => {
    setLoading(true);
    api
      .map()
      .then(setData)
      .catch((e) => setToast((e as Error).message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  // הגרף המסונן: סוגים מוסתרים, וסשנים רק בחלון הזמן. נקודה שנשארה בלי קשר יוצאת (חוץ מפרויקטים, כדי לראות "מה אין")
  const graph = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const keep = new Set<string>();
    for (const n of data.nodes) {
      if (hidden.has(n.type)) continue;
      if (n.type === "session" && days && (!n.lastActive || now - n.lastActive > days * DAY) && !n.live) continue;
      keep.add(n.id);
    }
    const links = data.links.filter((l) => keep.has(l.source) && keep.has(l.target));
    const deg = new Map<string, number>();
    for (const l of links) {
      deg.set(l.source, (deg.get(l.source) ?? 0) + 1);
      deg.set(l.target, (deg.get(l.target) ?? 0) + 1);
    }
    const nodes: GNode[] = data.nodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n, deg: deg.get(n.id) ?? 0, ...(n.type === "hub" ? { fx: 0, fy: 0 } : {}) }));
    return { nodes, links: links.map((l) => ({ ...l })) as GLink[] };
  }, [data, hidden, days]);

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of graph?.links ?? []) {
      const a = idOf(l.source);
      const b = idOf(l.target);
      if (!m.has(a)) m.set(a, new Set());
      if (!m.has(b)) m.set(b, new Set());
      m.get(a)!.add(b);
      m.get(b)!.add(a);
    }
    return m;
  }, [graph]);
  const neighborsRef = useRef(neighbors);
  neighborsRef.current = neighbors;

  // יצירת הגרף פעם אחת
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const fg = new ForceGraph<GNode, GLink>(el);
    fgRef.current = fg;
    const fg_ = fg as unknown as { d3Force: (n: string) => { strength?: (v: number | ((l: GLink) => number)) => unknown; distance?: (v: (l: GLink) => number) => unknown } | undefined };
    fg_.d3Force("charge")?.strength?.(-38);
    fg_.d3Force("link")?.distance?.((l) => (l.kind === "tree" ? (idOf(l.source) === "hub" ? 70 : 42) : 26));
    fg_.d3Force("link")?.strength?.((l) => (l.kind === "tree" ? 0.25 : l.kind === "belongs" ? 0.6 : 0.35));

    const highlighted = (n: GNode) => {
      const h = hoverRef.current.node ?? pickedRef.current;
      if (!h) return true;
      return n.id === h.id || (neighborsRef.current.get(h.id)?.has(n.id) ?? false);
    };
    const matches = (n: GNode) => Boolean(qRef.current) && n.label.toLowerCase().includes(qRef.current);

    fg.backgroundColor("rgba(0,0,0,0)")
      .nodeId("id")
      .cooldownTicks(200)
      .d3VelocityDecay(0.3)
      .nodeLabel(() => "")
      .linkColor((l) => {
        const h = hoverRef.current.node ?? pickedRef.current;
        const on = h && (idOf(l.source) === h.id || idOf(l.target) === h.id);
        const base = cssVar("--color-muted") || "#8e8e93";
        if (on) return nodeColor(h);
        return h ? hexAlpha(base, 0.06) : hexAlpha(base, l.kind === "tree" ? 0.18 : 0.32);
      })
      .linkWidth((l) => {
        const h = hoverRef.current.node ?? pickedRef.current;
        return h && (idOf(l.source) === h.id || idOf(l.target) === h.id) ? 1.6 : l.kind === "tree" ? 0.6 : 0.8;
      })
      .linkLineDash((l) => (l.kind === "about" || l.kind === "mentions" ? [2, 2] : null))
      .nodeCanvasObject((n, ctx, scale) => {
        const r = nodeRadius(n);
        const c = nodeColor(n);
        const on = highlighted(n);
        const hit = matches(n);
        const x = n.x ?? 0;
        const y = n.y ?? 0;
        ctx.globalAlpha = on || hit ? 1 : 0.12;
        if (n.type === "hub") {
          // השמש: הילה רכה סביב העיגול
          const g = ctx.createRadialGradient(x, y, r * 0.4, x, y, r * 3.2);
          g.addColorStop(0, "rgba(255,204,0,0.55)");
          g.addColorStop(0.5, "rgba(255,149,0,0.18)");
          g.addColorStop(1, "rgba(255,149,0,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, r * 3.2, 0, 2 * Math.PI);
          ctx.fill();
        }
        if (n.live || hit) {
          ctx.beginPath();
          ctx.arc(x, y, r + 3 / scale + 1.5, 0, 2 * Math.PI);
          ctx.strokeStyle = hit ? "#ff9f0a" : "#30d158";
          ctx.lineWidth = 1.5 / scale;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 2 * Math.PI);
        ctx.fillStyle = c;
        ctx.fill();
        // פרויקט שדורש תשומת לב: נקודה כתומה קטנה
        if (n.type === "project" && n.git && (n.git.changed > 0 || n.git.ahead > 0)) {
          ctx.beginPath();
          ctx.arc(x + r * 0.75, y - r * 0.75, Math.max(1.6, r * 0.32), 0, 2 * Math.PI);
          ctx.fillStyle = "#ff9500";
          ctx.fill();
        }
        if (n.type === "agent" && n.emoji) {
          ctx.font = `${r * 1.15}px -apple-system, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(n.emoji, x, y + r * 0.05);
        }
        // תוויות: הגדולים תמיד, השאר כשמתקרבים, ומה שמסומן תמיד
        const big = n.type === "hub" || n.type === "branch" || n.type === "project" || n.type === "agent";
        const show = big ? scale > 0.55 : scale > 2.2 || hit || hoverRef.current.node?.id === n.id || pickedRef.current?.id === n.id;
        if (show && (on || hit)) {
          const fs = n.type === "hub" ? 14 : n.type === "branch" ? 11 : big ? 10 : 9;
          ctx.font = `${n.type === "hub" || n.type === "branch" ? "600 " : ""}${fs / Math.max(scale, 0.8)}px -apple-system, "SF Hebrew", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = cssVar("--color-foreground") || "#1c1c1e";
          const label = n.label.length > 34 ? n.label.slice(0, 33) + "…" : n.label;
          ctx.fillText(label, x, y + r + 2 / scale);
        }
        ctx.globalAlpha = 1;
      })
      .nodePointerAreaPaint((n, color, ctx) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x ?? 0, n.y ?? 0, nodeRadius(n) + 2, 0, 2 * Math.PI);
        ctx.fill();
      })
      .onNodeHover((n) => {
        hoverRef.current = { node: n, near: n ? (neighborsRef.current.get(n.id) ?? new Set()) : new Set() };
        el.style.cursor = n ? "pointer" : "";
      })
      .onNodeClick((n) => {
        setPicked(n);
        fg.centerAt(n.x, n.y, 500);
      })
      .onBackgroundClick(() => setPicked(null));

    const ro = new ResizeObserver(() => fg.width(el.clientWidth).height(el.clientHeight));
    ro.observe(el);
    return () => {
      ro.disconnect();
      fg._destructor();
      fgRef.current = null;
    };
  }, []);

  // נתונים חדשים: שומרים מיקומים של נקודות שכבר היו, כדי שהגרף לא "יתפוצץ" בכל סינון
  const first = useRef(true);
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg || !graph) return;
    const prev = new Map(fg.graphData().nodes.map((n) => [n.id, n]));
    for (const n of graph.nodes) {
      const p = prev.get(n.id);
      if (p) {
        n.x = p.x;
        n.y = p.y;
      }
    }
    fg.graphData(graph);
    if (first.current) {
      first.current = false;
      fg.onEngineStop(() => {
        fg.zoomToFit(600, 40);
        fg.onEngineStop(() => undefined);
      });
    }
  }, [graph]);

  // פתק זיכרון: טוענים את הטקסט לפאנל
  useEffect(() => {
    setNote(null);
    if (picked?.type !== "memory" || !picked.path) return;
    api
      .mapNote(picked.path)
      .then((r) => setNote(r.text.replace(/^---[\s\S]*?\n---\n?/, "").trim()))
      .catch(() => setNote(null));
  }, [picked]);

  const focus = (id: string) => {
    const fg = fgRef.current;
    const n = fg?.graphData().nodes.find((x) => x.id === id);
    if (!fg || !n) {
      setToast(tr(S, "hiddenByFilter"));
      return;
    }
    setPicked(n);
    fg.centerAt(n.x, n.y, 600);
    fg.zoom(3, 600);
  };

  const searchHits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle || !graph) return [];
    return graph.nodes.filter((n) => n.label.toLowerCase().includes(needle)).slice(0, 8);
  }, [q, graph]);

  const counts = useMemo(() => {
    const c = new Map<MapNodeType, number>();
    for (const n of data?.nodes ?? []) c.set(n.type, (c.get(n.type) ?? 0) + 1);
    return c;
  }, [data]);

  const pickedNeighbors = useMemo(() => {
    if (!picked || !graph) return [];
    const ids = neighbors.get(picked.id) ?? new Set();
    return graph.nodes.filter((n) => ids.has(n.id) && n.type !== "branch" && n.type !== "hub").sort((a, b) => a.type.localeCompare(b.type) || (b.lastActive ?? 0) - (a.lastActive ?? 0));
  }, [picked, graph, neighbors]);

  const toggle = (type: MapNodeType) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(type)) n.delete(type);
      else n.add(type);
      return n;
    });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="drag flex items-center gap-3 px-5 pt-4 pb-3 flex-wrap">
        <Orbit className="size-5 text-amber" />
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <span className="text-xs text-muted tabular">{data ? t("stats", { nodes: data.nodes.length, links: data.links.length }) : ""}</span>
        <div className="no-drag flex items-center gap-1.5 flex-wrap ms-2">
          {TYPES.map((ty) => (
            <button
              key={ty.type}
              onClick={() => toggle(ty.type)}
              className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition", hidden.has(ty.type) ? "text-muted bg-transparent opacity-60" : "bg-surface shadow-[0_1px_2px_rgba(0,0,0,.08)]")}
            >
              <span className="size-2 rounded-full" style={{ background: hidden.has(ty.type) ? "transparent" : ty.color, border: `1.5px solid ${ty.color}` }} />
              {t(ty.label)}
              <span className="text-muted tabular">{counts.get(ty.type) ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="no-drag flex items-center gap-2 ms-auto">
          <div className="segmented text-xs" title={t("whichSessions")}>
            {WINDOWS.map((w) => (
              <button key={w.days} data-active={days === w.days} onClick={() => setDays(w.days)} className="px-2.5 whitespace-nowrap">
                {t(w.label)}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="size-3.5 absolute top-1/2 -translate-y-1/2 start-2.5 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="w-44 rounded-full bg-[var(--color-fill)] ps-8 pe-3 py-1.5 text-sm outline-none" />
            {searchHits.length > 0 && (
              <div className="absolute top-full mt-1 start-0 z-20 w-64 card p-1 shadow-xl">
                {searchHits.map((n) => (
                  <button key={n.id} onClick={() => focus(n.id)} className="w-full text-start flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--color-fill)]">
                    <span className="size-2 rounded-full shrink-0" style={{ background: nodeColor(n) }} />
                    <span className="truncate" dir="auto">
                      {n.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => fgRef.current?.zoomToFit(500, 40)} className="tool-btn" title={t("fitAll")}>
            <Maximize className="size-4" />
          </button>
          <button onClick={load} className="tool-btn" title={t("refresh")}>
            {loading ? <Spinner className="size-4" /> : <RefreshCw className="size-4" />}
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex gap-3 px-3 pb-3">
        <div className="relative flex-1 min-w-0 card overflow-hidden" style={{ background: "radial-gradient(circle at 50% 50%, color-mix(in srgb, #ff9f0a 7%, var(--color-surface)), var(--color-surface) 60%)" }}>
          <div ref={boxRef} className="absolute inset-0" />
          {!data && (
            <div className="absolute inset-0 grid place-items-center text-muted text-sm">
              <Spinner className="size-5" />
            </div>
          )}
          <div className="absolute bottom-3 start-3 text-[11px] text-muted space-y-0.5 pointer-events-none">
            <div>
              <span className="inline-block size-2 rounded-full bg-[#30d158] me-1" /> {t("liveNow")} · <span className="inline-block size-2 rounded-full bg-[#ff9500] me-1" /> {t("uncommitted")}
            </div>
            <div>{t("legend")}</div>
          </div>
        </div>

        <aside className="w-80 shrink-0 card p-0 flex flex-col overflow-hidden">
          {picked ? (
            <Details
              node={picked}
              note={note}
              neighbors={pickedNeighbors}
              onClose={() => setPicked(null)}
              onFocus={focus}
              onOpen={(n) => {
                if (n.type === "project" && n.path) select({ kind: "project", cwd: n.path });
                else if (n.type === "session" && n.sessionId) select({ kind: "history", sessionId: n.sessionId });
                else if (n.type === "agent") select({ kind: "agents" });
                else if (n.type === "task" || n.type === "routine") select({ kind: "board" });
              }}
            />
          ) : (
            <Gaps gaps={data?.gaps ?? []} onFocus={focus} />
          )}
        </aside>
      </div>
    </div>
  );
}

function hexAlpha(c: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return c;
  const v = parseInt(m[1], 16);
  return `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`;
}

const LEVEL = {
  warn: { label: "lvlWarn", icon: AlertTriangle, cls: "text-amber" },
  info: { label: "lvlInfo", icon: Info, cls: "text-blue" },
  quiet: { label: "lvlQuiet", icon: Moon, cls: "text-muted" },
} as const;

/** "מה חסר": רשימה מקובצת לפי חומרה. לחיצה ממקדת את הנקודה במפה */
function Gaps({ gaps, onFocus }: { gaps: MapGap[]; onFocus: (id: string) => void }) {
  const t = useT(S);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <div>
        <div className="font-semibold">{t("gapsTitle")}</div>
        <div className="text-xs text-muted mt-0.5">{t("gapsHint")}</div>
      </div>
      {!gaps.length && <div className="text-sm text-muted">{t("allGood")}</div>}
      {(["warn", "info", "quiet"] as const).map((lvl) => {
        const list = gaps.filter((g) => g.level === lvl);
        if (!list.length) return null;
        const L = LEVEL[lvl];
        return (
          <div key={lvl} className="space-y-1">
            <div className={cn("flex items-center gap-1.5 text-xs font-medium", L.cls)}>
              <L.icon className="size-3.5" /> {t(L.label)} <span className="text-muted tabular">{list.length}</span>
            </div>
            {list.map((g, i) => (
              <button key={g.id + i} onClick={() => onFocus(g.id)} className="w-full text-start rounded-lg px-2 py-1.5 text-[13px] hover:bg-[var(--color-fill)]" dir="auto">
                {g.text}
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const TYPE_LABEL: Record<MapNodeType, Key> = { hub: "nHub", branch: "nBranch", project: "nProject", agent: "nAgent", session: "nSession", skill: "nSkill", memory: "nMemory", task: "nTask", routine: "nRoutine" };
const STATUS: Record<string, Key> = { todo: "sTodo", running: "sRunning", review: "sReview", done: "sDone", on: "sOn", off: "sOff" };

function Details({ node: n, note, neighbors, onClose, onFocus, onOpen }: { node: GNode; note: string | null; neighbors: GNode[]; onClose: () => void; onFocus: (id: string) => void; onOpen: (n: GNode) => void }) {
  const t = useT(S);
  const openLabel = n.type === "project" ? { t: t("openProject"), i: FolderOpen } : n.type === "session" ? { t: t("openChat"), i: MessageSquare } : n.type === "agent" ? { t: t("toAgents"), i: Bot } : n.type === "task" || n.type === "routine" ? { t: t("toBoard"), i: KanbanSquare } : null;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="p-4 pb-3 space-y-2 border-b border-[var(--color-separator)]">
        <div className="flex items-start gap-2">
          <span className="size-3 rounded-full mt-1.5 shrink-0" style={{ background: nodeColor(n) }} />
          <div className="min-w-0 flex-1">
            <div className="text-xs text-muted">
              {t(TYPE_LABEL[n.type])}
              {n.group ? ` · ${n.group}` : ""}
            </div>
            <div className="font-semibold break-words" dir="auto">
              {n.emoji ? `${n.emoji} ` : ""}
              {n.label}
            </div>
          </div>
          <button onClick={onClose} className="tool-btn shrink-0" title={t("close")}>
            <X className="size-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {n.live && <span className="text-teal">● {t("liveNow")}</span>}
          {n.lastActive ? <span>{t("active", { when: relTime(n.lastActive) })}</span> : null}
          {n.type === "project" && <span className="tabular">{t((n.count ?? 0) === 1 ? "oneSession" : "nSessions", { n: n.count ?? 0 })}</span>}
          {n.type === "agent" && <span className="tabular">{t((n.count ?? 0) === 1 ? "usedInOne" : "usedInN", { n: n.count ?? 0 })}</span>}
          {n.status && <span>{STATUS[n.status] ? t(STATUS[n.status]) : n.status}</span>}
          {n.git && (
            <span className="ltr">
              {n.git.branch ?? "?"}
              {n.git.changed ? ` · ${n.git.changed} changed` : ""}
              {n.git.ahead ? ` · ${n.git.ahead}↑` : ""}
              {!n.git.remote ? " · no remote" : ""}
            </span>
          )}
        </div>
        {n.path && <div className="ltr text-[11px] text-muted truncate" title={n.path}>{n.path}</div>}
        {n.description && (
          <div className="text-[13px] text-muted line-clamp-4" dir="auto">
            {n.description}
          </div>
        )}
        {openLabel && (
          <button onClick={() => onOpen(n)} className="btn-primary rounded-full px-3 py-1.5 text-sm flex items-center gap-1.5">
            <openLabel.i className="size-4" /> {openLabel.t}
          </button>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {note && <pre className="whitespace-pre-wrap text-[12px] leading-relaxed rounded-xl bg-[var(--color-fill)] p-3 max-h-72 overflow-y-auto" dir="auto">{note}</pre>}
        <div>
          <div className="text-xs text-muted px-1 mb-1">{t("connected", { n: neighbors.length })}</div>
          {neighbors.slice(0, 80).map((x) => (
            <button key={x.id} onClick={() => onFocus(x.id)} className="w-full text-start flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-[var(--color-fill)]">
              <span className="size-2 rounded-full shrink-0" style={{ background: nodeColor(x) }} />
              <span className="truncate flex-1" dir="auto">
                {x.label}
              </span>
              <span className="text-[11px] text-muted shrink-0">{t(TYPE_LABEL[x.type])}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
