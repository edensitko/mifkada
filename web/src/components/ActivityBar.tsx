import { useMemo } from "react";
import { Plus, Inbox, KanbanSquare, Bot, GitBranch, LayoutDashboard, Orbit, Blocks, Settings as SettingsIcon, PanelRight, PanelLeft } from "lucide-react";
import { useStore, type Selection } from "../store";
import { cn } from "../lib/util";
import { isRTL, strings, useT } from "../i18n";
import { projectVisual } from "../lib/groups";
import { SESSION_DRAG } from "../lib/split";
import Avatar from "./Avatar";
import StatusDot from "./StatusDot";
import { FULL, RAIL } from "./SidebarResize";

const S = strings({
  he: {
    newSession: "סשן חדש",
    sessions: "סשנים",
    showSessions: "הצג את רשימת הסשנים",
    hideSessions: "הסתר את רשימת הסשנים",
    inbox: "ממתין",
    inboxFull: "ממתין לך",
    board: "קנבן",
    agents: "אייג'נטים",
    repos: "מאגרים",
    map: "מפה",
    ext: "הרחבות",
    dash: "לוח",
    settings: "הגדרות",
    connected: "מחובר",
    disconnected: "מנותק - מתחבר מחדש...",
  },
  en: {
    newSession: "New session",
    sessions: "Sessions",
    showSessions: "Show the session list",
    hideSessions: "Hide the session list",
    inbox: "Inbox",
    inboxFull: "Waiting for you",
    board: "Board",
    agents: "Agents",
    repos: "Repos",
    map: "Map",
    ext: "Extensions",
    dash: "Home",
    settings: "Settings",
    connected: "Connected",
    disconnected: "Disconnected - reconnecting...",
  },
});

type Nav = { kind: "inbox" | "board" | "agents" | "repos" | "map" | "extensions" | "dashboard"; key: "inbox" | "board" | "agents" | "repos" | "map" | "ext" | "dash"; icon: typeof Inbox; shortcut?: string };
const NAV: Nav[] = [
  { kind: "dashboard", key: "dash", icon: LayoutDashboard },
  { kind: "inbox", key: "inbox", icon: Inbox, shortcut: "⌘1" },
  { kind: "board", key: "board", icon: KanbanSquare, shortcut: "⌘2" },
  { kind: "agents", key: "agents", icon: Bot, shortcut: "⌘3" },
  { kind: "repos", key: "repos", icon: GitBranch, shortcut: "⌘4" },
  { kind: "extensions", key: "ext", icon: Blocks, shortcut: "⌘5" },
  { kind: "map", key: "map", icon: Orbit, shortcut: "⌘6" },
];

/**
 * סרגל הפעילות בקצה החלון, כמו ב-IDE: סשן חדש, הצגה/הסתרה של רשימת הסשנים, המסכים הראשיים עם שם מתחת לכל אייקון,
 * הסשנים החיים כאווטארים (אפשר לגרור אותם למסך המפוצל), והגדרות ומצב החיבור למטה.
 * כשרשימת הסשנים מוסתרת מופיעים כאן גם הסשנים האחרונים, כדי שעדיין יהיה אפשר לעבור ביניהם.
 */
