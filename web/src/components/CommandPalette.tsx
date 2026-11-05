import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { Search, MessageSquare, Folder, KanbanSquare, Bot, Zap, Radio, CornerDownLeft, TextSearch } from "lucide-react";
import { useStore, type ChatSel, type Selection } from "../store";
import { api } from "../api";
import { relTime } from "../lib/util";
import { projectVisual } from "../lib/groups";
import { getPrefs, setPrefs } from "../lib/prefs";
import { cn } from "../lib/util";
import type { TranscriptHit } from "../api";
import { strings, useT } from "../i18n";

type Item = {
  id: string;
  group: Group;
  icon: ComponentType<{ className?: string }>;
  label: string;
  hint?: string;
  keys?: string;
  /** טקסט נוסף לחיפוש */
  extra?: string;
  run: () => void;
  /** ⌘↵: פתיחה לצד */
  beside?: ChatSel;
};

type Group = "actions" | "settings" | "sessions" | "projects" | "tasks" | "agents" | "inChats";

const S = strings({
  he: {
    actions: "פעולות",
    settings: "הגדרות",
    sessions: "סשנים",
    projects: "פרויקטים",
    tasks: "משימות",
    agents: "סוכנים",
    inChats: "בתוך שיחות",
    "set.display": "תצוגה וערכת צבע",
    "set.voice": "קול והקראה",
    "set.voicechat": "שיחה קולית",
    "set.sessions": "ברירות מחדל לסשנים",
    "set.safety": "מגבלות ובטיחות",
    "set.profiles": "פרופילי פרויקטים",
    "set.notify": "התראות",
    "set.system": "מערכת ושעות שקטות",
    "set.rc": "Remote Control של Claude",
    "set.data": "נתונים וגיבוי",
    "set.keys": "קיצורי מקלדת",
    settingsItem: "הגדרות: {label}",
    newSession: "סשן חדש",
    inbox: "ממתין לך",
    board: "קנבן משימות",
    agentsPage: "סוכנים ויכולות",
    repos: "מאגרים וגיטהאב",
    extensions: "הרחבות: connectors (MCP) ופלאגינים",
    dash: "לוח בקרה",
    voice: "שיחה קולית",
    sidebar: "הסתר או הצג את סרגל הצד",
    light: "מצב בהיר",
    dark: "מצב כהה",
    unsplit: "סגור את המסך המפוצל",
    help: "קיצורי מקלדת",
    live: "חי · {project}",
    todo: "לביצוע",
    running: "רצה",
    review: "לבדיקה",
    done: "הושלמה",
    newWith: "סשן חדש עם {name}",
    placeholder: "חפש סשן, פרויקט, משימה, סוכן או פעולה",
    searchingChats: "מחפש גם בתוך השיחות...",
    notFound: "לא נמצא",
    beside: "⌘↵ לצד",
  },
  en: {
    actions: "Actions",
    settings: "Settings",
    sessions: "Sessions",
    projects: "Projects",
    tasks: "Tasks",
    agents: "Agents",
    inChats: "Inside conversations",
    "set.display": "Display and color theme",
    "set.voice": "Voice and read-aloud",
    "set.voicechat": "Voice chat",
    "set.sessions": "Session defaults",
    "set.safety": "Limits and safety",
    "set.profiles": "Project profiles",
    "set.notify": "Notifications",
    "set.system": "System and quiet hours",
    "set.rc": "Claude Remote Control",
    "set.data": "Data and backup",
    "set.keys": "Keyboard shortcuts",
    settingsItem: "Settings: {label}",
    newSession: "New session",
    inbox: "Waiting for you",
    board: "Task Board",
    agentsPage: "Agents and capabilities",
    repos: "Repositories and GitHub",
    extensions: "Extensions: connectors (MCP) and plugins",
    dash: "Dashboard",
    voice: "Voice chat",
    sidebar: "Hide or show the sidebar",
    light: "Light mode",
    dark: "Dark mode",
    unsplit: "Close the split view",
    help: "Keyboard shortcuts",
    live: "Live · {project}",
    todo: "To do",
    running: "Running",
    review: "In review",
    done: "Done",
    newWith: "New session with {name}",
    placeholder: "Search sessions, projects, tasks, agents or actions",
    searchingChats: "Also searching inside conversations...",
    notFound: "Nothing found",
    beside: "⌘↵ beside",
  },
});

