import { providerLabel, useProviders } from "../lib/providers";
import { useEffect, useMemo, useState } from "react";
import type { TranscriptHit } from "../api";
import { Plus, Search, ChevronDown, Pencil, FolderOpen, Pin, PinOff, EyeOff, Eye, MoreHorizontal, Archive, ArchiveRestore, Trash2, TextCursorInput, GitBranch, Columns2, XCircle, FolderInput } from "lucide-react";
import { useStore, type ChatSel, type GroupBy } from "../store";
import { isRTL, strings, tr, useT } from "../i18n";
import { SESSION_DRAG } from "../lib/split";
import { prefetchHistory } from "../lib/historyCache";
import MoveToProject from "./MoveToProject";
import SidebarResize from "./SidebarResize";
import { api } from "../api";
import { send } from "../ws";
import { refreshSessions, refreshThemes } from "../App";
import { cn, listTime, readableColor, shortTime } from "../lib/util";
import { groupByAgent, groupByProject, projectVisual, rowAgent, type Group } from "../lib/groups";
import StatusDot from "./StatusDot";
import Avatar from "./Avatar";
import { ThemeEditor } from "./AgentPicker";
import type { SessionRow } from "../../../shared/protocol";
import { ask, askText } from "../lib/dialog";

/** סשנים = רשימה שטוחה לפי זמן. פרויקטים = שיחות ישירות תחת הפרויקט ואייג'נטים כתת-קבוצה (לשעבר "משולב") */
type Mode = GroupBy | "sessions";


const S = strings({
  he: {
    sessions: "סשנים", projects: "פרויקטים", agents: "אייג'נטים",
    today: "היום", yesterday: "אתמול", thisWeek: "השבוע", thisMonth: "החודש", earlier: "קודם",
    terminal: "טרמינל", rename: "שם חדש לסשן", deleteConfirm: 'למחוק לצמיתות את "{title}"? התמליל יימחק מהדיסק.',
    untitled: "שיחה בלי כותרת", rowHint: "לחיצה פותחת בחלונית הראשית · ⌘-לחיצה פותחת בחלונית נוספת ליד",
    liveHere: "חי במפקדה", runsIn: "רץ ב-{where}", finishedAway: "סיים בזמן שלא היית כאן", approval: "אישור",
    actions: "פעולות", moveToProject: "העבר לפרויקט...", openBeside: "פתח לצד", unpin: "בטל נעיצה", pinTop: "נעץ למעלה",
    closeNow: "סגור מיד", renameAction: "שנה שם", restore: "שחזר מהארכיון", archive: "לארכיון", delete: "מחק",
    collapse: "קפל", expand: "פתח", activeN: "{n} פעילים", projectPage: "עמוד הפרויקט", show: "הצג", hideFromList: "הסתר מהרשימה",
    style: "עיצוב", projectStyle: "עיצוב הפרויקט {name}", styleOf: "עיצוב {name}",
    dashboard: "לוח הבקרה", appName: "מפקדה", connected: "מחובר לשרת", disconnected: "אין חיבור לשרת", settings: "הגדרות", new: "חדש",
    inbox: "ממתין לך", board: "קנבן", repos: "מאגרים", map: "מפה", dash: "לוח",
    search: "חיפוש סשן או פרויקט", inTranscripts: "בתוך השיחות", noSessions: "אין סשנים עדיין", pinned: "נעוצים",
    hiddenN: "{n} מוסתרים", archivedN: "{n} בארכיון", shown: "(מוצג)", taskBranch: "משימה שרצה בענף נפרד",
  },
  en: {
    sessions: "Sessions", projects: "Projects", agents: "Agents",
    today: "Today", yesterday: "Yesterday", thisWeek: "This week", thisMonth: "This month", earlier: "Earlier",
    terminal: "Terminal", rename: "New name for the session", deleteConfirm: 'Delete "{title}" permanently? The transcript will be deleted from disk.',
    untitled: "Untitled session", rowHint: "Click to open in the main pane · ⌘-click to open in another pane beside",
    liveHere: "Live in Mifkada", runsIn: "Running in {where}", finishedAway: "Finished while you were away", approval: "Approval",
    actions: "Actions", moveToProject: "Move to project...", openBeside: "Open beside", unpin: "Unpin", pinTop: "Pin to top",
    closeNow: "Close now", renameAction: "Rename", restore: "Restore from archive", archive: "Archive", delete: "Delete",
    collapse: "Collapse", expand: "Expand", activeN: "{n} active", projectPage: "Project page", show: "Show", hideFromList: "Hide from the list",
    style: "Style", projectStyle: "Style for project {name}", styleOf: "Style for {name}",
    dashboard: "Dashboard", appName: "Mifkada", connected: "Connected to the server", disconnected: "No connection to the server", settings: "Settings", new: "New",
    inbox: "Waiting for you", board: "Board", repos: "Repositories", map: "Map", dash: "Dashboard",
    search: "Search sessions or projects", inTranscripts: "In conversations", noSessions: "No sessions yet", pinned: "Pinned",
    hiddenN: "{n} hidden", archivedN: "{n} archived", shown: "(shown)", taskBranch: "A task running on a separate branch",
  },
});