export default function ActivityBar() {
  const t = useT(S);
  const { sessions, lives, selection, select, projectThemes, sidebarWidth, sidebarHidden, setSidebarWidth, unread, tasks, connected } = useStore();
  const listOpen = !sidebarHidden && sidebarWidth >= 120;
  const allCwds = useMemo(() => new Set(sessions.map((s) => s.cwd)), [sessions]);
  const inboxCount = lives.reduce((n, l) => n + l.pendingPermissions, 0) + tasks.filter((x) => x.status === "review").length;
  const liveIds = new Set(lives.map((l) => l.sessionId));
  const recent = listOpen ? [] : sessions.filter((s) => !liveIds.has(s.sessionId)).slice(0, 6);

  const toggleList = () => {
    if (sidebarHidden) useStore.setState({ sidebarHidden: false });
    setSidebarWidth(listOpen ? RAIL : FULL);
  };
  const isSel = (c: Extract<Selection, { kind: "live" } | { kind: "history" }>) =>
    selection?.kind === c.kind && (c.kind === "live" ? (selection as { liveId: string }).liveId === c.liveId : (selection as { sessionId: string }).sessionId === c.sessionId);

  // פונקציה ולא קומפוננטה פנימית, כדי שגרירה לא תתבטל כשהרשימה מתעדכנת
  const avatar = (key: string, c: Extract<Selection, { kind: "live" } | { kind: "history" }>, title: string, cwd: string, state?: string, dot?: boolean) => {
    const v = projectVisual(cwd, allCwds, projectThemes);
    return (
      <button
        key={key}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(SESSION_DRAG, JSON.stringify(c));
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={(e) => (e.metaKey ? useStore.getState().openBeside(c) : select(c))}
        title={title}
        className={cn("relative size-10 shrink-0 rounded-[11px] grid place-items-center transition", isSel(c) ? "bg-blue/15 ring-2 ring-blue" : "hover:bg-[var(--color-fill)]")}
      >
        <Avatar emoji={v.emoji} color={v.color} image={v.image} size="md" square />
        {state && <StatusDot state={state as never} className="absolute bottom-0 start-0 ring-2 ring-[var(--color-sidebar)]" />}
        {dot && <span className="absolute top-0 end-0 size-2.5 rounded-full bg-blue ring-2 ring-[var(--color-sidebar)]" />}
      </button>
    );
  };

  const ListIcon = isRTL() ? PanelRight : PanelLeft;
  const navButton = (active: boolean, onClick: () => void, Icon: typeof Inbox, label: string, title: string, badge = 0) => (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-current={active ? "page" : undefined}
      className={cn("activity-item group relative w-full flex flex-col items-center gap-0.5 py-1.5 transition", active ? "text-blue" : "text-muted hover:text-foreground")}
      data-active={active}
    >
      <span className={cn("activity-icon size-8 rounded-[9px] grid place-items-center transition", active ? "bg-blue/12" : "group-hover:bg-[var(--color-fill)]")}>
        <Icon className="size-[18px]" />
      </span>
      <span className="activity-label text-[10px] leading-none font-medium">{label}</span>
      {badge > 0 && <span className="absolute top-0.5 end-2 min-w-4 h-4 px-1 rounded-full bg-danger text-white text-[10px] grid place-items-center">{badge}</span>}
    </button>
  );

  return (
    <aside className="activity-bar app-drag shrink-0 border-e border-[var(--color-separator)] flex flex-col items-center pt-2 pb-2 gap-1" style={{ width: 64 }}>
      {/* כשהרשימה פתוחה כפתור "חדש" נמצא בראש שלה; כאן רק כשהיא סגורה */}
      {!listOpen && (
        <button onClick={() => select({ kind: "new" })} className="size-9 shrink-0 rounded-[10px] grid place-items-center btn-primary mt-2 mb-1" title={`${t("newSession")} (⌘N)`}>
          <Plus className="size-[18px]" />
        </button>
      )}
      {navButton(listOpen, toggleList, ListIcon, t("sessions"), listOpen ? t("hideSessions") : t("showSessions"))}
      {NAV.map((n) =>
        navButton(
          n.kind === "dashboard" ? selection === null : selection?.kind === n.kind,
          () => select(n.kind === "dashboard" ? null : ({ kind: n.kind } as Selection)),
          n.icon,
          t(n.key),
          (n.kind === "inbox" ? t("inboxFull") : t(n.key)) + (n.shortcut ? ` (${n.shortcut})` : ""),
          n.kind === "inbox" ? inboxCount : 0,
        ),
      )}
      {(lives.length > 0 || recent.length > 0) && <div className="w-8 h-px bg-[var(--color-separator)] my-1 shrink-0" />}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col items-center gap-1.5 w-full no-drag no-scrollbar">
        {lives.map((l) => avatar(l.liveId, { kind: "live", liveId: l.liveId }, l.title, l.cwd, l.state, Boolean(unread[l.liveId])))}
        {recent.length > 0 && lives.length > 0 && <div className="w-6 h-px bg-[var(--color-separator)] my-1 shrink-0" />}
        {recent.map((r) => avatar(r.sessionId, { kind: "history", sessionId: r.sessionId }, r.title, r.cwd))}
      </div>
      {navButton(selection?.kind === "settings", () => select({ kind: "settings" }), SettingsIcon, t("settings"), `${t("settings")} (⌘,)`)}
      <span className={cn("size-2 rounded-full mt-1", connected ? "bg-ok" : "bg-danger pulse")} title={connected ? t("connected") : t("disconnected")} />
    </aside>
  );
}