/** מזהי העוגנים בעמוד ההגדרות */
const SETTINGS = ["display", "voice", "voicechat", "sessions", "safety", "profiles", "notify", "system", "rc", "data", "keys"] as const;

const norm = (s: string) => s.toLowerCase().replace(/[֑-ׇ]/g, "");

/** ⌘K: חיפוש אחד על הכול - סשנים, פרויקטים, משימות, סוכנים, פעולות, ותוכן השיחות. */
export default function CommandPalette() {
  const open = useStore((s) => s.palette);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  const { sessions, lives, tasks, agents, select, setPalette, projectThemes } = useStore();
  const [q, setQ] = useState("");
  const t = useT(S);
  const [idx, setIdx] = useState(0);
  const [hits, setHits] = useState<TranscriptHit[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => setPalette(false);
  const go = (s: Selection) => () => select(s);
  const allCwds = useMemo(() => new Set(sessions.map((s) => s.cwd)), [sessions]);
  // השם שמוצג בכל מקום אחר (שם תצוגה מהגדרות הפרויקט אם יש), לא שם התיקייה
  const pname = (cwd: string) => projectVisual(cwd, allCwds, projectThemes).name;

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const actions: Array<[string, string, () => void, string?]> = [
      [t("newSession"), "new", go({ kind: "new" }), "⌘N"],
      [t("inbox"), "inbox", go({ kind: "inbox" }), "⌘1"],
      [t("board"), "board", go({ kind: "board" }), "⌘2"],
      [t("agentsPage"), "agents", go({ kind: "agents" }), "⌘3"],
      [t("repos"), "repos", go({ kind: "repos" }), "⌘4"],
      [t("extensions"), "extensions mcp plugins connectors", go({ kind: "extensions" }), "⌘5"],
      [t("dash"), "dash", go(null), "⌘5"],
      [t("voice"), "voice", () => (location.hash = "#voice"), "⌥⌘Space"],
      [t("sidebar"), "sidebar", () => useStore.getState().toggleSidebar(), "⌘B"],
      [getPrefs().theme === "dark" ? t("light") : t("dark"), "theme", () => void setPrefs({ theme: getPrefs().theme === "dark" ? "light" : "dark" })],
      [t("unsplit"), "unsplit", () => useStore.setState({ split: [] })],
      [t("help"), "help", () => useStore.getState().setHelp(true), "⌘/"],
    ];
    for (const [label, id, run, keys] of actions) out.push({ id: `a:${id}`, group: "actions", icon: Zap, label, keys, run });
    for (const id of SETTINGS)
      out.push({
        id: `s:${id}`,
        group: "settings",
        icon: Zap,
        label: t("settingsItem", { label: t(`set.${id}`) }),
        run: () => {
          select({ kind: "settings" });
          setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
        },
      });
    for (const l of lives) {
      const c: ChatSel = { kind: "live", liveId: l.liveId };
      out.push({ id: `l:${l.liveId}`, group: "sessions", icon: Radio, label: l.title, hint: t("live", { project: pname(l.cwd) }), extra: l.cwd, run: go(c), beside: c });
    }
    const liveSessions = new Set(lives.map((l) => l.sessionId));
    for (const r of sessions) {
      if (liveSessions.has(r.sessionId)) continue;
      const c: ChatSel = { kind: "history", sessionId: r.sessionId };
      out.push({ id: `h:${r.sessionId}`, group: "sessions", icon: MessageSquare, label: r.title, hint: `${pname(r.projectCwd || r.cwd)} · ${relTime(r.lastModified)}`, extra: `${r.cwd} ${r.tag ?? ""}`, run: go(c), beside: c });
    }
    for (const cwd of allCwds) out.push({ id: `p:${cwd}`, group: "projects", icon: Folder, label: pname(cwd), hint: cwd.replace(/^\/Users\/[^/]+/, "~"), extra: cwd, run: go({ kind: "project", cwd }) });
    for (const task of tasks) out.push({ id: `t:${task.id}`, group: "tasks", icon: KanbanSquare, label: task.title, hint: t(task.status), extra: task.prompt.slice(0, 200), run: go({ kind: "board" }) });
    for (const a of agents) out.push({ id: `g:${a.slug}`, group: "agents", icon: Bot, label: t("newWith", { name: a.name }), hint: a.description.slice(0, 80), extra: a.slug, run: go({ kind: "new", agent: a.slug }) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, lives, tasks, agents, allCwds]);

  const filtered = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) {
      // בלי חיפוש: פעולות עיקריות וסשנים אחרונים
      return [...items.filter((i) => i.group === "sessions").slice(0, 8), ...items.filter((i) => i.group === "actions").slice(0, 6)];
    }
    const scored: Array<[number, Item]> = [];
    for (const it of items) {
      const label = norm(it.label);
      const hay = `${label} ${norm(it.hint ?? "")} ${norm(it.extra ?? "")}`;
      if (!words.every((w) => hay.includes(w))) continue;
      const score = (label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : 2) + (it.group === "sessions" ? 0 : 0.5);
      scored.push([score, it]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    const base = scored.slice(0, 40).map(([, it]) => it);
    const seen = new Set(base.map((b) => b.id));
    const textHits: Item[] = hits
      .filter((h) => !seen.has(`h:${h.sessionId}`))
      .map((h) => {
        const row = sessions.find((s) => s.sessionId === h.sessionId);
        const c: ChatSel = { kind: "history", sessionId: h.sessionId };
        return { id: `x:${h.sessionId}`, group: "inChats", icon: TextSearch, label: row?.title ?? h.sessionId.slice(0, 8), hint: h.snippet, run: go(c), beside: c };
      });
    return [...base, ...textHits];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, items, hits, sessions]);

  // חיפוש בתוכן השיחות, עם השהיה קטנה
  useEffect(() => {
    setHits([]);
    if (q.trim().length < 3) return;
    const timer = setTimeout(() => {
      api
        .sessionSearch(q.trim())
        .then((h) => setHits(h.slice(0, 12)))
        .catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => setIdx(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [idx]);

  const run = (it: Item | undefined, beside = false) => {
    if (!it) return;
    close();
    if (beside && it.beside) useStore.getState().openBeside(it.beside);
    else it.run();
  };

  let lastGroup: Group | "" = "";
  return (
    <div className="fixed inset-0 z-50 bg-black/25 backdrop-blur-[2px] flex justify-center items-start pt-[12vh]" onMouseDown={close}>
      <div className="card w-[min(640px,92vw)] shadow-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 border-b">
          <Search className="size-4 text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(filtered[idx], e.metaKey);
              }
            }}
            placeholder={t("placeholder")}
            className="flex-1 bg-transparent py-3.5 text-[15px] outline-none"
          />
          <kbd className="mono text-[11px] text-muted ltr">esc</kbd>
        </div>
        <div ref={listRef} className="max-h-[56vh] overflow-y-auto p-1.5">
          {filtered.length === 0 && <div className="text-center text-muted py-10 text-sm">{q.trim().length >= 3 ? t("searchingChats") : t("notFound")}</div>}
          {filtered.map((it, i) => {
            const header = it.group !== lastGroup ? t(it.group) : null;
            lastGroup = it.group;
            const Icon = it.icon;
            return (
              <div key={it.id}>
                {header && <div className="mono-label px-2.5 pt-2.5 pb-1">{header}</div>}
                <button
                  data-i={i}
                  onMouseMove={() => setIdx(i)}
                  onClick={(e) => run(it, e.metaKey)}
                  className={cn("w-full text-start rounded-[10px] px-2.5 py-2 flex items-center gap-3", i === idx ? "bg-blue text-white" : "")}
                >
                  <Icon className={cn("size-4 shrink-0", i === idx ? "text-white" : "text-muted")} />
                  <span className="truncate" dir="auto">
                    {it.label}
                  </span>
                  {it.hint && (
                    <span className={cn("truncate text-xs flex-1 min-w-0", i === idx ? "text-white/75" : "text-muted")} dir="auto">
                      {it.hint}
                    </span>
                  )}
                  {!it.hint && <span className="flex-1" />}
                  {it.keys && <kbd className={cn("mono text-[11px] ltr shrink-0", i === idx ? "text-white/80" : "text-muted")}>{it.keys}</kbd>}
                  {i === idx && it.beside && <span className="text-[11px] text-white/80 shrink-0">{t("beside")}</span>}
                  {i === idx && !it.beside && <CornerDownLeft className="size-3.5 shrink-0 text-white/80" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