const MODES: Array<{ value: Mode; readonly label: string }> = [
  { value: "sessions", get label() { return tr(S, "sessions"); } },
  { value: "project", get label() { return tr(S, "projects"); } },
  { value: "agent", get label() { return tr(S, "agents"); } },
];

function readMode(): Mode {
  const m = localStorage.getItem("mifkada.sidebarMode");
  return m === "sessions" || m === "agent" ? m : "project";
}

/** כותרת זמן לרשימה השטוחה */
function timeBucket(t: number, now = new Date()): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= day) return tr(S, "today");
  if (t >= day - 86_400_000) return tr(S, "yesterday");
  if (t >= day - 6 * 86_400_000) return tr(S, "thisWeek");
  if (t >= day - 30 * 86_400_000) return tr(S, "thisMonth");
  return tr(S, "earlier");
}

function entryLabel(entrypoint: string): string {
  if (entrypoint.includes("vscode")) return "VS Code";
  if (entrypoint.includes("sdk")) return "SDK";
  return tr(S, "terminal");
}

export default function Sidebar() {
  const t = useT(S);
  const { sessions, agents, selection, select, projectThemes, focusProject, setFocusProject, sessionMeta, setToast, unread, sidebarWidth } = useStore();
  const [showArchived, setShowArchived] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [moveFor, setMoveFor] = useState<string | null>(null);

  // חמש השיחות האחרונות נטענות מראש כשהחלון פנוי, כדי שפתיחה שלהן תהיה מיידית
  const recentKey = [...sessions].sort((x, y) => y.lastModified - x.lastModified).slice(0, 5).map((r) => `${r.sessionId}:${r.lastModified}`).join(",");
  useEffect(() => {
    if (!recentKey) return;
    const id = setTimeout(() => {
      for (const part of recentKey.split(",")) {
        const [sid, stamp] = part.split(":");
        prefetchHistory(sid, Number(stamp));
      }
    }, 1500);
    return () => clearTimeout(id);
  }, [recentKey]);

  const archivedCount = sessions.filter((s) => sessionMeta[s.sessionId]?.archived).length;
  const pinnedRows = sessions.filter((s) => sessionMeta[s.sessionId]?.pinned && !sessionMeta[s.sessionId]?.archived);
  const [mode, setMode] = useState<Mode>(readMode);
  const [q, setQ] = useState("");
  const [transcriptHits, setTranscriptHits] = useState<TranscriptHit[]>([]);
  useEffect(() => {
    if (q.trim().length < 3) return setTranscriptHits([]);
    const id = setTimeout(() => {
      api
        .sessionSearch(q.trim())
        .then(setTranscriptHits)
        .catch(() => setTranscriptHits([]));
    }, 350);
    return () => clearTimeout(id);
  }, [q]);
  // קבוצות מקופלות נשמרות בין הפעלות, כדי שהסדר שבחרת יישאר
  const [collapsed, setCollapsedState] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("mifkada.sidebar.collapsed") || "{}") as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const setCollapsed = (fn: (c: Record<string, boolean>) => Record<string, boolean>) =>
    setCollapsedState((c) => {
      const next = fn(c);
      try {
        localStorage.setItem("mifkada.sidebar.collapsed", JSON.stringify(next));
      } catch {
        /* אין אחסון */
      }
      return next;
    });
  const [editing, setEditing] = useState<string | null>(null);

  const changeMode = (m: Mode) => {
    localStorage.setItem("mifkada.sidebarMode", m);
    setMode(m);
  };

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pool = showArchived ? sessions : sessions.filter((s) => !sessionMeta[s.sessionId]?.archived);
    const filtered = needle ? pool.filter((s) => (s.title + " " + s.project + " " + s.cwd).toLowerCase().includes(needle)) : pool;
    return mode === "agent" ? groupByAgent(filtered, agents) : groupByProject(filtered, projectThemes, agents, true);
  }, [sessions, agents, projectThemes, mode, q, showArchived, sessionMeta]);
  // הרשימה השטוחה: אותו סינון (חיפוש, ארכיון, פרויקטים מוסתרים), מהחדש לישן, מחולקת לפי זמן
  const timeline = useMemo(() => {
    if (mode !== "sessions") return [];
    const rows = groups.filter((g) => showHidden || !g.hidden).flatMap((g) => g.rows);
    rows.sort((a, b) => b.lastModified - a.lastModified);
    const out: Array<{ label: string; rows: SessionRow[] }> = [];
    for (const r of rows) {
      const label = timeBucket(r.lastModified);
      if (out.at(-1)?.label !== label) out.push({ label, rows: [] });
      out.at(-1)!.rows.push(r);
    }
    return out;
  }, [groups, mode, showHidden]);
  const visibleGroups = showHidden ? groups : groups.filter((g) => !g.hidden);
  const hiddenCount = groups.filter((g) => g.hidden).length;

  // לחיצה על פרויקט בלוח הבקרה: לפתוח רק אותו ולגלול אליו
  useEffect(() => {
    if (!focusProject) return;
    if (mode !== "project") changeMode("project");
    const next: Record<string, boolean> = {};
    for (const g of groups) next[g.key] = g.cwd !== focusProject;
    setCollapsed(() => next);
    setFocusProject(null);
    requestAnimationFrame(() => document.getElementById(`group-project:${focusProject}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, [focusProject, groups, mode, setFocusProject]);

  const isSelected = (r: SessionRow) =>
    (selection?.kind === "live" && r.live?.liveId === selection.liveId) || (selection?.kind === "history" && !r.live && r.sessionId === selection.sessionId);

  const providers = useProviders();

  const byAgent = new Map(agents.map((a) => [a.slug, a]));
  // לחיצה על סשן מחליפה את החלונית הראשית; ⌘-לחיצה פותחת אותו בחלונית נוספת ליד מה שפתוח (עד 6 על המסך). כמו ב-ActivityBar
  const openRow = (c: ChatSel, beside: boolean) => (beside ? useStore.getState().openBeside(c) : select(c));
  const projectCwds = useMemo(() => [...new Set(sessions.map((s) => s.projectCwd || s.cwd))], [sessions]);
  // חיים במפקדה (מגיע מיד ב-WebSocket) + רצים בטרמינל/VS Code

  const act = (fn: () => Promise<unknown>) => () => {
    setMenuFor(null);
    fn()
      .then(() => {
        refreshSessions();
        refreshThemes();
      })
      .catch((e: Error) => setToast(e.message));
  };
  const renameRow = async (r: SessionRow) => {
    const title = await askText(t("rename"), r.title);
    if (title && title.trim() && title.trim() !== r.title) act(() => api.rename(r.sessionId, title.trim()))();
    else setMenuFor(null);
  };
  const deleteRow = async (r: SessionRow) => {
    if (await ask(t("deleteConfirm", { title: r.title }), { danger: true })) act(() => api.deleteSession(r.sessionId))();
    else setMenuFor(null);
  };
  const toggleProject = (g: Group, key: "pinned" | "hidden") => act(() => api.setTheme("projects", g.cwd!, { [key]: !g[key] }));

  const saveTheme = async (g: Group, t: { color: string; emoji: string; displayName: string; image?: string }) => {
    if (g.cwd) await api.setTheme("projects", g.cwd, t);
    else if (g.agent) await api.setTheme("agents", g.agent.slug, t);
    refreshThemes();
    useStore.getState().setAgents(await api.agents());
  };

  const renderRow = (r: SessionRow, showProject: boolean, hideAgent: boolean) => {
    const a = hideAgent ? undefined : byAgent.get(rowAgent(r) ?? "");
    const archived = Boolean(sessionMeta[r.sessionId]?.archived);
    const rowKey = r.live?.liveId ?? r.sessionId;
    const sel = isSelected(r);
    const running = Boolean(r.live || r.external);
    const approval = Boolean(r.live && r.live.pendingPermissions > 0);
    // שורה שנייה רק כשיש בה מידע שלא ברור מהקבוצה
    // שורה שנייה רק כשיש בה משהו: האייג'נט. הפרויקט כבר באווטאר, והמצב בנקודה שליד הכותרת
    // סשן של משימה שרצה בענף נפרד (worktree): מסומן בשם הענף, כדי שיהיה ברור שזו עבודה צדדית בתוך הפרויקט
    const branch = /[\\/]\.mifkada-worktrees[\\/]/.test(r.cwd) ? (r.gitBranch ?? "") : "";
    const meta = Boolean(a) || Boolean(branch) || (showProject && !projectCwds.length);
    // ברשימה השטוחה (ובנעוצים / לפי אייג'נט): אווטאר של הפרויקט בתחילת השורה, ונורת הסטטוס עליו
    const pv = showProject ? projectVisual(r.projectCwd || r.cwd, projectCwds, projectThemes) : null;
    const unreadDot = Boolean(r.live && unread[r.live.liveId] && !sel);
    const title = r.title.trim() || t("untitled");
    return (
      <div key={rowKey} className="relative group/row">
      <button
        onClick={(e) => {
          openRow(r.live ? { kind: "live", liveId: r.live.liveId } : { kind: "history", sessionId: r.sessionId }, e.metaKey);
        }}
        title={`${t("rowHint")}${r.live ? `\n${t("liveHere")}` : r.external ? `\n${t("runsIn", { where: entryLabel(r.external.entrypoint) })}` : ""}`}
        onMouseEnter={() => prefetchHistory(r.sessionId, r.lastModified)}
        draggable
        onDragStart={(e) => {
          const c = r.live ? { kind: "live", liveId: r.live.liveId } : { kind: "history", sessionId: r.sessionId };
          e.dataTransfer.setData(SESSION_DRAG, JSON.stringify(c));
          e.dataTransfer.setData("text/plain", r.title);
          e.dataTransfer.effectAllowed = "copy";
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuFor(rowKey);
        }}
        data-sel={sel || undefined}
        className={cn(
          "session-row w-[calc(100%-0.75rem)] mx-1.5 my-px text-start rounded-[10px] px-2.5 py-2 transition",
          sel ? "bg-blue text-white shadow-[0_1px_2px_rgba(0,0,0,.12)]" : "hover:bg-[var(--color-fill)]",
          archived && "opacity-60",
        )}
      >
        <div className="flex items-start gap-2.5">
        {pv && (
          <span className="shrink-0 mt-0.5">
            <Avatar emoji={pv.emoji} color={pv.color} image={pv.image} size="sm" square />
          </span>
        )}
        <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {(unreadDot ? <span className="size-2.5 rounded-full bg-blue shrink-0" title={t("finishedAway")} /> : running && <StatusDot state={r.live?.state} external={r.external?.status} />)}
          <span dir="auto" className={cn("truncate flex-1 min-w-0 text-[14.5px] leading-snug", !sel && !running && "text-foreground/85", !r.title.trim() && !sel && "text-muted italic")}>
            {title}
          </span>
          {r.provider && r.provider !== "claude" && <span className={cn("rounded-full px-1.5 text-[10.5px] font-medium shrink-0 ltr", sel ? "bg-white/20 text-white" : "bg-[var(--color-fill)] text-muted")}>{providerLabel(r.provider, providers)}</span>}
          {archived && <Archive className="size-3 opacity-60 shrink-0" />}
          {approval && <span className={cn("rounded-full px-1.5 text-[10.5px] font-medium shrink-0", sel ? "bg-white/25 text-white" : "bg-warn/15 text-warn")}>{t("approval")}</span>}
          <span className={cn("text-[11.5px] tabular shrink-0 transition-opacity group-hover/row:opacity-0", sel ? "text-white/75" : "text-muted/80")}>{mode === "sessions" ? listTime(r.lastModified) : shortTime(r.lastModified)}</span>
        </div>
        {meta && (
          <div className={cn("flex items-center gap-1.5 text-[12px] mt-0.5", running && !pv && "ps-4", sel ? "text-white/75" : "text-muted")}>
            {branch && (
              <span className={cn("flex items-center gap-1 shrink-0 rounded-full px-1.5", sel ? "bg-white/20" : "bg-[var(--color-fill)]")} title={t("taskBranch")}>
                <GitBranch className="size-3" />
                <span className="ltr truncate max-w-[9rem]">{branch.replace(/^mifkada\//, "")}</span>
              </span>
            )}
            {a ? (
              <span className="truncate" style={sel ? undefined : { color: readableColor(a.color) }}>
                {a.emoji} {a.name}
              </span>
            ) : branch ? null : (
              <span className="truncate">{r.project}</span>
            )}
          </div>
        )}
        </div>
        </div>
      </button>
      <button
        onClick={() => setMenuFor(menuFor === rowKey ? null : rowKey)}
        className={cn("absolute top-1.5 end-1.5 p-1 rounded text-muted hover:bg-surface-2 hover:text-foreground transition", menuFor === rowKey ? "opacity-100" : "opacity-0 group-hover/row:opacity-100")}
        title={t("actions")}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {moveFor === rowKey && <MoveToProject row={r} onDone={() => setMoveFor(null)} />}
      {menuFor === rowKey && (
        <div className="no-drag absolute top-8 end-2 z-30 card p-1 w-48 text-sm shadow-2xl">
          <button
            onClick={() => {
              setMenuFor(null);
              setMoveFor(rowKey);
            }}
            className="w-full text-start px-2.5 py-1.5 rounded-lg hover:bg-surface-2 flex items-center gap-2"
          >
            <FolderInput className="size-4 text-muted" /> {t("moveToProject")}
          </button>
          <button
            onClick={() => {
              setMenuFor(null);
              useStore.getState().openBeside(r.live ? { kind: "live", liveId: r.live.liveId } : { kind: "history", sessionId: r.sessionId });
            }}
            className="w-full text-start px-2.5 py-1.5 rounded-lg hover:bg-surface-2 flex items-center gap-2"
          >
            <Columns2 className="size-4 text-muted" /> {t("openBeside")}
          </button>
          <button
            onClick={act(async () => {
              setMenuFor(null);
              await api.pin(r.sessionId, !sessionMeta[r.sessionId]?.pinned);
              refreshThemes();
            })}
            className="w-full text-start px-2.5 py-1.5 rounded-lg hover:bg-surface-2 flex items-center gap-2"
          >
            {sessionMeta[r.sessionId]?.pinned ? <PinOff className="size-4 text-muted" /> : <Pin className="size-4 text-muted" />} {sessionMeta[r.sessionId]?.pinned ? t("unpin") : t("pinTop")}
          </button>
          {r.live && (
            <button
              onClick={() => {
                setMenuFor(null);
                send({ t: "close", liveId: r.live!.liveId });
                if (selection?.kind === "live" && selection.liveId === r.live!.liveId) select(null);
              }}
              className="w-full text-start px-2.5 py-1.5 rounded-lg hover:bg-surface-2 flex items-center gap-2"
            >
              <XCircle className="size-4 text-muted" /> {t("closeNow")}
            </button>
          )}
          <button onClick={() => renameRow(r)} className="w-full text-start px-2.5 py-1.5 rounded-lg hover:bg-surface-2 flex items-center gap-2">
            <TextCursorInput className="size-4 text-muted" /> {t("renameAction")}
          </button>
          <button onClick={act(() => api.archive(r.sessionId, !archived))} className="w-full text-start px-2.5 py-1.5 rounded-lg hover:bg-surface-2 flex items-center gap-2">
            {archived ? <ArchiveRestore className="size-4 text-muted" /> : <Archive className="size-4 text-muted" />} {archived ? t("restore") : t("archive")}
          </button>
          <button onClick={() => deleteRow(r)} className="w-full text-start px-2.5 py-1.5 rounded-lg hover:bg-danger/20 text-danger flex items-center gap-2">
            <Trash2 className="size-4" /> {t("delete")}
          </button>
        </div>
      )}
      </div>
    );
  };

  const renderGroup = (g: Group, depth: number) => {
    const open = !collapsed[g.key];
    const editable = Boolean(g.cwd || g.agent);
    const sub = depth > 0;
    const loose = g.loose ?? (g.sub ? [] : g.rows);
    // היררכיה ברורה: כותרת הפרויקט (או האייג'נט), ומתחתיה הילדים מוזחים עם קו מנחה. קבוצת אייג'נט בתוך פרויקט מקבלת קו
    // בצבע של האייג'נט, כך שרואים בבירור איזו שיחה שייכת למה
    return (
      <section key={g.key} id={`group-${g.key}`} style={{ "--agent-color": g.visual.color } as React.CSSProperties} className={cn(sub ? "mt-0.5" : "mb-2")}>
        <div className={cn("group/h relative flex items-center gap-1 bg-sidebar", sub ? "pe-2 py-0.5" : "px-1.5 py-1 sticky top-0 z-10")}>
          <button
            onClick={() => setCollapsed((c) => ({ ...c, [g.key]: open }))}
            className="group-head flex items-center gap-2 flex-1 min-w-0 text-start rounded-[10px] px-1.5 py-1 hover:bg-[var(--color-fill)] transition"
            title={open ? t("collapse") : t("expand")}
          >
            <ChevronDown className={cn("size-4 text-muted shrink-0 transition-transform", !open && (isRTL() ? "rotate-90" : "-rotate-90"))} />
            <Avatar emoji={g.visual.emoji} color={g.visual.color} image={g.visual.image} size={sub ? "sm" : "md"} square={g.visual.square} />
            <span className={cn("truncate", sub ? "text-[13.5px] font-medium" : "text-[15px] font-semibold")} style={sub && g.agent ? { color: readableColor(g.visual.color) } : undefined}>
              {g.visual.name}
            </span>
            <span className="rounded-full bg-[var(--color-fill)] px-1.5 text-[11px] leading-[18px] tabular text-muted shrink-0">{g.rows.length}</span>
            {g.active > 0 && <span className="size-2 rounded-full bg-ok shrink-0" title={t("activeN", { n: g.active })} />}
          </button>
          {g.cwd && (
            <button onClick={() => select({ kind: "project", cwd: g.cwd! })} className={cn("transition p-1 rounded hover:bg-surface-2", selection?.kind === "project" && selection.cwd === g.cwd ? "opacity-100 text-accent" : "opacity-0 group-hover/h:opacity-100 text-muted")} title={t("projectPage")}>
              <FolderOpen className="size-4" />
            </button>
          )}
          {g.cwd && (
            <>
              <button onClick={() => toggleProject(g, "pinned")()} className={cn("transition p-1 rounded hover:bg-surface-2", g.pinned ? "opacity-100 text-amber" : "opacity-0 group-hover/h:opacity-100 text-muted")} title={g.pinned ? t("unpin") : t("pinTop")}>
                {g.pinned ? <Pin className="size-4" /> : <PinOff className="size-4" />}
              </button>
              <button onClick={() => toggleProject(g, "hidden")()} className={cn("transition p-1 rounded hover:bg-surface-2", g.hidden ? "opacity-100 text-muted" : "opacity-0 group-hover/h:opacity-100 text-muted")} title={g.hidden ? t("show") : t("hideFromList")}>
                {g.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
              </button>
            </>
          )}
          {editable && (
            <button onClick={() => setEditing(editing === g.key ? null : g.key)} className="opacity-0 group-hover/h:opacity-100 transition p-1 rounded hover:bg-surface-2" title={t("style")}>
              <Pencil className="size-3.5 text-muted" />
            </button>
          )}
          {editing === g.key && (
            <ThemeEditor
              title={g.cwd ? t("projectStyle", { name: g.visual.name }) : t("styleOf", { name: g.visual.name })}
              initial={{ color: g.visual.color, emoji: g.visual.emoji, name: g.visual.name, image: g.visual.image }}
              onSave={(th) => saveTheme(g, th)}
              onClose={() => setEditing(null)}
            />
          )}
        </div>
        {open && (g.sub?.length || loose.length) ? (
          <div
            className={cn("border-s-2 ps-1", sub ? "ms-[21px]" : "ms-[25px]")}
            style={{ borderColor: sub ? `color-mix(in oklab, ${g.visual.color} 45%, transparent)` : "var(--color-separator)" }}
          >
            {g.sub?.map((s) => renderGroup(s, depth + 1))}
            {loose.map((r) => renderRow(r, mode === "agent", true))}
          </div>
        ) : null}
      </section>
    );
  };


  // מצומצם עד הסוף: רק סרגל הפעילות נשאר (ActivityBar), והוא גם מציג את הסשנים החיים והאחרונים
  if (sidebarWidth < 120) return null;

  return (
    <aside className="relative shrink-0 border-e border-[var(--color-separator)] bg-sidebar flex flex-col" style={{ width: sidebarWidth }}>
      <SidebarResize />
      <div className="side-top app-drag px-3 pt-3 pb-2 space-y-2.5">
        <div className="flex items-center gap-2">
          <label className="sidebar-search flex-1 min-w-0 flex items-center gap-2 rounded-[10px] fill px-2.5 py-[7px] text-sm transition focus-within:ring-2 focus-within:ring-blue/40">
            <Search className="size-4 text-muted shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="bg-transparent outline-none flex-1 min-w-0 placeholder:text-muted" />
          </label>
          <button onClick={() => select({ kind: "new" })} className="btn-primary shrink-0 flex items-center gap-1 text-sm px-2.5 py-[7px] transition" title={`${t("new")} (⌘N)`}>
            <Plus className="size-4" />
            {t("new")}
          </button>
        </div>
        <div className="segmented grid grid-cols-3 text-xs">
          {MODES.map((m) => (
            <button key={m.value} data-active={mode === m.value} onClick={() => changeMode(m.value)} className={cn("py-1 transition", mode === m.value ? "text-foreground" : "text-muted hover:text-foreground")}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pt-1">
        {transcriptHits.length > 0 && (
          <section className="mb-1">
            <div className="px-3 py-1.5 text-sm sticky top-0 bg-sidebar z-10 flex items-center gap-2">
              <Search className="size-3.5 text-muted" />
              <span className="font-medium">{t("inTranscripts")}</span>
              <span className="text-muted text-[11px] tabular">{transcriptHits.length}</span>
            </div>
            {transcriptHits.map((h) => {
              const r = sessions.find((s) => s.sessionId === h.sessionId);
              return (
                <button
                  key={h.sessionId}
                  onClick={() => (r?.live ? select({ kind: "live", liveId: r.live.liveId }) : select({ kind: "history", sessionId: h.sessionId }))}
                  className="w-[calc(100%-0.75rem)] mx-1.5 my-px text-start rounded-[10px] px-2.5 py-1.5 hover:bg-surface-2/70 transition"
                >
                  <div dir="auto" className="truncate text-[13px]">{r?.title ?? h.sessionId.slice(0, 8)}</div>
                  <div dir="auto" className="text-[11px] text-muted line-clamp-2">{h.snippet}</div>
                </button>
              );
            })}
          </section>
        )}
        {visibleGroups.length === 0 && <div className="p-4 text-sm text-muted">{t("noSessions")}</div>}
        {pinnedRows.length > 0 && !q.trim() && (
          <section className="mb-1.5">
            <div className="flex items-center gap-2 px-3 py-2 text-sm sticky top-0 bg-sidebar z-10">
              <Pin className="size-3.5 text-amber" />
              <span className="font-semibold">{t("pinned")}</span>
              <span className="text-muted/70 text-[11px] tabular">{pinnedRows.length}</span>
            </div>
            {pinnedRows.map((r) => renderRow(r, true, false))}
          </section>
        )}
        {mode === "sessions"
          ? timeline.map((b) => (
              <section key={b.label} className="mb-1.5">
                <div className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-[12px] sticky top-0 bg-sidebar z-10 text-muted">
                  <span className="font-semibold">{b.label}</span>
                  <span className="text-muted/70 text-[11px] tabular">{b.rows.length}</span>
                </div>
                {b.rows.map((r) => renderRow(r, true, false))}
              </section>
            ))
          : visibleGroups.map((g) => renderGroup(g, 0))}
      </div>
      {(hiddenCount > 0 || archivedCount > 0) && (
        <div className="border-t border-border/50 px-3 py-1.5 flex items-center gap-3 mono-label">
          {hiddenCount > 0 && (
            <button onClick={() => setShowHidden((v) => !v)} className="hover:text-foreground flex items-center gap-1">
              {showHidden ? <EyeOff className="size-3" /> : <Eye className="size-3" />} {t("hiddenN", { n: hiddenCount })}
            </button>
          )}
          {archivedCount > 0 && (
            <button onClick={() => setShowArchived((v) => !v)} className="hover:text-foreground flex items-center gap-1 ms-auto">
              <Archive className="size-3" /> {t("archivedN", { n: archivedCount })} {showArchived ? t("shown") : ""}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
